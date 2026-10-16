import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunEvent, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';

let dir: string;
let extra: string[];
let seen: RunRequest[];
let script: RunEvent[];
let repos: ReturnType<typeof createRepos>;
let executor: Executor;
let app: ReturnType<typeof buildApp>;

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  run(req) {
    seen.push(req);
    return (async function* () {
      yield { type: 'start', runId: req.runId ?? '', provider: 'claude-cli' } as RunEvent;
      for (const e of script) yield e;
    })();
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-extra-'));
  extra = [];
  seen = [];
  script = [{ type: 'text', delta: 'a' }, { type: 'text', delta: 'b' }, { type: 'tool', name: 'Read' }, { type: 'end', result: 'ab', cliSessionId: 'c1' }];
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({ repos, resolveAdapter: () => adapter });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  for (const d of [dir, ...extra]) rmSync(d, { recursive: true, force: true });
});

const json = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.statusCode, body: res.json() as Record<string, any>, headers: res.headers };
};
const project = async (nome: string, instrucoes?: string) => {
  const pasta = mkdtempSync(join(tmpdir(), 'owl-p-'));
  extra.push(pasta);
  const r = await json('POST', '/projects', { nome, pasta, ...(instrucoes ? { instrucoes } : {}) });
  return { id: r.body.project.id as string, pasta };
};

describe('REST routes', () => {
  it('GET /providers lists the registered adapters', async () => {
    const r = await json('GET', '/providers');
    expect(r.body.providers).toEqual(
      expect.arrayContaining([
        { id: 'claude-cli', available: expect.any(Boolean) },
        { id: 'codex-cli', available: expect.any(Boolean) },
      ]),
    );
  });

  it('POST /sessions returns 201 with the session; GET /sessions lists it; GET /sessions/:id returns detail', async () => {
    const c = await json('POST', '/sessions', { titulo: '  Meu chat  ' });
    expect(c.status).toBe(201);
    expect(c.body.session.titulo).toBe('Meu chat');
    const id = c.body.session.id;
    expect((await json('GET', '/sessions')).body.sessions.map((s: { id: string }) => s.id)).toContain(id);
    const d = await json('GET', `/sessions/${id}`);
    expect(d.body).toMatchObject({ messages: [], runs: [] });
  });

  it('POST /sessions accepts an empty body', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions' });
    expect(res.statusCode).toBe(201);
  });

  it('POST /sessions/:id/messages returns 202 + runId', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const r = await json('POST', `/sessions/${sid}/messages`, { texto: 'oi' });
    expect(r.status).toBe(202);
    expect(typeof r.body.runId).toBe('string');
  });

  it('malformed JSON body is a 400 in the standard error shape', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toHaveProperty('code');
    expect(res.json().error).toHaveProperty('message');
  });
});

describe('validation', () => {
  it.each([
    ['missing texto', {}],
    ['texto not a string', { texto: 5 }],
    ['texto too long', { texto: 'x'.repeat(200_001) }],
    ['empty provider', { texto: 'x', provider: '' }],
    ['model starting with dash', { texto: 'x', model: '-p' }],
    ['model with shell chars', { texto: 'x', model: 'a;rm -rf /' }],
    ['model with space', { texto: 'x', model: 'a b' }],
  ])('rejects %s with 400 invalid_request and starts no run', async (_n, body) => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const r = await json('POST', `/sessions/${sid}/messages`, body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_request');
    expect(repos.runs.listBySession(sid)).toEqual([]);
    expect(repos.messages.list(sid)).toEqual([]);
  });

  it('accepts typical model ids', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    for (const model of ['sonnet', 'claude-sonnet-4-5', 'llama3.2:3b', 'opus[1m]']) {
      expect((await json('POST', `/sessions/${sid}/messages`, { texto: 'x', model })).status).toBe(202);
    }
    await executor.idle();
  });

  it('rejects invalid project payloads and invalid session payloads', async () => {
    expect((await json('POST', '/projects', { nome: '', pasta: dir })).status).toBe(400);
    expect((await json('POST', '/projects', { nome: 'x' })).status).toBe(400);
    expect((await json('POST', '/projects', { nome: 'x', pasta: join(dir, 'file-that-does-not-exist') })).body.error.code).toBe('invalid_folder');
    expect((await json('POST', '/sessions', { titulo: '' })).status).toBe(400);
    expect((await json('GET', '/sessions?projectId=')).status).toBe(400);
  });

  it('rejects a non-project cwd that is not a directory', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const r = await json('POST', `/sessions/${sid}/messages`, { texto: 'x', cwd: join(dir, 'nope') });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_folder');
  });

  it('uses the given cwd for a session without a project, default otherwise', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const other = mkdtempSync(join(tmpdir(), 'owl-cwd-'));
    extra.push(other);
    await json('POST', `/sessions/${sid}/messages`, { texto: 'a', cwd: other });
    await executor.idle();
    await json('POST', `/sessions/${sid}/messages`, { texto: 'b' });
    await executor.idle();
    expect(seen.map((r) => r.cwd)).toEqual([other, dir]);
  });

  it('error responses never leak internal details on 500', async () => {
    const boom = buildApp({ repos: { ...repos, projects: { ...repos.projects, list: () => { throw new Error('secret-internal detail'); } } } as never, executor, workspaceRoots: [tmpdir()] });
    const res = await boom.inject({ method: 'GET', url: '/projects' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'Internal server error' } });
    await boom.close();
  });
});

describe('project scoping', () => {
  it('each project run uses its own folder and instructions (no bleed between projects)', async () => {
    const a = await project('A', 'regra-A');
    const b = await project('B', 'regra-B');
    const noInstr = await project('C');
    const sa = (await json('POST', '/sessions', { projectId: a.id })).body.session.id;
    const sb = (await json('POST', '/sessions', { projectId: b.id })).body.session.id;
    const sc = (await json('POST', '/sessions', { projectId: noInstr.id })).body.session.id;
    for (const s of [sa, sb, sc]) await json('POST', `/sessions/${s}/messages`, { texto: 'oi' });
    await executor.idle();
    const bySession = (cwd: string) => seen.find((r) => r.cwd === cwd)!;
    expect(bySession(a.pasta).systemAppend).toBe('regra-A');
    expect(bySession(b.pasta).systemAppend).toBe('regra-B');
    expect(bySession(noInstr.pasta).systemAppend).toBeUndefined();
  });

  it('listing is filtered per project; unfiltered lists all; unknown project id lists none', async () => {
    const a = await project('A');
    const b = await project('B');
    const sa = (await json('POST', '/sessions', { projectId: a.id })).body.session.id;
    const sb = (await json('POST', '/sessions', { projectId: b.id })).body.session.id;
    const free = (await json('POST', '/sessions', {})).body.session.id;
    const ids = async (q: string) => (await json('GET', `/sessions${q}`)).body.sessions.map((s: { id: string }) => s.id).sort();
    expect(await ids(`?projectId=${a.id}`)).toEqual([sa]);
    expect(await ids(`?projectId=${b.id}`)).toEqual([sb]);
    expect(await ids('')).toEqual([sa, sb, free].sort());
    expect(await ids('?projectId=nope')).toEqual([]);
  });

  it('messages and runs of one project do not appear in another project session', async () => {
    const a = await project('A');
    const b = await project('B');
    const sa = (await json('POST', '/sessions', { projectId: a.id })).body.session.id;
    const sb = (await json('POST', '/sessions', { projectId: b.id })).body.session.id;
    const { body } = await json('POST', `/sessions/${sa}/messages`, { texto: 'segredo-A' });
    await executor.idle();
    const detB = (await json('GET', `/sessions/${sb}`)).body;
    expect(detB.messages).toEqual([]);
    expect(detB.runs).toEqual([]);
    expect(JSON.stringify(detB)).not.toContain('segredo-A');
    const detA = (await json('GET', `/sessions/${sa}`)).body;
    expect(detA.runs.map((r: { id: string }) => r.id)).toEqual([body.runId]);
  });

  it('CLI session ids are stored per session, so projects never resume each other', async () => {
    const a = await project('A');
    const b = await project('B');
    const sa = (await json('POST', '/sessions', { projectId: a.id })).body.session.id;
    const sb = (await json('POST', '/sessions', { projectId: b.id })).body.session.id;
    await json('POST', `/sessions/${sa}/messages`, { texto: '1' });
    await executor.idle();
    await json('POST', `/sessions/${sb}/messages`, { texto: '2' });
    await executor.idle();
    expect(seen[1]!.resumeSessionId).toBeUndefined();
    await json('POST', `/sessions/${sa}/messages`, { texto: '3' });
    await executor.idle();
    expect(seen[2]!.resumeSessionId).toBe('c1');
  });

  it('a session in a project whose cwd override is attempted is refused without side effects', async () => {
    const a = await project('A');
    const sa = (await json('POST', '/sessions', { projectId: a.id })).body.session.id;
    const r = await json('POST', `/sessions/${sa}/messages`, { texto: 'x', cwd: dir });
    expect(r.body.error.code).toBe('cwd_not_allowed');
    expect(repos.messages.list(sa)).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('project folder deleted after creation is reported as invalid_folder', async () => {
    const a = await project('A');
    const sa = (await json('POST', '/sessions', { projectId: a.id })).body.session.id;
    rmSync(a.pasta, { recursive: true, force: true });
    const r = await json('POST', `/sessions/${sa}/messages`, { texto: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_folder');
    expect(repos.messages.list(sa)).toEqual([]);
  });
});

describe('deleted sessions', () => {
  it('soft-deleted session is hidden from list and 404 on detail and on new messages', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    repos.sessions.softDelete(sid);
    expect((await json('GET', '/sessions')).body.sessions).toEqual([]);
    expect((await json('GET', `/sessions/${sid}`)).status).toBe(404);
    const r = await json('POST', `/sessions/${sid}/messages`, { texto: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('session_not_found');
    expect(seen).toEqual([]);
  });

  it('restoring brings the session back', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    repos.sessions.softDelete(sid);
    repos.sessions.restore(sid);
    expect((await json('GET', `/sessions/${sid}`)).status).toBe(200);
  });
});

describe('SSE', () => {
  const sse = async (runId: string) => {
    const res = await app.inject({ method: 'GET', url: `/runs/${runId}/stream` });
    const frames = res.body.split('\n\n').filter(Boolean).map((f) => {
      const lines = f.split('\n');
      return { event: lines[0]!.replace('event: ', ''), data: JSON.parse(lines[1]!.replace('data: ', '')) as RunEvent };
    });
    return { res, frames };
  };

  it('has SSE headers, event name equals data.type, order start -> ... -> end, terminal last and unique', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const { body } = await json('POST', `/sessions/${sid}/messages`, { texto: 'oi' });
    const { res, frames } = await sse(body.runId);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(frames.map((f) => f.event)).toEqual(['start', 'text', 'text', 'tool', 'end']);
    for (const f of frames) expect(f.event).toBe(f.data.type);
    expect(frames.filter((f) => ['end', 'error', 'cancelled'].includes(f.event))).toHaveLength(1);
    expect((frames[1]!.data as { delta: string }).delta + (frames[2]!.data as { delta: string }).delta).toBe('ab');
  });

  it('two clients get identical streams', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const { body } = await json('POST', `/sessions/${sid}/messages`, { texto: 'oi' });
    const [x, y] = await Promise.all([sse(body.runId), sse(body.runId)]);
    expect(x.frames).toEqual(y.frames);
  });

  it('error run ends the stream with an error event and stores the message', async () => {
    script = [{ type: 'error', message: 'falhou' }];
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const { body } = await json('POST', `/sessions/${sid}/messages`, { texto: 'oi' });
    const { frames } = await sse(body.runId);
    expect(frames.at(-1)).toMatchObject({ event: 'error', data: { message: 'falhou' } });
    expect(repos.runs.get(body.runId)).toMatchObject({ status: 'erro', erro: 'falhou' });
  });

  it('after the run left memory (restart), stream falls back to the stored outcome', async () => {
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const { body } = await json('POST', `/sessions/${sid}/messages`, { texto: 'oi' });
    await executor.idle();
    const fresh = new Executor({ repos, resolveAdapter: () => adapter });
    const app2 = buildApp({ repos, executor: fresh, workspaceRoots: [tmpdir()] });
    const res = await app2.inject({ method: 'GET', url: `/runs/${body.runId}/stream` });
    expect(res.body).toContain('event: start');
    expect(res.body).toContain('event: end');
    // cancelled / error outcomes
    const run = repos.runs.start({ provedor: 'claude-cli', sessionId: sid });
    repos.runs.finish(run.id, { status: 'cancelado' });
    expect((await app2.inject({ method: 'GET', url: `/runs/${run.id}/stream` })).body).toContain('event: cancelled');
    const run2 = repos.runs.start({ provedor: 'claude-cli', sessionId: sid });
    repos.runs.finish(run2.id, { status: 'erro', erro: 'x' });
    expect((await app2.inject({ method: 'GET', url: `/runs/${run2.id}/stream` })).body).toContain('"message":"x"');
    await app2.close();
  });
});

describe('cancel endpoint', () => {
  it('404 unknown, 409 finished, and finished-after-restart is also 409', async () => {
    expect((await json('POST', '/runs/nope/cancel')).status).toBe(404);
    const sid = (await json('POST', '/sessions', {})).body.session.id;
    const { body } = await json('POST', `/sessions/${sid}/messages`, { texto: 'oi' });
    await executor.idle();
    const r = await json('POST', `/runs/${body.runId}/cancel`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('run_finished');
  });
});

describe('bind address', () => {
  it('the server entrypoint passes only the config host (127.0.0.1) to listen', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/listen\(\{\s*host:\s*config\.host/);
    expect(src).not.toMatch(/0\.0\.0\.0|'::'/);
  });

  it('listening on 127.0.0.1 is reachable there', async () => {
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });
});

describe('GET /runs/live', () => {
  it('lists the runs in progress with agent, ticket and project, and drops finished ones', async () => {
    const project = repos.projects.create({ nome: 'Alfa', pasta: dir });
    const session = repos.sessions.create({ projectId: project.id });
    const live = repos.runs.start({ provedor: 'claude-cli', sessionId: session.id, modelo: 'sonnet' });
    const done = repos.runs.start({ provedor: 'ollama', sessionId: session.id });
    repos.runs.finish(done.id, { status: 'ok' });
    const res = await app.inject({ method: 'GET', url: '/runs/live' });
    expect(res.statusCode).toBe(200);
    const runs = res.json().runs as Array<{ id: string; provedor: string; projectId: string | null; ticket: unknown }>;
    expect(runs.map((r) => r.id)).toEqual([live.id]);
    expect(runs[0]).toMatchObject({ provedor: 'claude-cli', projectId: project.id, ticket: null });
  });
});
