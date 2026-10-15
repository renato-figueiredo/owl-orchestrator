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

let dir: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
/** Scenario each provider's fake CLI plays; the refiner is `codex-cli`, the executor `claude-cli`. */
let scenario: Record<string, string>;
let spawned: Array<{ provider: string; record: string }>;

const rec = (i: number) => JSON.parse(readFileSync(spawned[i]!.record, 'utf8')) as { argv: string[]; stdin: string };

async function setup() {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({
    repos,
    resolveAdapter: (id) => {
      const record = join(dir, `rec-${spawned.length}.json`);
      spawned.push({ provider: id, record });
      return createClaudeCliAdapter({
        bin: process.execPath,
        binArgs: [FAKE],
        killGraceMs: 300,
        env: { ...process.env, FAKE_SCENARIO: scenario[id] ?? 'text', FAKE_RECORD: record },
      });
    },
  });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-pipe-'));
  scenario = {};
  spawned = [];
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body?: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const get = async <T>(path: string) => (await (await fetch(base + path)).json()) as T;

interface Detail {
  messages: { papel: string; conteudo: string; runId: string | null }[];
  runs: { id: string; etapa: string | null; parentRunId: string | null; provedor: string; modelo: string | null; status: string }[];
  approvals: { id: string; runId: string; motivo: string }[];
}
const detail = (sid: string) => get<Detail>(`/sessions/${sid}`);

async function newSession() {
  return ((await (await post('/sessions')).json()) as { session: { id: string } }).session.id;
}
async function stream(runId: string): Promise<RunEvent[]> {
  const text = await (await fetch(`${base}/runs/${runId}/stream`)).text();
  return text
    .split('\n\n')
    .filter((b) => b.includes('data: '))
    .map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as RunEvent);
}
const send = async (sid: string, body: object) => {
  const r = await post(`/sessions/${sid}/messages`, { texto: 'faça X', ...body });
  return { status: r.status, body: (await r.json()) as { runId: string; etapa?: string | null; error?: { code: string } } };
};

describe('checkbox off', () => {
  it('runs exactly one step', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, {});
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]).toMatchObject({ provedor: 'claude-cli', parentRunId: null });
    expect(d.messages.map((m) => m.papel)).toEqual(['usuario', 'assistente']);
    expect(rec(0).stdin).toBe('faça X');
  });
});

describe('melhorar prompt, no review', () => {
  it('chains refine → execute: two runs linked by parent_run_id, the refined prompt is what runs', async () => {
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    expect(first.status).toBe(202);
    expect(first.body.etapa).toBe('melhorar');

    // When the first run's stream ends, the second run already exists (no gap for the client).
    expect((await stream(first.body.runId)).at(-1)?.type).toBe('end');
    const midway = await detail(sid);
    expect(midway.runs.map((r) => r.etapa)).toEqual(['melhorar', 'executar']);

    await executor.idle();
    const d = await detail(sid);
    const [melhorar, executar] = d.runs;
    expect(melhorar).toMatchObject({ provedor: 'codex-cli', status: 'ok', parentRunId: null });
    expect(executar).toMatchObject({ provedor: 'claude-cli', status: 'ok', parentRunId: melhorar!.id });
    expect(d.messages.map((m) => m.papel)).toEqual(['usuario', 'agente', 'assistente']);
    expect(d.messages[0]!.conteudo).toBe('faça X'); // the original request, once
    expect(d.messages[1]).toMatchObject({ runId: melhorar!.id });

    // The refiner got the agent's instructions; the executor got the refined output as its prompt.
    expect(rec(0).stdin).toBe('faça X');
    expect(rec(0).argv.join(' ')).toContain('SOMENTE o prompt reescrito');
    expect(rec(1).stdin).toBe(d.messages[1]!.conteudo);
    expect(rec(1).argv.join(' ')).not.toContain('SOMENTE o prompt reescrito');
    expect(d.approvals).toEqual([]);
  });

  it('the executor step keeps the provider/model chosen for the conversation', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, { melhorarPrompt: true, provider: 'claude-cli', model: 'sonnet' });
    await executor.idle();
    expect((await detail(sid)).runs[1]).toMatchObject({ provedor: 'claude-cli', modelo: 'sonnet' });
  });

  it('the refiner can be switched per request (haiku instead of Codex)', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, { melhorarPrompt: true, refinador: { provider: 'claude-cli', model: 'haiku' } });
    await executor.idle();
    expect((await detail(sid)).runs[0]).toMatchObject({ etapa: 'melhorar', provedor: 'claude-cli', modelo: 'haiku' });
  });
});

describe('melhorar prompt with review (editar antes)', () => {
  it('stops after the refinement with a pending approval; the user edit is what runs', async () => {
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true, editarAntes: true });
    await stream(first.body.runId);
    await executor.idle();

    const paused = await detail(sid);
    expect(paused.runs).toHaveLength(1);
    expect(paused.approvals).toHaveLength(1);
    expect(paused.approvals[0]).toMatchObject({ runId: first.body.runId, motivo: expect.stringContaining('Revisar') });
    expect(spawned).toHaveLength(1);

    const res = await post(`/runs/${first.body.runId}/continue`, { texto: 'PROMPT EDITADO PELO USUÁRIO' });
    expect(res.status).toBe(202);
    const next = (await res.json()) as { runId: string; etapa: string };
    expect(next.etapa).toBe('executar');
    await executor.idle();

    expect(rec(1).stdin).toBe('PROMPT EDITADO PELO USUÁRIO');
    const done = await detail(sid);
    expect(done.runs[1]).toMatchObject({ etapa: 'executar', parentRunId: first.body.runId });
    expect(done.approvals).toEqual([]);

    // a second decision on the same pause is refused
    expect((await post(`/runs/${first.body.runId}/continue`, {})).status).toBe(409);
  });

  it('continuing without an edit runs the refined prompt as it was', async () => {
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true, editarAntes: true });
    await stream(first.body.runId);
    await executor.idle();
    const refined = (await detail(sid)).messages.find((m) => m.papel === 'agente')!.conteudo;
    await post(`/runs/${first.body.runId}/continue`, {});
    await executor.idle();
    expect(rec(1).stdin).toBe(refined);
  });

  it('discarding ends the request without running the second step', async () => {
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true, editarAntes: true });
    await stream(first.body.runId);
    await executor.idle();
    expect((await post(`/runs/${first.body.runId}/discard`)).status).toBe(200);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs).toHaveLength(1);
    expect(d.approvals).toEqual([]);
    expect((await post(`/runs/${first.body.runId}/continue`, {})).status).toBe(409);
  });

  it('after a server restart the pause cannot be resumed (410) and is closed', async () => {
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true, editarAntes: true });
    await stream(first.body.runId);
    await executor.idle();
    const restarted = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
    const res = await restarted.inject({ method: 'POST', url: `/runs/${first.body.runId}/continue`, headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' }, payload: {} });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('expired');
    expect((await detail(sid)).approvals).toEqual([]);
    await restarted.close();
  });
});

describe('refiner failure (e.g. the Codex limit ran out)', () => {
  it('asks instead of switching silently; retry with haiku then completes the chain', async () => {
    scenario = { 'codex-cli': 'error' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    expect((await stream(first.body.runId)).at(-1)?.type).toBe('error');
    await executor.idle();

    const failed = await detail(sid);
    expect(failed.runs).toHaveLength(1); // nothing else ran: no silent fallback
    expect(failed.runs[0]).toMatchObject({ etapa: 'melhorar', provedor: 'codex-cli', status: 'erro' });
    expect(failed.approvals[0]).toMatchObject({ motivo: expect.stringContaining('Falha ao melhorar o prompt') });
    expect(spawned.map((s) => s.provider)).toEqual(['codex-cli']);

    const retry = await post(`/runs/${first.body.runId}/retry`, { provider: 'claude-cli', model: 'haiku' });
    expect(retry.status).toBe(202);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.provedor, r.status])).toEqual([
      ['melhorar', 'codex-cli', 'erro'],
      ['melhorar', 'claude-cli', 'ok'],
      ['executar', 'claude-cli', 'ok'],
    ]);
    expect(d.runs[1]!.modelo).toBe('haiku');
    expect(d.runs[2]!.parentRunId).toBe(d.runs[1]!.id);
    expect(d.approvals).toEqual([]);
  });

  it('"run without improving" executes the original request', async () => {
    scenario = { 'codex-cli': 'error' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    await stream(first.body.runId);
    await executor.idle();
    const res = await post(`/runs/${first.body.runId}/continue`, {});
    expect(res.status).toBe(202);
    await executor.idle();
    expect(rec(1).stdin).toBe('faça X');
    expect((await detail(sid)).runs[1]).toMatchObject({ etapa: 'executar', status: 'ok' });
  });

  it('a failing execute step ends the pipeline without an approval', async () => {
    scenario = { 'claude-cli': 'error' };
    await setup();
    const sid = await newSession();
    await send(sid, { melhorarPrompt: true });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.status])).toEqual([['melhorar', 'ok'], ['executar', 'erro']]);
    expect(d.approvals).toEqual([]);
  });
});

describe('project instructions and validation', () => {
  it('project instructions reach the executor step but not the refiner', async () => {
    await setup();
    const pasta = mkdtempSync(join(tmpdir(), 'owl-pipe-proj-'));
    try {
      const { project } = (await (await post('/projects', { nome: 'P', pasta, instrucoes: 'REGRA-DO-PROJETO' })).json()) as { project: { id: string } };
      const sid = ((await (await post('/sessions', { projectId: project.id })).json()) as { session: { id: string } }).session.id;
      await send(sid, { melhorarPrompt: true });
      await executor.idle();
      expect(rec(0).argv.join(' ')).not.toContain('REGRA-DO-PROJETO');
      expect(rec(1).argv.join(' ')).toContain('REGRA-DO-PROJETO');
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('rejects an unknown refiner provider and bad model ids', async () => {
    await setup();
    const sid = await newSession();
    expect((await send(sid, { melhorarPrompt: true, refinador: { provider: 'nope' } })).body.error?.code).toBe('unknown_provider');
    expect((await send(sid, { melhorarPrompt: true, refinador: { provider: 'claude-cli', model: '--x' } })).status).toBe(400);
    expect((await post('/runs/x/retry', { provider: 'nope' })).status).toBe(400);
    expect((await post('/runs/missing/continue', {})).status).toBe(404);
    expect(spawned).toHaveLength(0);
  });

  it('GET /refiner exposes the agent default and its alternatives', async () => {
    await setup();
    expect(await get('/refiner')).toEqual({ provedor: 'codex-cli', modelo: null, fallback: [{ provedor: 'claude-cli', modelo: 'haiku' }] });
  });
});
