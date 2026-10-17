/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API in a test */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunEvent, RunRequest } from '@owl/core';
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
let script: Array<Extract<RunEvent, { type: 'end' }>>;

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  run(req) {
    requests.push(req);
    const end = script.shift() ?? { type: 'end', result: 'feito' };
    return (async function* () {
      yield { type: 'usage', inputTokens: 10, outputTokens: 5 } as const;
      yield end;
    })();
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'owl-perm-'));
  wt = mkdtempSync(join(tmpdir(), 'owl-perm-wt-'));
  for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']]) execFileSync('git', args, { cwd: dir });
  requests = [];
  script = [];
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
const settle = async () => {
  for (let i = 0; i < 50; i++) {
    if (repos.runs.running().length === 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
};
const start = async () => {
  const pid = (await call('POST', '/projects', { nome: 'P', pasta: dir })).body.project.id as string;
  const t = (await call('POST', `/projects/${pid}/tickets`, { titulo: 'T' })).body.ticket;
  return t.id as string;
};
const pendingOf = (id: string) => repos.approvals.pendingByTicket(id);

describe('permission requests and questions', () => {
  it('a refused command opens a gate with the command and its reason; approving reruns the step with exactly that command allowed', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'Não consegui testar.', denied: [{ name: 'Bash', command: 'pnpm --filter @owl/server exec vitest run src/x.test.ts', descricao: 'Rodar o teste do ticket' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.tipo).toBe('permissao');
    expect(gate.motivo).toContain('pnpm --filter @owl/server exec vitest run src/x.test.ts');
    expect(gate.motivo).toContain('Rodar o teste do ticket');
    expect(requests[0]!.allowedTools).not.toContain('Bash(pnpm --filter @owl/server exec vitest run src/x.test.ts)');
    expect(repos.tickets.get(id)!.status).toBe('aguardando_aprovacao'); // no QA yet: it waits for the person

    expect((await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado' })).status).toBe(200);
    await settle();
    expect(requests.length).toBeGreaterThanOrEqual(2); // the rerun delivers, so QA follows
    expect(requests[1]!.allowedTools).toContain('Bash(pnpm --filter @owl/server exec vitest run src/x.test.ts)');
    // the permission is for that step only: the next run starts from the agent's own list again
    const again = await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    expect(again.status).toBeLessThan(500);
  });

  it('refusing sends the agent on without the command, and tells it so', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'Preciso rodar.', denied: [{ name: 'Bash', command: 'pnpm lint' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect((await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'rejeitado', comentario: 'não rode o lint inteiro' })).status).toBe(200);
    await settle();
    expect(requests.length).toBeGreaterThanOrEqual(2); // the rerun delivers, so QA follows
    expect(requests[1]!.allowedTools).not.toContain('Bash(pnpm lint)');
    expect(requests[1]!.prompt).toContain('permissão pedida foi recusada');
  });

  it('a reply that ends with PERGUNTA: becomes a gate, and the answer goes back to the agent', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'Li o código.\nPERGUNTA: Devo manter a coluna antiga por compatibilidade?' }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.tipo).toBe('pergunta');
    expect(gate.motivo).toBe('Devo manter a coluna antiga por compatibilidade?');
    await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado', comentario: 'Sim, mantenha.' });
    await settle();
    expect(requests.length).toBeGreaterThanOrEqual(2); // the rerun delivers, so QA follows
    expect(requests[1]!.prompt).toContain('Sim, mantenha.');
  });

  it('every board agent is told how to ask (permission and question protocol)', async () => {
    const id = await start();
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests[0]!.systemAppend).toContain('PERGUNTA:');
  });
});
