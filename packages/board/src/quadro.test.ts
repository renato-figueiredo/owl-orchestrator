import { createRepos, migrate, openDb, type Db } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { agentActor, BoardError, HUMAN, LocalBoard } from './index.js';

const dbs: Db[] = [];
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

function setup() {
  const db = openDb();
  dbs.push(db);
  migrate(db);
  const repos = createRepos(db);
  const board = new LocalBoard(repos);
  const project = repos.projects.create({ nome: 'Owl Teste', pasta: '/tmp/x' });
  const other = repos.projects.create({ nome: 'Outro', pasta: '/tmp/y' });
  const make = (extra: Partial<Parameters<LocalBoard['createTicket']>[0]> = {}) => board.createTicket({ projectId: project.id, titulo: 'T', ...extra }, HUMAN);
  return { repos, board, project, other, make };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof BoardError ? e.code : 'other';
  }
  return 'none';
};
const dev = agentActor('dev-back');

describe('labels', () => {
  it('creates, renames and deletes labels per project; names are unique ignoring case', () => {
    const { board, project, other } = setup();
    const bug = board.createLabel(project.id, 'bug', '#ff0000');
    expect(code(() => board.createLabel(project.id, 'BUG'))).toBe('label_exists');
    expect(board.createLabel(other.id, 'bug').id).not.toBe(bug.id); // another project may reuse the name
    expect(code(() => board.createLabel(project.id, '  '))).toBe('invalid_label');
    expect(code(() => board.createLabel(project.id, 'x', 'red'))).toBe('invalid_color');
    expect(board.updateLabel(bug.id, { nome: 'defeito' }).nome).toBe('defeito');
    board.createLabel(project.id, 'feature');
    expect(code(() => board.updateLabel(bug.id, { nome: 'Feature' }))).toBe('label_exists');
    board.deleteLabel(bug.id);
    expect(code(() => board.deleteLabel(bug.id))).toBe('label_not_found');
  });

  it('attaches labels to tickets of the same project only, records history, and deleting a label leaves no trace', () => {
    const { board, repos, project, other, make } = setup();
    const t = make();
    const l = board.createLabel(project.id, 'bug');
    board.addLabel(t.id, l.id, HUMAN);
    board.addLabel(t.id, l.id, HUMAN); // twice: one
    expect(board.detail(t.id).etiquetas.map((x) => x.nome)).toEqual(['bug']);
    expect(code(() => board.addLabel(t.id, board.createLabel(other.id, 'x').id, HUMAN))).toBe('other_project');
    board.removeLabel(t.id, l.id, HUMAN);
    board.addLabel(t.id, l.id, dev);
    expect(board.detail(t.id).events.filter((e) => e.tipo === 'etiqueta').map((e) => [e.autor, e.de, e.para])).toEqual([['humano', null, 'bug'], ['humano', 'bug', null], ['dev-back', null, 'bug']]);
    board.deleteLabel(l.id);
    expect(board.detail(t.id).etiquetas).toEqual([]);
    expect((repos.quadro.labels.ofProject(project.id).get(t.id) ?? []).length).toBe(0);
  });
});

describe('relations', () => {
  it('refuses self, other project, repeated pairs and blocking loops', () => {
    const { board, make, other } = setup();
    const [a, b, c] = [make(), make(), make()];
    const foreign = board.createTicket({ projectId: other.id, titulo: 'F' }, HUMAN);
    expect(code(() => board.addRelation(a.id, a.id, 'bloqueia', HUMAN))).toBe('self_relation');
    expect(code(() => board.addRelation(a.id, foreign.id, 'relacionado', HUMAN))).toBe('other_project');
    expect(code(() => board.addRelation(a.id, 'nope', 'relacionado', HUMAN))).toBe('ticket_not_found');
    board.addRelation(a.id, b.id, 'bloqueia', HUMAN);
    expect(code(() => board.addRelation(a.id, b.id, 'bloqueia', HUMAN))).toBe('relation_exists');
    expect(code(() => board.addRelation(b.id, a.id, 'bloqueia', HUMAN))).toBe('blocking_loop'); // direct loop
    board.addRelation(b.id, c.id, 'bloqueia', HUMAN);
    expect(code(() => board.addRelation(c.id, a.id, 'bloqueia', HUMAN))).toBe('blocking_loop'); // loop through b
    board.addRelation(a.id, c.id, 'relacionado', HUMAN);
    expect(code(() => board.addRelation(c.id, a.id, 'relacionado', HUMAN))).toBe('relation_exists'); // no direction
    board.addRelation(c.id, a.id, 'duplicado', HUMAN); // another type between the same pair is fine
  });

  it('shows both sides, records history on both tickets and removing is clean', () => {
    const { board, make } = setup();
    const [a, b] = [make(), make()];
    const r = board.addRelation(a.id, b.id, 'bloqueia', HUMAN);
    expect(board.detail(a.id).relacoes.saem.map((x) => [x.tipo, x.relatedId])).toEqual([['bloqueia', b.id]]);
    expect(board.detail(b.id).relacoes.entram.map((x) => x.ticketId)).toEqual([a.id]);
    expect(board.detail(b.id).events.some((e) => e.tipo === 'relacao')).toBe(true);
    board.removeRelation(r.id, HUMAN);
    expect(board.detail(b.id).relacoes.entram).toEqual([]);
    expect(code(() => board.removeRelation(r.id, HUMAN))).toBe('relation_not_found');
  });

  it('a blocked ticket is not started by an agent until the blocker is done', () => {
    const { board, make } = setup();
    const blocker = make({ status: 'em_andamento' });
    const waiting = make({ status: 'pronto' });
    board.addRelation(blocker.id, waiting.id, 'bloqueia', HUMAN);
    expect(board.detail(waiting.id).bloqueadoPor.map((x) => x.identificador)).toEqual([blocker.identificador]);
    expect(code(() => board.updateStatus(waiting.id, 'em_andamento', dev))).toBe('blocked_by_open_ticket');
    board.updateStatus(waiting.id, 'em_andamento', HUMAN); // a person may override
    board.updateStatus(waiting.id, 'pronto', HUMAN);
    board.updateStatus(blocker.id, 'concluido', HUMAN);
    expect(board.detail(waiting.id).bloqueadoPor).toEqual([]);
    expect(board.updateStatus(waiting.id, 'em_andamento', dev).status).toBe('em_andamento');
  });

  it('deleting a ticket removes its relations and labels (no orphans)', () => {
    const { board, repos, make, project } = setup();
    const [a, b] = [make(), make()];
    board.addRelation(a.id, b.id, 'relacionado', HUMAN);
    board.addLabel(a.id, board.createLabel(project.id, 'x').id, HUMAN);
    repos.projects.delete(project.id);
    expect(repos.quadro.relations.ofTicket(a.id)).toEqual({ saem: [], entram: [] });
  });
});

describe('cycles', () => {
  it('numbers cycles per project, validates dates, and tracks progress by status and points', () => {
    const { board, make, project, other } = setup();
    const c1 = board.createCycle(project.id, { nome: 'Sprint 1', inicio: '2026-10-19', fim: '2026-11-01' });
    const c2 = board.createCycle(project.id, { inicio: '2026-11-02', fim: '2026-11-15' });
    expect([c1.numero, c2.numero]).toEqual([1, 2]);
    expect(board.createCycle(other.id, { inicio: '2026-10-19', fim: '2026-10-20' }).numero).toBe(1);
    expect(code(() => board.createCycle(project.id, { inicio: '2026-11-02', fim: '2026-11-01' }))).toBe('invalid_period');
    expect(code(() => board.createCycle(project.id, { inicio: '2026-02-30', fim: '2026-03-01' }))).toBe('invalid_date');
    expect(code(() => board.updateCycle(c1.id, { fim: '2026-10-01' }))).toBe('invalid_period');

    const [a, b, c] = [make({ estimativa: 3 }), make({ estimativa: 5 }), make()];
    for (const t of [a, b, c]) board.assignCycle(t.id, c1.id, HUMAN);
    board.updateStatus(a.id, 'concluido', HUMAN);
    board.updateStatus(b.id, 'em_andamento', HUMAN);
    expect(board.cycleProgress(c1.id)).toEqual({ tickets: 3, concluidos: 1, pontos: 8, pontosConcluidos: 3, semEstimativa: 1, porStatus: { concluido: 1, em_andamento: 1, backlog: 1 } });
    // Moving a ticket to another cycle takes it out of the first.
    board.assignCycle(b.id, c2.id, HUMAN);
    expect(board.cycleProgress(c1.id).tickets).toBe(2);
    expect(board.detail(b.id).ciclo).toMatchObject({ numero: 2, progresso: { tickets: 1 } });
    expect(board.detail(b.id).events.filter((e) => e.tipo === 'ciclo').map((e) => [e.de, e.para])).toEqual([[null, 'Ciclo 1'], ['Ciclo 1', 'Ciclo 2']]);
  });

  it('refuses a cycle of another project; deleting a cycle keeps its tickets', () => {
    const { board, make, other, project } = setup();
    const t = make();
    const foreign = board.createCycle(other.id, { inicio: '2026-10-19', fim: '2026-10-20' });
    expect(code(() => board.assignCycle(t.id, foreign.id, HUMAN))).toBe('other_project');
    expect(code(() => board.assignCycle(t.id, 'nope', HUMAN))).toBe('cycle_not_found');
    const c = board.createCycle(project.id, { inicio: '2026-10-19', fim: '2026-10-20' });
    board.assignCycle(t.id, c.id, HUMAN);
    board.deleteCycle(c.id);
    expect(board.getTicket(t.id)).toMatchObject({ cicloId: null });
    expect(board.assignCycle(t.id, null, HUMAN).cicloId).toBeNull();
  });
});

describe('estimate and due date', () => {
  it('are stored on creation and editable', () => {
    const { make, repos } = setup();
    const t = make({ estimativa: 5, prazo: '2026-11-30' });
    expect(t).toMatchObject({ estimativa: 5, prazo: '2026-11-30' });
    repos.tickets.update(t.id, { estimativa: null, prazo: null });
    expect(repos.tickets.get(t.id)).toMatchObject({ estimativa: null, prazo: null });
  });
});
