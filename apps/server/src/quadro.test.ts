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

describe('labels, relations and cycles over HTTP', () => {
  it('labels: create, attach, show on the board, filter data, delete', async () => {
    const pid = await mkProject();
    const t = await mkTicket(pid);
    const l = (await call('POST', `/projects/${pid}/labels`, { nome: 'bug', cor: '#ff0000' })).body.etiqueta;
    expect((await call('POST', `/projects/${pid}/labels`, { nome: 'Bug' })).status).toBe(409);
    expect((await call('POST', `/projects/${pid}/labels`, { nome: 'x', cor: 'vermelho' })).status).toBe(400);
    expect((await call('PUT', `/tickets/${t.id}/labels/${l.id}`)).body.etiquetas).toHaveLength(1);
    const board = (await call('GET', `/projects/${pid}/board`)).body;
    expect(board.tickets[0].etiquetas.map((x: any) => x.nome)).toEqual(['bug']);
    expect(board.etiquetas).toHaveLength(1);
    expect((await call('DELETE', `/labels/${l.id}`)).status).toBe(204);
    expect((await call('GET', `/tickets/${t.id}`)).body.etiquetas).toEqual([]);
  });

  it('relations: validation errors have clear codes, and the detail shows what blocks what', async () => {
    const pid = await mkProject();
    const [a, b] = [await mkTicket(pid), await mkTicket(pid)];
    expect((await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: a.id, tipo: 'bloqueia' })).body.error.code).toBe('self_relation');
    expect((await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: b.id, tipo: 'parecido' })).status).toBe(400);
    const r = await call('POST', `/tickets/${a.id}/relations`, { relacionadoId: b.id, tipo: 'bloqueia' });
    expect(r.status).toBe(201);
    expect((await call('POST', `/tickets/${b.id}/relations`, { relacionadoId: a.id, tipo: 'bloqueia' })).body.error.code).toBe('blocking_loop');
    const board = (await call('GET', `/projects/${pid}/board`)).body;
    expect(board.tickets.find((x: any) => x.id === b.id).bloqueadoPor).toEqual([a.identificador]);
    expect((await call('DELETE', `/relations/${r.body.relacao.id}`)).status).toBe(204);
    expect((await call('GET', `/tickets/${b.id}`)).body.bloqueadoPor).toEqual([]);
  });

  it('cycles: create, assign, progress, patch, delete', async () => {
    const pid = await mkProject();
    const t = await mkTicket(pid, { estimativa: 3, prazo: '2026-11-30' });
    expect(t).toMatchObject({ estimativa: 3, prazo: '2026-11-30' });
    expect((await call('POST', `/projects/${pid}/tickets`, { titulo: 'x', prazo: '30/11' })).status).toBe(400);
    const c = (await call('POST', `/projects/${pid}/cycles`, { nome: 'Sprint 1', inicio: '2026-10-19', fim: '2026-11-01' })).body.ciclo;
    expect(c.numero).toBe(1);
    expect((await call('POST', `/projects/${pid}/cycles`, { inicio: '2026-11-02', fim: '2026-11-01' })).body.error.code).toBe('invalid_period');
    await call('PUT', `/tickets/${t.id}/cycle`, { cicloId: c.id });
    const got = (await call('GET', `/cycles/${c.id}`)).body;
    expect(got.ciclo.progresso).toMatchObject({ tickets: 1, pontos: 3 });
    expect(got.tickets.map((x: any) => x.id)).toEqual([t.id]);
    expect((await call('PATCH', `/cycles/${c.id}`, { nome: 'Renomeado' })).body.ciclo.nome).toBe('Renomeado');
    expect((await call('PATCH', `/tickets/${t.id}`, { estimativa: null, prazo: null })).body.ticket).toMatchObject({ estimativa: null, prazo: null });
    expect((await call('DELETE', `/cycles/${c.id}`)).status).toBe(204);
    expect((await call('GET', `/tickets/${t.id}`)).body.ticket.cicloId).toBeNull();
  });
});

describe('a blocked ticket is not run by an agent', () => {
  async function setupBlocked() {
    const pid = await mkProject();
    const [blocker, waiting] = [await mkTicket(pid), await mkTicket(pid, { status: 'pronto' })];
    await call('POST', `/tickets/${blocker.id}/relations`, { relacionadoId: waiting.id, tipo: 'bloqueia' });
    return { pid, blocker, waiting };
  }

  it('refuses to start, says why, and runs when the person chooses to ignore the block', async () => {
    const { waiting } = await setupBlocked();
    const refused = await call('POST', `/tickets/${waiting.id}/run`, { agente: 'dev-back' });
    expect(refused.status).toBe(202);
    expect(refused.body.runId).toBeNull();
    expect(requests).toHaveLength(0);
    const d = (await call('GET', `/tickets/${waiting.id}`)).body;
    expect(d.ticket.status).toBe('bloqueado');
    expect(d.comments.at(-1).texto).toContain('bloqueado por');

    await call('PATCH', `/tickets/${waiting.id}`, {});
    await call('POST', `/tickets/${waiting.id}/status`, { status: 'pronto' });
    const forced = await call('POST', `/tickets/${waiting.id}/run`, { agente: 'dev-back', ignorarBloqueio: true });
    expect(forced.body.runId).not.toBeNull();
    await executor.idle();
    expect(requests.length).toBeGreaterThan(0);
  });

  it('runs normally once the blocker is done', async () => {
    const { blocker, waiting } = await setupBlocked();
    await call('POST', `/tickets/${blocker.id}/status`, { status: 'concluido' });
    const ok = await call('POST', `/tickets/${waiting.id}/run`, { agente: 'dev-back' });
    expect(ok.body.runId).not.toBeNull();
    await executor.idle();
  });
});
