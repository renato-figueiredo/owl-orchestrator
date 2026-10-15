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
import { extractJson, parseMemoryOutput, parseVerdict } from './board-flow.js';
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
const get = async <T = any>(path: string) => (await call('GET', path)).json() as Promise<T>;
const mkProject = async () => ((await (await post('/projects', { nome: 'Owl Teste', pasta: dir })).json()) as any).project.id as string;
const board = (pid: string) => get(`/projects/${pid}/board`);
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

describe('example flow: objective → po → tech-lead → dev → qa → approval → memory', () => {
  it('runs the whole chain and stops at the delivery gate', async () => {
    const pid = await mkProject();
    const r = await post(`/projects/${pid}/board/goals`, { objetivo: 'Quero login com e-mail' });
    expect(r.status).toBe(202);
    await settle();

    const b = await board(pid);
    const parent = b.tickets.find((t: any) => !t.parentId);
    expect(parent).toMatchObject({ titulo: 'Login com e-mail', status: 'em_andamento' });
    expect(parent.criteriosAceite).toContain('- sessão dura 7 dias');
    const kids = b.tickets.filter((t: any) => t.parentId === parent.id);
    expect(kids.map((k: any) => [k.titulo, k.responsavel, k.status])).toEqual([
      ['API de login', 'dev-back', 'aguardando_aprovacao'],
      ['Tela de login', 'dev-front', 'aguardando_aprovacao'],
    ]);
    expect(b.aprovacoes.map((a: any) => [a.tipo, a.ticketTitulo])).toEqual([['entrega', 'API de login'], ['entrega', 'Tela de login']]);
    // Agents ran in the order of the flow.
    expect(requests.map(who)).toEqual(['po', 'tech-lead', 'dev-back', 'dev-front', 'qa', 'qa']);

    // History: who did what and what it cost.
    const d = await get(`/tickets/${kids[0].id}`);
    expect(d.events.map((e: any) => [e.autor, e.tipo, e.para])).toEqual(
      expect.arrayContaining([['tech-lead', 'criado', 'pronto'], ['dev-back', 'execucao', null], ['dev-back', 'status', 'em_revisao'], ['qa', 'aprovacao', 'pendente']]),
    );
    expect(d.runs.map((x: any) => x.agente)).toEqual(['dev-back', 'qa']);
    expect(d.uso).toMatchObject({ runs: 2, tokensIn: 200, tokensOut: 100 });
    expect(d.comments.map((c: any) => [c.autor, c.autorTipo])).toEqual([['dev-back', 'agente'], ['sistema', 'sistema'], ['qa', 'agente']]); // the system notes that the developer changed nothing

    // Approve both: the tickets close, the parent closes with the last one, and the memory agent summarizes.
    for (const a of b.aprovacoes) {
      const ok = await post(`/approvals/${a.id}/decide`, { decisao: 'aprovado', comentario: 'ok' });
      expect(ok.status).toBe(200);
    }
    await settle();
    const after = await board(pid);
    expect(after.tickets.map((t: any) => t.status)).toEqual(['concluido', 'concluido', 'concluido']);
    expect(after.aprovacoes).toEqual([]);
    expect(requests.map(who).slice(-2)).toEqual(['memoria', 'memoria']);
    const done = repos.tickets.get(kids[0].id)!;
    expect(done.resumo).toBe('Login entregue.');
    expect(repos.facts.list({ projectId: pid }).map((f) => f.texto)).toEqual(expect.arrayContaining(['Sessões duram 7 dias', 'Usar bcrypt']));
  });

  it('an agent reads only the ticket, its summary and the pinned facts', async () => {
    const pid = await mkProject();
    repos.facts.add({ projectId: pid, texto: 'Sempre usar pnpm', fixado: true });
    repos.facts.add({ projectId: pid, texto: 'Fato solto que não vai', fixado: false });
    const chat = repos.sessions.create({ projectId: pid });
    repos.messages.add({ sessionId: chat.id, papel: 'usuario', conteudo: 'conversa privada do chat' });
    const t = await post(`/projects/${pid}/tickets`, { titulo: 'Corrigir bug', responsavel: 'dev-back', status: 'pronto' });
    const id = ((await t.json()) as any).ticket.id;
    repos.tickets.update(id, { resumo: 'Resumo do ticket' });
    await post(`/tickets/${id}/run`, {});
    await settle();
    const prompt = requests[0]!.prompt;
    expect(prompt).toContain('Sempre usar pnpm');
    expect(prompt).toContain('Resumo do ticket');
    expect(prompt).toContain('OWL-1: Corrigir bug');
    expect(prompt).not.toContain('Fato solto');
    expect(prompt).not.toContain('conversa privada');
  });
});

describe('rejection and gates', () => {
  async function delivered() {
    const pid = await mkProject();
    await post(`/projects/${pid}/board/goals`, { objetivo: 'Login' });
    await settle();
    const b = await board(pid);
    return { pid, gate: b.aprovacoes[0], ticketId: b.aprovacoes[0].ticketId as string };
  }

  it('rejecting returns the ticket to em_andamento, the comment is visible to the agent, who tries again', async () => {
    const { gate, ticketId } = await delivered();
    expect((await post(`/approvals/${gate.id}/decide`, { decisao: 'rejeitado' })).status).toBe(400); // a comment is required
    const before = requests.length;
    replies['dev-back'] = (req) => (req.prompt.includes('falta validar a senha') ? 'Corrigi a validação.' : 'sem leitura');
    const res = await post(`/approvals/${gate.id}/decide`, { decisao: 'rejeitado', comentario: 'falta validar a senha' });
    const body = (await res.json()) as any;
    expect(body.ticket.status).toBe('em_andamento');
    await settle();
    const rerun = requests[before]!;
    expect(who(rerun)).toBe('dev-back');
    expect(rerun.prompt).toContain('falta validar a senha');
    const d = await get(`/tickets/${ticketId}`);
    expect(d.comments.some((c: any) => c.texto === 'Rejeitado: falta validar a senha' && c.autorTipo === 'humano')).toBe(true);
    expect(d.comments.some((c: any) => c.texto === 'Corrigi a validação.')).toBe(true);
    // The rework went back to review → qa → a new delivery gate.
    expect(d.aprovacoes.map((a: any) => [a.tipo, a.status])).toEqual([['entrega', 'rejeitado'], ['entrega', 'pendente']]);
  });

  it('a simulated destructive action always creates a pending approval, and approving frees it', async () => {
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'Limpeza', status: 'em_andamento' })).json()) as any).ticket.id;
    const r = await post(`/tickets/${id}/actions`, { acao: 'rm -rf build/', agente: 'dev-back' });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).permitido).toBe(false);
    const b = await board(pid);
    expect(b.aprovacoes).toHaveLength(1);
    expect(b.tickets[0].status).toBe('aguardando_aprovacao');
    expect((await post(`/tickets/${id}/run`, { agente: 'dev-back' })).status).toBe(409); // paused until decided
    const ok = await post(`/approvals/${b.aprovacoes[0].id}/decide`, { decisao: 'aprovado' });
    expect(((await ok.json()) as any).ticket.status).toBe('em_andamento');
    const safe = await post(`/tickets/${id}/actions`, { acao: 'ler o README' });
    expect(safe.status).toBe(200);
  });

  it('a cost above the ticket ceiling creates an approval instead of running; approving runs that step once', async () => {
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'Caro', responsavel: 'dev-back', orcamentoTokens: 50, status: 'pronto' })).json()) as any).ticket.id;
    const r = await post(`/tickets/${id}/run`, {});
    expect(((await r.json()) as any).runId).toBeNull();
    expect(requests).toHaveLength(0);
    const b = await board(pid);
    expect(b.aprovacoes.map((a: any) => a.tipo)).toEqual(['custo']);
    await post(`/approvals/${b.aprovacoes[0].id}/decide`, { decisao: 'aprovado' });
    await settle();
    expect(requests.map(who)).toEqual(['dev-back']);
    // The step delivered; the next one (qa) is held by the ceiling again: asks, never silently continues.
    expect((await board(pid)).aprovacoes.map((a: any) => a.tipo)).toEqual(['custo']);
  });

  it('rejecting a cost gate does not run anything', async () => {
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'Caro', responsavel: 'dev-back', orcamentoTokens: 50, status: 'pronto' })).json()) as any).ticket.id;
    await post(`/tickets/${id}/run`, {});
    const g = (await board(pid)).aprovacoes[0];
    await post(`/approvals/${g.id}/decide`, { decisao: 'rejeitado', comentario: 'caro demais' });
    await settle();
    expect(requests).toHaveLength(0);
    expect(repos.tickets.get(id)!.status).toBe('em_andamento');
  });

  it('a reproval by qa opens a gate; the author reworks it after the person decides', async () => {
    replies.qa = 'Falta cobrir o erro.\nVEREDITO: reprovado';
    const pid = await mkProject();
    await post(`/projects/${pid}/board/goals`, { objetivo: 'Login' });
    await settle();
    const gates = (await board(pid)).aprovacoes;
    expect(new Set(gates.map((g: any) => g.tipo))).toEqual(new Set(['reprovacao']));
    replies.qa = 'Agora sim.\nVEREDITO: aprovado';
    await post(`/approvals/${gates[0].id}/decide`, { decisao: 'aprovado', comentario: 'concordo, refaça' });
    await settle();
    const t = repos.tickets.get(gates[0].ticketId)!;
    expect(t.status).toBe('aguardando_aprovacao');
    expect(repos.approvals.byTicket(t.id).map((a) => [a.tipo, a.status])).toEqual([['reprovacao', 'aprovado'], ['entrega', 'pendente']]);
  });

  it('an unreadable answer blocks the ticket with an explanation instead of guessing', async () => {
    replies.po = 'Claro! Vou pensar nisso.';
    const pid = await mkProject();
    await post(`/projects/${pid}/board/goals`, { objetivo: 'Algo' });
    await settle();
    const t = (await board(pid)).tickets[0];
    expect(t.status).toBe('bloqueado');
    const d = await get(`/tickets/${t.id}`);
    expect(d.comments.at(-1).texto).toMatch(/Não consegui seguir/);
  });

  it('a failing agent blocks the ticket and says why', async () => {
    delete replies['dev-back'];
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'X', responsavel: 'dev-back', status: 'pronto' })).json()) as any).ticket.id;
    await post(`/tickets/${id}/run`, {});
    await settle();
    expect(repos.tickets.get(id)!.status).toBe('bloqueado');
    expect(repos.tickets.comments(id).at(-1)!.texto).toMatch(/Falha ao executar "dev-back": sem resposta/);
  });
});

describe('API rules', () => {
  it('refuses agent transitions that the rules forbid and unknown things', async () => {
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'X' })).json()) as any).ticket.id;
    const r = await post(`/tickets/${id}/status`, { status: 'concluido', agente: 'dev-back' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error.code).toBe('transition_not_allowed');
    expect((await post(`/tickets/${id}/status`, { status: 'inventado' })).status).toBe(400);
    expect((await post(`/tickets/nao-existe/status`, { status: 'pronto' })).status).toBe(404);
    expect((await post(`/projects/nao-existe/tickets`, { titulo: 'x' })).status).toBe(404);
    expect((await post(`/projects/${pid}/tickets`, { titulo: 'x', responsavel: 'fantasma' })).status).toBe(400);
    expect((await post(`/tickets/${id}/run`, {})).status).toBe(400); // no assignee
    const human = await post(`/tickets/${id}/status`, { status: 'concluido', comentario: 'feito à mão' });
    expect(((await human.json()) as any).ticket.status).toBe('concluido');
  });

  it('keeps ticket conversations out of the chat list', async () => {
    const pid = await mkProject();
    const id = ((await (await post(`/projects/${pid}/tickets`, { titulo: 'X', responsavel: 'dev-back', status: 'pronto' })).json()) as any).ticket.id;
    await post(`/tickets/${id}/run`, {});
    await settle();
    expect(repos.tickets.get(id)!.sessionId).toBeTruthy();
    expect((await get('/sessions')).sessions).toEqual([]);
  });
});

describe('parsers', () => {
  it('extractJson takes the last fenced block or the outermost object', () => {
    expect(extractJson('texto ```json\n{"a":1}\n``` mais ```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(extractJson('aqui: {"a": {"b": 1}} fim')).toEqual({ a: { b: 1 } });
    expect(extractJson('nada')).toBeUndefined();
  });
  it('parseVerdict', () => {
    expect(parseVerdict('ok\nVEREDITO: aprovado')).toBe('aprovado');
    expect(parseVerdict('**Veredito:** Reprovado — falta teste')).toBe('reprovado');
    expect(parseVerdict('talvez')).toBeUndefined();
  });
  it('parseMemoryOutput', () => {
    expect(parseMemoryOutput('1. Resumo\nFeito.\n\n2. Fatos\n- A\n- B')).toEqual({ resumo: 'Feito.', fatos: ['A', 'B'] });
    expect(parseMemoryOutput('Só um resumo').fatos).toEqual([]);
  });
});
