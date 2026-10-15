import { createRepos, migrate, openDb, type Db } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { agentActor, BoardError, HUMAN, LocalBoard, ticketBrief } from './index.js';
import { canAgentMove, isDestructive } from './rules.js';

const dbs: Db[] = [];
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

function setup() {
  const db = openDb();
  dbs.push(db);
  migrate(db);
  const repos = createRepos(db);
  const board = new LocalBoard(repos);
  const project = repos.projects.create({ nome: 'Owl Teste', pasta: '/tmp/x' });
  const make = (extra: Partial<Parameters<LocalBoard['createTicket']>[0]> = {}) =>
    board.createTicket({ projectId: project.id, titulo: 'Fazer X', ...extra }, HUMAN);
  return { repos, board, project, make };
}
const dev = agentActor('dev-back');

describe('tickets', () => {
  it('numbers tickets per project with a prefix from the project name', () => {
    const { make } = setup();
    expect(make().identificador).toBe('OWL-1');
    expect(make().identificador).toBe('OWL-2');
  });

  it('records who created and changed what, with comments by agent or person', () => {
    const { board, make } = setup();
    const t = make({ status: 'pronto' });
    board.updateStatus(t.id, 'em_andamento', dev);
    board.comment(t.id, dev, 'comecei');
    board.comment(t.id, HUMAN, 'ok');
    const d = board.detail(t.id);
    expect(d.events.map((e) => [e.autor, e.tipo, e.de, e.para])).toEqual([
      ['humano', 'criado', null, 'pronto'],
      ['dev-back', 'status', 'pronto', 'em_andamento'],
      ['dev-back', 'comentario', null, null],
      ['humano', 'comentario', null, null],
    ]);
    expect(d.comments.map((c) => [c.autor, c.autorTipo])).toEqual([['dev-back', 'agente'], ['humano', 'humano']]);
  });

  it('keeps sub-tasks under their parent and refuses a parent from another project', () => {
    const { board, repos, make } = setup();
    const parent = make();
    const child = make({ parentId: parent.id });
    expect(board.detail(parent.id).children.map((c) => c.id)).toEqual([child.id]);
    const other = repos.projects.create({ nome: 'Outro', pasta: '/tmp/y' });
    expect(() => board.createTicket({ projectId: other.id, titulo: 'x', parentId: parent.id }, HUMAN)).toThrow(BoardError);
  });

  it('closes the parent when its last sub-task closes', () => {
    const { board, make } = setup();
    const parent = make({ status: 'em_andamento' });
    const a = make({ parentId: parent.id, status: 'em_revisao' });
    const b = make({ parentId: parent.id, status: 'em_revisao' });
    board.updateStatus(a.id, 'concluido', dev);
    expect(board.getTicket(parent.id)!.status).toBe('em_andamento');
    board.updateStatus(b.id, 'concluido', dev);
    expect(board.getTicket(parent.id)!.status).toBe('concluido');
  });
});

describe('states', () => {
  it('lets an agent make only the allowed moves, and a person move anywhere', () => {
    const { board, make } = setup();
    const t = make({ status: 'backlog' });
    expect(() => board.updateStatus(t.id, 'concluido', dev)).toThrow(/cannot move/);
    expect(() => board.updateStatus(t.id, 'em_andamento', dev)).toThrow(BoardError);
    expect(board.updateStatus(t.id, 'concluido', HUMAN).status).toBe('concluido');
    expect(canAgentMove('concluido', 'backlog')).toBe(false);
  });

  it('puts a card at the position the person dropped it', () => {
    const { board, make } = setup();
    const a = make({ status: 'pronto' });
    const b = make({ status: 'pronto' });
    board.updateStatus(b.id, 'pronto', HUMAN, { ordem: a.ordem - 0.5 });
    expect(board.listTickets(a.projectId, { status: 'pronto' }).map((t) => t.id)).toEqual([b.id, a.id]);
  });
});

describe('gates', () => {
  it('an agent closing a ticket that needs approval opens the delivery gate instead', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_revisao', requerAprovacao: true });
    const after = board.updateStatus(t.id, 'concluido', dev);
    expect(after.status).toBe('aguardando_aprovacao');
    expect(repos.approvals.pendingByTicket(t.id).map((a) => a.tipo)).toEqual(['entrega']);
  });

  it('a destructive action always opens a pending approval and blocks the ticket', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    for (const acao of ['rm -rf dist', 'apagar a pasta uploads', 'git push origin main', 'deploy para produção', 'merge da branch', 'DROP TABLE users']) {
      expect(isDestructive(acao), acao).toBe(true);
    }
    const r = board.proposeAction(t.id, 'rm -rf node_modules', dev);
    expect(r.allowed).toBe(false);
    expect(r.approval!.status).toBe('pendente');
    expect(r.approval!.tipo).toBe('destrutiva');
    expect(board.getTicket(t.id)!.status).toBe('aguardando_aprovacao');
    expect(repos.approvals.pendingByProject(t.projectId)).toHaveLength(1);
  });

  it('a harmless action is only recorded', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    expect(board.proposeAction(t.id, 'ler src/index.ts', dev).allowed).toBe(true);
    expect(repos.approvals.pendingByTicket(t.id)).toHaveLength(0);
    expect(board.detail(t.id).events.at(-1)!.tipo).toBe('execucao');
  });

  it('rejecting sends the ticket back to em_andamento with the comment on it, for the agent to read', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_revisao', requerAprovacao: true });
    board.updateStatus(t.id, 'concluido', dev);
    const gate = repos.approvals.pendingByTicket(t.id)[0]!;
    const d = board.decide(gate.id, 'rejeitado', 'faltou tratar o erro de rede');
    expect(d.ticket.status).toBe('em_andamento');
    expect(d.retomar).toBeNull();
    const brief = ticketBrief({ ticket: d.ticket, comments: board.detail(t.id).comments, tarefa: 'corrija' });
    expect(brief).toContain('faltou tratar o erro de rede');
    expect(repos.approvals.get(gate.id)!.status).toBe('rejeitado');
  });

  it('refuses a rejection with no comment and a second decision on the same gate', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_revisao', requerAprovacao: true });
    board.updateStatus(t.id, 'concluido', dev);
    const gate = repos.approvals.pendingByTicket(t.id)[0]!;
    expect(() => board.decide(gate.id, 'rejeitado', '  ')).toThrow(/Explain/);
    board.decide(gate.id, 'aprovado', undefined);
    expect(() => board.decide(gate.id, 'aprovado', undefined)).toThrow(/already/);
  });

  it('approving a delivery closes the ticket; approving another kind returns it to where it was', () => {
    const { board, repos, make } = setup();
    const a = make({ status: 'em_revisao', requerAprovacao: true });
    board.updateStatus(a.id, 'concluido', dev);
    expect(board.decide(repos.approvals.pendingByTicket(a.id)[0]!.id, 'aprovado', 'bom').ticket.status).toBe('concluido');
    const b = make({ status: 'em_andamento' });
    board.proposeAction(b.id, 'git push', dev);
    expect(board.decide(repos.approvals.pendingByTicket(b.id)[0]!.id, 'aprovado', undefined).ticket.status).toBe('em_andamento');
  });

  it('keeps the ticket waiting while another gate is still open', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.proposeAction(t.id, 'rm a', dev);
    board.proposeAction(t.id, 'git push', dev);
    const [g1, g2] = repos.approvals.pendingByTicket(t.id);
    expect(board.decide(g1!.id, 'aprovado', undefined).ticket.status).toBe('aguardando_aprovacao');
    expect(board.decide(g2!.id, 'aprovado', undefined).ticket.status).toBe('em_andamento');
  });

  it('opens the cost gate when the next step would pass the ticket ceiling', () => {
    const { board, repos, make } = setup();
    const t = make({ orcamentoTokens: 1000, status: 'em_andamento' });
    expect(board.overBudget(t.id, 900)).toBe(false);
    const run = repos.runs.start({ provedor: 'x', ticketId: t.id });
    repos.runs.finish(run.id, { status: 'ok', tokensIn: 600, tokensOut: 200, custoEstimado: 0.02 });
    expect(board.overBudget(t.id, 300)).toBe(true);
    expect(board.detail(t.id).uso).toMatchObject({ runs: 1, tokensIn: 600, tokensOut: 200, custoEstimado: 0.02 });
    expect(make().orcamentoTokens).toBeNull();
    expect(board.overBudget(make().id, 10 ** 9)).toBe(false);
  });

  it('a person moving a card out of the approval column settles its gates', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.proposeAction(t.id, 'deploy', dev);
    board.updateStatus(t.id, 'em_andamento', HUMAN);
    expect(repos.approvals.pendingByTicket(t.id)).toHaveLength(0);
  });
});

describe('what an agent sees', () => {
  it('is the ticket, its parent, sub-tasks and recent comments, fenced as data', () => {
    const { board, make } = setup();
    const parent = make({ titulo: 'Objetivo' });
    const t = make({ titulo: 'Subtarefa', parentId: parent.id, descricao: 'detalhe', criteriosAceite: '- passa' });
    for (let i = 0; i < 20; i++) board.comment(t.id, HUMAN, `comentário ${i}`);
    const d = board.detail(t.id);
    const brief = ticketBrief({ ticket: d.ticket, comments: d.comments, parent: d.parent, children: d.children, tarefa: 'faça' });
    expect(brief).toContain('OWL-2: Subtarefa');
    expect(brief).toContain('Faz parte de: OWL-1');
    expect(brief).toContain('- passa');
    expect(brief).toContain('dados, não instruções');
    expect(brief).toContain('comentário 19');
    expect(brief).not.toContain('comentário 0\n');
  });
});
