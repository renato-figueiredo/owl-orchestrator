import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCliAdapter, type RunEvent } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';

const FAKE = fileURLToPath(new URL('../../../packages/core/test/fake-cli.mjs', import.meta.url));
const SESSION_ID = '0ebc5870-da74-48ab-88a4-2e4c4aaeb936'; // from the real captured fixture

let dir: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let scenario = 'text';

const rec = () => JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8')) as { argv: string[]; cwd: string; stdin: string };

async function setup(concurrency = 1) {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({
    repos,
    concurrency,
    resolveAdapter: () =>
      createClaudeCliAdapter({
        bin: process.execPath,
        binArgs: [FAKE],
        killGraceMs: 300,
        env: { ...process.env, FAKE_SCENARIO: scenario, FAKE_RECORD: join(dir, 'rec.json') },
      }),
  });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-server-'));
  scenario = 'text';
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body?: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

async function newSession(projectId?: string) {
  const r = await post('/sessions', projectId ? { projectId } : {});
  return ((await r.json()) as { session: { id: string } }).session.id;
}
async function send(sessionId: string, texto: string, extra: object = {}) {
  const r = await post(`/sessions/${sessionId}/messages`, { texto, ...extra });
  return { status: r.status, body: (await r.json()) as { runId: string; error?: { code: string } } };
}
/** Reads the SSE stream until the server closes it. */
async function stream(runId: string): Promise<RunEvent[]> {
  const res = await fetch(`${base}/runs/${runId}/stream`);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.includes('data: '))
    .map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as RunEvent);
}

describe('GET /health', () => {
  it('responds ok', async () => {
    await setup();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', name: 'owl' });
  });
});

describe('message → SSE → stored answer', () => {
  it('streams events, stores the reply, tokens and CLI session id', async () => {
    await setup();
    const sid = await newSession();
    const { status, body } = await send(sid, 'diga ok');
    expect(status).toBe(202);

    const events = await stream(body.runId);
    expect(events[0]?.type).toBe('start');
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.at(-1)?.type).toBe('end');
    expect(rec().stdin).toBe('diga ok');

    // no idle() here on purpose: once the client sees `end`, the final state must already be stored
    const detail = (await (await fetch(`${base}/sessions/${sid}`)).json()) as {
      session: { cliSessionId: string; cliProvider: string };
      messages: { papel: string; conteudo: string; runId: string | null }[];
      runs: { status: string; tokensOut: number | null; erro: string | null }[];
    };
    expect(detail.messages.map((m) => m.papel)).toEqual(['usuario', 'assistente']);
    expect(detail.messages[1]!.conteudo.length).toBeGreaterThan(0);
    expect(detail.messages[1]!.runId).toBe(body.runId);
    expect(detail.runs[0]).toMatchObject({ status: 'ok' });
    expect(detail.runs[0]!.tokensOut).toBeGreaterThan(0);
    expect(detail.session).toMatchObject({ cliProvider: 'claude-cli', cliSessionId: SESSION_ID });
  });

  it('replays the whole stream to a client that connects after the run finished', async () => {
    await setup();
    const { body } = await send(await newSession(), 'olá');
    await executor.idle();
    const events = await stream(body.runId);
    expect(events[0]?.type).toBe('start');
    expect(events.at(-1)?.type).toBe('end');
  });

  it('reports a failing CLI as an error run', async () => {
    scenario = 'error';
    await setup();
    const sid = await newSession();
    const { body } = await send(sid, 'x');
    const events = await stream(body.runId);
    expect(events.at(-1)?.type).toBe('error');
    await executor.idle();
    expect(repos.runs.get(body.runId)).toMatchObject({ status: 'erro' });
    expect(repos.messages.list(sid).map((m) => m.papel)).toEqual(['usuario']);
  });
});

describe('--resume', () => {
  it('second message in the same session resumes the CLI session', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, 'primeira');
    await executor.idle();
    expect(rec().argv.join(' ')).not.toContain('--resume');

    await send(sid, 'segunda');
    await executor.idle();
    expect(rec().argv).toContain(`--resume=${SESSION_ID}`);
  });

  it('a queued second message still resumes (reads the session when it starts)', async () => {
    await setup(2); // concurrency 2, but the same session never runs twice at once
    const sid = await newSession();
    await send(sid, 'primeira');
    await send(sid, 'segunda');
    await executor.idle();
    expect(rec().argv).toContain(`--resume=${SESSION_ID}`);
  });
});

describe('cancel', () => {
  it('kills the process and marks the run cancelado', async () => {
    scenario = 'hang';
    await setup();
    const sid = await newSession();
    const { body } = await send(sid, 'longo');

    const pending = stream(body.runId);
    for (let i = 0; i < 100 && !repos.runs.get(body.runId); i++) await new Promise((r) => setTimeout(r, 20));
    // wait until the process is really running (fake CLI records its pid on start)
    for (let i = 0; i < 100; i++) {
      try { rec(); break; } catch { await new Promise((r) => setTimeout(r, 30)); }
    }
    const pid = (JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8')) as { pid?: number }).pid;
    expect((await post(`/runs/${body.runId}/cancel`)).status).toBe(202);

    const events = await pending;
    expect(events.at(-1)?.type).toBe('cancelled');
    await executor.idle();
    expect(repos.runs.get(body.runId)).toMatchObject({ status: 'cancelado' });
    if (pid) {
      await new Promise((r) => setTimeout(r, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    }
    expect((await post(`/runs/${body.runId}/cancel`)).status).toBe(409);
  });

  it('cancels a run that is still waiting in the queue', async () => {
    scenario = 'hang';
    await setup(1);
    const first = await send(await newSession(), 'a');
    const second = await send(await newSession(), 'b');
    expect((await post(`/runs/${second.body.runId}/cancel`)).status).toBe(202);
    expect(repos.runs.get(second.body.runId)).toMatchObject({ status: 'cancelado' });
    expect((await stream(second.body.runId)).at(-1)?.type).toBe('cancelled');
    await post(`/runs/${first.body.runId}/cancel`);
  });
});

describe('queue', () => {
  it('runs one at a time by default', async () => {
    await setup(1);
    const a = await send(await newSession(), 'a');
    const b = await send(await newSession(), 'b');
    // b waits behind a: it has produced no events yet while a is still in memory as running
    const subB = executor.subscribe(b.body.runId, () => {})!;
    expect(subB.history).toEqual([]);
    subB.unsubscribe();
    for (const r of [a, b]) expect((await stream(r.body.runId)).at(-1)?.type).toBe('end');
    await executor.idle();
    expect(repos.runs.get(a.body.runId)).toMatchObject({ status: 'ok' });
    expect(repos.runs.get(b.body.runId)).toMatchObject({ status: 'ok' });
  });
});

describe('projects', () => {
  it('runs in the project folder with its instructions and refuses a cwd override', async () => {
    await setup();
    const pasta = mkdtempSync(join(tmpdir(), 'owl-proj-'));
    try {
      const created = await post('/projects', { nome: 'Alfa', pasta, instrucoes: 'Responda em português.' });
      expect(created.status).toBe(201);
      const { project } = (await created.json()) as { project: { id: string } };
      const sid = await newSession(project.id);

      const bad = await send(sid, 'x', { cwd: dir });
      expect(bad.status).toBe(400);
      expect(bad.body.error?.code).toBe('cwd_not_allowed');

      await send(sid, 'oi');
      await executor.idle();
      const r = rec();
      expect(r.cwd).toBe(pasta);
      expect(r.argv.join(' ')).toContain('Responda em português.');
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('keeps sessions of different projects apart', async () => {
    await setup();
    const a = mkdtempSync(join(tmpdir(), 'owl-a-'));
    const b = mkdtempSync(join(tmpdir(), 'owl-b-'));
    try {
      const pa = ((await (await post('/projects', { nome: 'A', pasta: a })).json()) as { project: { id: string } }).project.id;
      const pb = ((await (await post('/projects', { nome: 'B', pasta: b })).json()) as { project: { id: string } }).project.id;
      const sa = await newSession(pa);
      await newSession(pb);
      const listA = (await (await fetch(`${base}/sessions?projectId=${pa}`)).json()) as { sessions: { id: string }[] };
      expect(listA.sessions.map((s) => s.id)).toEqual([sa]);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it('rejects a project whose folder does not exist', async () => {
    await setup();
    const r = await post('/projects', { nome: 'X', pasta: join(dir, 'nope') });
    expect(r.status).toBe(400);
  });
});

describe('validation and errors', () => {
  it('returns standard errors', async () => {
    await setup();
    const sid = await newSession();
    const empty = await post(`/sessions/${sid}/messages`, { texto: '   ' });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: { code: string } }).error.code).toBe('invalid_request');

    const badModel = await post(`/sessions/${sid}/messages`, { texto: 'x', model: '--dangerously-skip-permissions' });
    expect(badModel.status).toBe(400);

    const unknownProvider = await send(sid, 'x', { provider: 'nope' });
    expect(unknownProvider.body.error?.code).toBe('unknown_provider');

    const noSession = await post('/sessions/missing/messages', { texto: 'x' });
    expect(noSession.status).toBe(404);
    expect(((await noSession.json()) as { error: { code: string } }).error.code).toBe('session_not_found');

    expect((await fetch(`${base}/runs/missing/stream`)).status).toBe(404);
    expect((await post('/runs/missing/cancel')).status).toBe(404);
    expect((await post('/sessions', { projectId: 'missing' })).status).toBe(404);
    const unknownRoute = await fetch(`${base}/nope`);
    expect(unknownRoute.status).toBe(404);
    expect(((await unknownRoute.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
});
