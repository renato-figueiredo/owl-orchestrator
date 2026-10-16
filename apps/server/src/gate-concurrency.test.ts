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
/** Replies by agent (matched on its system prompt); a function may look at the request. */
let replies: Record<string, string | ((req: RunRequest) => string)>;
let usage: { in: number; out: number };

const ROLE: Array<[string, string]> = [
  ['product owner', 'po'],
  ['tech lead', 'tech-lead'],
  ['QA', 'qa'],
  ['desenvolvedor de back-end', 'dev-back'],
  ['desenvolvedor de interface', 'dev-front'],
  ['memória do projeto', 'memoria'],
];
const who = (req: RunRequest) => ROLE.find(([k]) => req.systemAppend?.includes(k))?.[1] ?? 'unknown';

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  run(req) {
    requests.push(req);
    return (async function* () {
      const r = replies[who(req)];
      yield { type: 'usage', inputTokens: usage.in, outputTokens: usage.out } as const;
      if (r === undefined) yield { type: 'error', message: `sem resposta para ${who(req)}` } as const;
      else yield { type: 'end', result: typeof r === 'function' ? r(req) : r } as const;
    })();
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'owl-board-'));
  wt = mkdtempSync(join(tmpdir(), 'owl-board-wt-'));
  // Developers write inside a git worktree, so the project folder is a repository (one empty commit is enough).
  for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']]) execFileSync('git', args, { cwd: dir });
  requests = [];
  usage = { in: 100, out: 50 };
  replies = {
    po: '```json\n{"titulo":"Login com e-mail","descricao":"Usuário entra com e-mail e senha","criterios_aceite":["erro claro se a senha falhar","sessão dura 7 dias"]}\n```',
    'tech-lead': '```json\n{"subtarefas":[{"titulo":"API de login","descricao":"POST /login","agente":"dev-back"},{"titulo":"Tela de login","agente":"dev-front"}]}\n```',
    'dev-back': 'Implementei o endpoint.',
    'dev-front': 'Implementei a tela.',
    qa: 'Tudo cobre os critérios.\nVEREDITO: aprovado',
    memoria: '1. Resumo\nLogin entregue.\n\n2. Fatos\n- Sessões duram 7 dias\n- Usar bcrypt\n',
  };
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

const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const post = (path: string, body?: unknown) => call('POST', path, body ?? {});
const mkProject = async () => ((await (await post('/projects', { nome: 'Owl Teste', pasta: dir })).json()) as any).project.id as string;
/** Waits for the chained runs of the flow to drain (each run may start the next before it ends). */
async function settle() {
  for (let i = 0; i < 20; i++) {
    await executor.idle();
    await new Promise((r) => setTimeout(r, 5));
    if (!repos.tickets.list(repos.projects.list()[0]!.id).some((t) => repos.tickets.runs(t.id).some((r) => r.status === 'rodando'))) {
      await executor.idle();
      return;
    }
  }
}


// Prompt 14 (pendência): two people (two tabs, a double click) deciding at the same time must leave one coherent outcome.
async function ticketWithGates(...tipos: Array<'custo' | 'destrutiva' | 'entrega'>) {
  const pid = await mkProject();
  const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'Disputado', responsavel: 'dev-back', status: 'em_andamento' })).json()) as any).ticket.id as string;
  repos.tickets.setStatus(id, 'aguardando_aprovacao');
  const gates = tipos.map((tipo) => repos.approvals.create({ ticketId: id, tipo, motivo: `portão ${tipo}` }));
  return { id, gates };
}
const decide = (gateId: string, decisao: 'aprovado' | 'rejeitado') =>
  post(`/approvals/${gateId}/decide`, decisao === 'aprovado' ? { decisao } : { decisao, comentario: 'não' });

describe('concorrência de portões', () => {
  it('a mesma aprovação enviada duas vezes ao mesmo tempo vale uma só (200 + 409) e roda o passo uma vez', async () => {
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'Caro', responsavel: 'dev-back', orcamentoTokens: 50, status: 'pronto' })).json()) as any).ticket.id as string;
    await post(`/tickets/${id}/run`, {});
    const gate = repos.approvals.pendingByTicket(id)[0]!;
    const rs = await Promise.all([decide(gate.id, 'aprovado'), decide(gate.id, 'aprovado'), decide(gate.id, 'aprovado')]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    await settle();
    expect(requests.filter((r) => who(r) === 'dev-back')).toHaveLength(1);
    expect(repos.tickets.events(id).filter((e: any) => e.tipo === 'aprovacao' && e.de === 'pendente' && e.para === 'aprovado')).toHaveLength(1);
  });

  it('aprovar e rejeitar o mesmo portão juntos: um só vence e o ticket segue o vencedor', async () => {
    const { id, gates } = await ticketWithGates('destrutiva');
    const [a, b] = await Promise.all([decide(gates[0]!.id, 'aprovado'), decide(gates[0]!.id, 'rejeitado')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const final = repos.approvals.get(gates[0]!.id)!;
    expect(['aprovado', 'rejeitado']).toContain(final.status);
    expect(repos.tickets.get(id)!.status).toBe('em_andamento');
    expect(repos.approvals.pendingByTicket(id)).toHaveLength(0);
  });

  it('dois portões do mesmo ticket decididos juntos: nenhum fica pendente e o ticket não fica preso', async () => {
    const { id, gates } = await ticketWithGates('destrutiva', 'entrega');
    const rs = await Promise.all(gates.map((g) => decide(g.id, 'aprovado')));
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(repos.approvals.pendingByTicket(id)).toHaveLength(0);
    expect(repos.tickets.get(id)!.status).toBe('concluido'); // the delivery approved is not lost
  });

  it('um portão aprovado e outro rejeitado ao mesmo tempo: a rejeição devolve o ticket e fecha o outro', async () => {
    const { id, gates } = await ticketWithGates('destrutiva', 'entrega');
    const rs = await Promise.all([decide(gates[0]!.id, 'aprovado'), decide(gates[1]!.id, 'rejeitado')]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(repos.approvals.pendingByTicket(id)).toHaveLength(0);
    expect(repos.tickets.get(id)!.status).not.toBe('aguardando_aprovacao');
  });
});
