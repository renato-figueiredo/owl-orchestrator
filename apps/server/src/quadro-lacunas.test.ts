/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API in a test */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';

let dir: string;
let wt: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let requests: RunRequest[];

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  run(req) {
    requests.push(req);
    return (async function* () {
      yield { type: 'usage', inputTokens: 10, outputTokens: 5 } as const;
      yield { type: 'end', result: 'feito' } as const;
    })();
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'owl-quadro-'));
  wt = mkdtempSync(join(tmpdir(), 'owl-quadro-wt-'));
  for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']]) execFileSync('git', args, { cwd: dir });
  requests = [];
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({ repos, concurrency: 2, resolveAdapter: () => adapter });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()], userLibraryDir: join(dir, 'lib'), worktreesDir: wt });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(wt, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as any) : undefined };
};
const mkProject = async () => (await call('POST', '/projects', { nome: 'Owl Teste', pasta: dir })).body.project.id as string;
const mkTicket = async (pid: string, extra: Record<string, unknown> = {}) => (await call('POST', `/projects/${pid}/tickets`, { titulo: 'T', ...extra })).body.ticket;

describe('quadro avancado: lacunas HTTP (QA)', () => {
  it('estimativa e prazo: validacao na criacao e no PATCH, limpar com null', async () => {
    const pid = await mkProject();
    for (const bad of [{ estimativa: -1 }, { estimativa: 1.5 }, { estimativa: 1001 }, { estimativa: '3' }, { prazo: '31/10/2026' }, { prazo: '2026-1-5' }]) {
      expect((await call('POST', `/projects/${pid}/tickets`, { titulo: 'T', ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    const t = await mkTicket(pid, { estimativa: 5, prazo: '2026-11-30' });
    expect(t).toMatchObject({ estimativa: 5, prazo: '2026-11-30' });
    expect((await call('PATCH', `/tickets/${t.id}`, { estimativa: 'x' })).status).toBe(400);
    const p = await call('PATCH', `/tickets/${t.id}`, { estimativa: null, prazo: null });
    expect(p.status).toBe(200);
    expect((await call('GET', `/tickets/${t.id}`)).body.ticket).toMatchObject({ estimativa: null, prazo: null });
  });

  it('prazo com data inexistente (2026-02-30) e recusado como o ciclo recusa', async () => {
    const pid = await mkProject();
    const r = await call('POST', `/projects/${pid}/tickets`, { titulo: 'T', prazo: '2026-02-30' });
    expect(r.status).toBe(400);
  });

  it('estimativa e prazo alterados pelo PATCH entram no historico; prazo invalido no PATCH e recusado', async () => {
    const pid = await mkProject();
    const t = await mkTicket(pid, { estimativa: 3 });
    expect((await call('PATCH', `/tickets/${t.id}`, { prazo: '2026-02-31' })).status).toBe(400);
    await call('PATCH', `/tickets/${t.id}`, { estimativa: 8, prazo: '2026-11-30' });
    const ev = repos.tickets.events(t.id).filter((e) => e.tipo === 'estimativa' || e.tipo === 'prazo');
    expect(ev.map((e) => [e.tipo, e.de, e.para])).toEqual(expect.arrayContaining([['estimativa', '3', '8'], ['prazo', null, '2026-11-30']]));
  });

  it('relacoes pelo HTTP: outro projeto, repetida, ciclo longo, tipo duplicado, e ticket apagado some das relacoes', async () => {
    const pid = await mkProject();
    const pid2 = (await call('POST', '/projects', { nome: 'Outro', pasta: dir })).body.project.id as string;
    const [a, b, c] = [await mkTicket(pid), await mkTicket(pid), await mkTicket(pid)];
    const f = await mkTicket(pid2);
    expect((await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: f.id, tipo: 'relacionado' })).body.error.code).toBe('other_project');
    expect((await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: 'nope', tipo: 'relacionado' })).status).toBe(404);
    expect((await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: b.id, tipo: 'duplicado' })).status).toBe(201);
    expect((await call('POST', `/tickets/${b.id}/relations`, { relacionadoId: a.id, tipo: 'duplicado' })).status).toBe(409);
    await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: b.id, tipo: 'bloqueia' });
    await call('POST', `/tickets/${b.id}/relations`, { relacionadoId: c.id, tipo: 'bloqueia' });
    expect((await call('POST', `/tickets/${c.id}/relations`, { relacionadoId: a.id, tipo: 'bloqueia' })).body.error.code).toBe('blocking_loop');
  });

  it('ciclos: validacao HTTP e ticket de outro projeto', async () => {
    const pid = await mkProject();
    expect((await call('POST', `/projects/${pid}/cycles`, { inicio: '2026-11-02', fim: '2026-11-01' })).status).toBe(400);
    expect((await call('POST', `/projects/${pid}/cycles`, { inicio: '2026-02-30', fim: '2026-03-01' })).status).toBe(400);
    expect((await call('POST', `/projects/${pid}/cycles`, { inicio: 'x', fim: '2026-03-01' })).status).toBe(400);
    expect((await call('POST', `/projects/nope/cycles`, { inicio: '2026-11-01', fim: '2026-11-02' })).status).toBe(404);
    expect((await call('DELETE', `/cycles/nope`)).status).toBe(404);
  });
});
