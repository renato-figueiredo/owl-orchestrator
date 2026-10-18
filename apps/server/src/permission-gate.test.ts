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
    expect(requests[0]!.allowedTools).not.toContain('Bash(pnpm --filter @owl/server exec vitest run:*)');
    expect(repos.tickets.get(id)!.status).toBe('aguardando_aprovacao'); // no QA yet: it waits for the person

    expect((await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado' })).status).toBe(200);
    await settle();
    expect(requests.length).toBeGreaterThanOrEqual(2); // the rerun delivers, so QA follows
    expect(requests[1]!.allowedTools).toContain('Bash(pnpm --filter @owl/server exec vitest run:*)');
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
    expect(gate.retomar?.opcoes).toBeUndefined();
    await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado', comentario: 'Sim, mantenha.' });
    await settle();
    expect(requests.length).toBeGreaterThanOrEqual(2); // the rerun delivers, so QA follows
    expect(requests[1]!.prompt).toContain('Sim, mantenha.');
  });

  it('a dangerous command is asked for alone and is approved only with the command typed exactly', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'Preciso instalar.', denied: [{ name: 'Bash', command: 'pnpm vitest run' }, { name: 'Bash', command: 'pnpm add left-pad', descricao: 'Instalar a dependência' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.motivo).toContain('COMANDO PERIGOSO');
    expect(gate.motivo).toContain('pnpm add left-pad');
    expect(gate.motivo).not.toContain('pnpm vitest run');
    expect(gate.retomar).toMatchObject({ confirmar: 'pnpm add', ferramentas: ['Bash(pnpm add left-pad)'] });

    const no = (b: object) => call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado', ...b });
    expect((await no({})).status).toBe(400);
    expect((await no({ confirmacao: 'pnpm ad' })).status).toBe(400);
    expect((await no({ confirmacao: 'pnpm add left-pad', lembrar: 'projeto' })).status).toBe(400); // dangerous: never remembered
    expect(pendingOf(id)).toHaveLength(1); // nothing was decided, nothing ran
    expect(requests).toHaveLength(1);
    expect((await no({ confirmacao: 'pnpm add' })).status).toBe(200);
    await settle();
    expect(requests[1]!.allowedTools).toContain('Bash(pnpm add left-pad)');
  });

  it('refusing a dangerous command needs no typing', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'x', denied: [{ name: 'Bash', command: 'sudo rm -rf /tmp/x' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect((await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'rejeitado', comentario: 'não' })).status).toBe(200);
  });

  it('every board agent is told how to ask (permission and question protocol)', async () => {
    const id = await start();
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests[0]!.systemAppend).toContain('PERGUNTA:');
  });

  it('the baseline already lets an agent typecheck and install from the lockfile, with output filters', async () => {
    const id = await start();
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const tools = requests[0]!.allowedTools!;
    for (const r of ['Bash(pnpm --filter * typecheck)', 'Bash(pnpm install --frozen-lockfile --offline)', 'Bash(tail:*)']) expect(tools).toContain(r);
  });

  it('a frozen offline install is not a dangerous request', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'x', denied: [{ name: 'Bash', command: 'pnpm install --frozen-lockfile --offline 2>&1 | tail -15' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.motivo).not.toContain('PERIGOSO');
    expect(gate.retomar?.confirmar).toBeUndefined();
  });

  it('"remember" turns an approval into a standing permission for the project, and the next run needs no gate', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'x', denied: [{ name: 'Bash', command: 'pnpm --filter @owl/web exec playwright test e2e/a.spec.ts 2>&1 | tail -5' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.retomar?.ferramentas).toEqual(['Bash(pnpm --filter @owl/web exec playwright test:*)']);
    expect((await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado', lembrar: 'projeto' })).status).toBe(200);
    await settle();
    const pid = repos.tickets.get(id)!.projectId;
    expect((await call('GET', `/projects/${pid}/permissions`)).body.concedidas.map((g: any) => g.regra)).toEqual(['Bash(pnpm --filter @owl/web exec playwright test:*)']);
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests.at(-1)!.allowedTools).toContain('Bash(pnpm --filter @owl/web exec playwright test:*)');
    expect((await call('DELETE', `/projects/${pid}/permissions?regra=${encodeURIComponent('Bash(pnpm --filter @owl/web exec playwright test:*)')}`)).body.concedidas).toEqual([]);
  });

  it("approving the monitor's suggestion grants the rule (for the session when chosen) and closes the card; refusing grants nothing", async () => {
    const id = await start();
    const pid = repos.tickets.get(id)!.projectId;
    const open = async (regra: string) => {
      const card = (await call('POST', `/projects/${pid}/tickets`, { titulo: `liberar ${regra}` })).body.ticket.id as string;
      const a = repos.approvals.create({ ticketId: card, motivo: 'm', tipo: 'permissao', retomar: { conceder: { regra }, statusAnterior: 'bloqueado' } });
      return { card, a };
    };
    const yes = await open('Bash(make build:*)');
    expect((await call('POST', `/approvals/${yes.a.id}/decide`, { decisao: 'aprovado', lembrar: 'sessao' })).status).toBe(200);
    const granted = (await call('GET', `/projects/${pid}/permissions`)).body.concedidas;
    expect(granted).toMatchObject([{ regra: 'Bash(make build:*)', origem: 'monitor' }]);
    expect(granted[0].expiraEm).not.toBeNull();
    expect(repos.tickets.get(yes.card)!.status).toBe('concluido');
    const no = await open('Bash(make clean:*)');
    expect((await call('POST', `/approvals/${no.a.id}/decide`, { decisao: 'rejeitado', comentario: 'não' })).status).toBe(200);
    expect((await call('GET', `/projects/${pid}/permissions`)).body.concedidas).toHaveLength(1);
    expect(repos.tickets.get(no.card)!.status).toBe('concluido');
  });

  it('options the agent offers with its question travel with the gate and stay out of the question text', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'Li.\nPERGUNTA: Sem entrada ou texto gerado?\nOPCOES: Sem entrada | Texto gerado | Outra coisa' }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.motivo).toBe('Sem entrada ou texto gerado?');
    expect(gate.retomar?.opcoes).toEqual(['Sem entrada', 'Texto gerado', 'Outra coisa']);
  });

  it('a chain with one dangerous part is asked about by that part alone, and approving still lets the whole line run', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'x', denied: [{ name: 'Bash', command: 'pnpm exec vitest run src/a.test.ts 2>&1 | tail -5; rm src/tmp.test.ts; git status --short', descricao: 'limpar' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const gate = pendingOf(id)[0]!;
    expect(gate.motivo).toContain('rm src/tmp.test.ts');
    expect(gate.motivo).not.toContain('vitest');
    expect(gate.retomar?.confirmar).toBe('rm');
    expect(gate.retomar?.ferramentas).toEqual(['Bash(rm src/tmp.test.ts)', 'Bash(pnpm exec vitest run:*)', 'Bash(git status --short:*)']);
  });

  it('what a person approved for a ticket still applies to its later runs (a question or a rework would lose it)', async () => {
    const id = await start();
    script = [{ type: 'end', result: 'x', denied: [{ name: 'Bash', command: 'make docs' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    await call('POST', `/approvals/${pendingOf(id)[0]!.id}/decide`, { decisao: 'aprovado' });
    await settle();
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests.at(-1)!.allowedTools).toContain('Bash(make docs:*)');
    const other = await start(); // another ticket does not inherit it
    await call('POST', `/tickets/${other}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests.at(-1)!.allowedTools).not.toContain('Bash(make docs:*)');
  });

  it('a command asked three times on a ticket stops the loop: the ticket is blocked with a note instead of another gate', async () => {
    const id = await start();
    for (let i = 0; i < 3; i++) repos.approvals.decide(repos.approvals.create({ ticketId: id, motivo: 'dev-back pede permissão para rodar:\nmake docs', tipo: 'permissao' }).id, 'aprovado');
    script = [{ type: 'end', result: 'x', denied: [{ name: 'Bash', command: 'make docs' }] }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(pendingOf(id)).toHaveLength(0);
    expect(repos.tickets.get(id)!.status).toBe('bloqueado');
    expect(repos.tickets.comments(id).some((c) => c.texto.includes('Parei de perguntar'))).toBe(true);
  });

  it('a developer who changes nothing for the third run in a row is handed to a person instead of looping', async () => {
    const id = await start();
    for (let i = 0; i < 2; i++) repos.tickets.addComment({ ticketId: id, ator: { tipo: 'sistema', nome: 'sistema' }, texto: 'O agente não alterou nenhum arquivo.' });
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(repos.tickets.get(id)!.status).toBe('bloqueado');
    expect(repos.tickets.comments(id).some((c) => c.texto.includes('execuções seguidas sem alterar'))).toBe(true);
    expect(requests).toHaveLength(1); // no QA round was started
  });

  it('PROXIMO lines become continuation tickets that wait for this one; auto-sequence makes them ready', async () => {
    const id = await start();
    const pid = repos.tickets.get(id)!.projectId;
    script = [{ type: 'end', result: 'Feito.\nPROXIMO: Cobrir com teste | só o caso feliz\nPROXIMO: Documentar o endpoint' }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const kids = repos.tickets.list(pid).filter((t) => t.id !== id);
    expect(kids.map((k) => [k.titulo, k.status]).sort()).toEqual([['Cobrir com teste', 'backlog'], ['Documentar o endpoint', 'backlog']]);
    expect(kids[0]!.descricao).toContain('Continuação (nível 1) de');
    expect(repos.quadro.relations.openBlockers(kids[0]!.id).map((b) => b.id)).toEqual([id]); // waits for this ticket
    expect(repos.tickets.comments(id).some((c) => c.texto.includes('Continuação aberta no backlog'))).toBe(true);

    // the same title is not opened twice, and with auto-sequence the new one is ready for the monitor
    repos.settings.set('monitor', { autoSequencia: true });
    script = [{ type: 'end', result: 'Feito de novo.\nPROXIMO: Cobrir com teste\nPROXIMO: Medir o tempo' }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    const all = repos.tickets.list(pid).filter((t) => t.id !== id);
    expect(all.filter((k) => k.titulo === 'Cobrir com teste')).toHaveLength(1);
    expect(all.find((k) => k.titulo === 'Medir o tempo')!.status).toBe('pronto');
  });

  it('a chain of continuations stops at the third level', async () => {
    const id = await start();
    repos.tickets.update(id, { descricao: 'Continuação (nível 3) de X-1.' });
    script = [{ type: 'end', result: 'Feito.\nPROXIMO: Mais um passo' }];
    await call('POST', `/tickets/${id}/run`, { agente: 'dev-back' });
    await settle();
    expect(repos.tickets.list(repos.tickets.get(id)!.projectId)).toHaveLength(1);
    expect(repos.tickets.comments(id).some((c) => c.texto.includes('3ª seguida'))).toBe(true);
  });

  it('approving the backlog review deletes only what is still untouched backlog; refusing deletes nothing', async () => {
    const pid = (await call('POST', '/projects', { nome: 'B', pasta: dir })).body.project.id as string;
    const mk = async (titulo: string) => (await call('POST', `/projects/${pid}/tickets`, { titulo })).body.ticket.id as string;
    const stale = await mk('parado');
    const moved = await mk('andou');
    repos.tickets.setStatus(moved, 'pronto'); // someone picked it up after the card was opened
    const card = await mk('Revisão do backlog: 2 tickets parados');
    const gate = repos.approvals.create({ ticketId: card, motivo: 'Apagar 2 ticket(s) (apagar)', tipo: 'destrutiva', retomar: { acao: 'limpar_backlog', ids: [stale, moved] } });
    expect((await call('POST', `/approvals/${gate.id}/decide`, { decisao: 'aprovado' })).status).toBe(200);
    expect(repos.tickets.get(stale)).toBeUndefined();
    expect(repos.tickets.get(moved)).toBeDefined();
    expect(repos.tickets.get(card)!.status).toBe('concluido');

    const keep = await mk('fica');
    const card2 = await mk('Revisão do backlog: 1 ticket parado');
    const gate2 = repos.approvals.create({ ticketId: card2, motivo: 'Apagar 1 (apagar)', tipo: 'destrutiva', retomar: { acao: 'limpar_backlog', ids: [keep] } });
    await call('POST', `/approvals/${gate2.id}/decide`, { decisao: 'rejeitado', comentario: 'manter' });
    expect(repos.tickets.get(keep)).toBeDefined();
    expect(repos.tickets.get(card2)!.status).toBe('concluido');
  });
});
