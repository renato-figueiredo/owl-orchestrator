import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepos, MIGRATIONS_DIR, migrate, openDb, type Db } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { agentActor, BoardError, HUMAN, LocalBoard } from './index.js';

const dbs: Db[] = [];
const dirs: string[] = [];
afterEach(() => {
  dbs.splice(0).forEach((d) => d.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function setup() {
  const db = openDb();
  dbs.push(db);
  migrate(db);
  const repos = createRepos(db);
  const board = new LocalBoard(repos);
  const project = repos.projects.create({ nome: 'Owl Teste', pasta: '/tmp/x' });
  const make = (extra: Partial<Parameters<LocalBoard['createTicket']>[0]> = {}) => board.createTicket({ projectId: project.id, titulo: 'T', ...extra }, HUMAN);
  return { db, repos, board, project, make };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof BoardError ? e.code : 'other';
  }
  return 'none';
};
const count = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const dev = agentActor('dev-back');

describe('quadro avancado: lacunas (QA)', () => {
  it('ciclo longo de bloqueio (A>B>C>D, D>A) e recusado; sem ciclo em relacionado/duplicado', () => {
    const { board, make } = setup();
    const [a, b, c, d] = [make(), make(), make(), make()];
    board.addRelation(a.id, b.id, 'bloqueia', HUMAN);
    board.addRelation(b.id, c.id, 'bloqueia', HUMAN);
    board.addRelation(c.id, d.id, 'bloqueia', HUMAN);
    expect(code(() => board.addRelation(d.id, a.id, 'bloqueia', HUMAN))).toBe('blocking_loop');
    expect(code(() => board.addRelation(d.id, b.id, 'bloqueia', HUMAN))).toBe('blocking_loop');
    // diamante nao e ciclo
    board.addRelation(a.id, c.id, 'bloqueia', HUMAN);
    board.addRelation(a.id, d.id, 'bloqueia', HUMAN);
    // apos remover um elo, o ciclo deixa de existir
    const r = board.detail(b.id).relacoes.saem[0]!;
    board.removeRelation(r.id, HUMAN);
    board.addRelation(d.id, b.id, 'bloqueia', HUMAN);
    // relacionado/duplicado em "ciclo" e permitido
    board.addRelation(a.id, b.id, 'relacionado', HUMAN);
    board.addRelation(b.id, c.id, 'relacionado', HUMAN);
    board.addRelation(c.id, a.id, 'relacionado', HUMAN);
  });

  it('duplicado: sem direcao (b->a repetido recusado), historico nos dois lados, nao bloqueia agente', () => {
    const { board, make } = setup();
    const [a, b] = [make({ status: 'em_andamento' }), make({ status: 'pronto' })];
    board.addRelation(a.id, b.id, 'duplicado', HUMAN);
    expect(code(() => board.addRelation(b.id, a.id, 'duplicado', HUMAN))).toBe('relation_exists');
    expect(board.detail(a.id).events.some((e) => e.tipo === 'relacao' && e.para === `duplicado ${b.identificador}`)).toBe(true);
    expect(board.detail(b.id).events.some((e) => e.tipo === 'relacao' && e.para === `duplicado (de ${a.identificador})`)).toBe(true);
    expect(board.openBlockers(b.id)).toEqual([]);
    expect(board.updateStatus(b.id, 'em_andamento', dev).status).toBe('em_andamento');
  });

  it('relacionado nao bloqueia; so "bloqueia" impede o agente; dois bloqueadores exigem ambos concluidos', () => {
    const { board, make } = setup();
    const [x, y, z] = [make({ status: 'em_andamento' }), make({ status: 'em_andamento' }), make({ status: 'pronto' })];
    board.addRelation(x.id, z.id, 'relacionado', HUMAN);
    expect(board.openBlockers(z.id)).toEqual([]);
    board.addRelation(x.id, z.id, 'bloqueia', HUMAN);
    board.addRelation(y.id, z.id, 'bloqueia', HUMAN);
    expect(board.openBlockers(z.id)).toHaveLength(2);
    board.updateStatus(x.id, 'concluido', HUMAN);
    expect(code(() => board.updateStatus(z.id, 'em_andamento', dev))).toBe('blocked_by_open_ticket');
    board.updateStatus(y.id, 'concluido', HUMAN);
    expect(board.updateStatus(z.id, 'em_andamento', dev).status).toBe('em_andamento');
  });

  it('remover a relacao libera o ticket bloqueado; o bloqueado nao bloqueia o bloqueador', () => {
    const { board, make } = setup();
    const [a, b] = [make({ status: 'pronto' }), make({ status: 'pronto' })];
    const r = board.addRelation(a.id, b.id, 'bloqueia', HUMAN);
    expect(board.openBlockers(a.id)).toEqual([]);
    expect(board.updateStatus(a.id, 'em_andamento', dev).status).toBe('em_andamento');
    board.removeRelation(r.id, HUMAN);
    expect(board.updateStatus(b.id, 'em_andamento', dev).status).toBe('em_andamento');
  });

  it('apagar ticket (repos.tickets.delete) limpa relacoes e etiquetas dele, preservando as dos outros', () => {
    const { db, repos, board, make, project } = setup();
    const [a, b, c] = [make(), make(), make()];
    const l = board.createLabel(project.id, 'bug');
    board.addLabel(a.id, l.id, HUMAN);
    board.addLabel(b.id, l.id, HUMAN);
    board.addRelation(a.id, b.id, 'bloqueia', HUMAN);
    board.addRelation(c.id, a.id, 'relacionado', HUMAN);
    board.addRelation(b.id, c.id, 'duplicado', HUMAN);
    repos.tickets.delete(a.id);
    expect(count(db, `SELECT COUNT(*) n FROM ticket_labels WHERE ticket_id='${a.id}'`)).toBe(0);
    expect(count(db, `SELECT COUNT(*) n FROM ticket_relations WHERE ticket_id='${a.id}' OR related_id='${a.id}'`)).toBe(0);
    expect(count(db, 'SELECT COUNT(*) n FROM ticket_relations')).toBe(1);
    expect(board.detail(b.id).bloqueadoPor).toEqual([]);
    expect(board.detail(b.id).etiquetas.map((x) => x.nome)).toEqual(['bug']);
  });

  it('apagar etiqueta limpa ticket_labels e deixa outras etiquetas; apagar projeto limpa tudo', () => {
    const { db, repos, board, make, project } = setup();
    const t = make();
    const [l1, l2] = [board.createLabel(project.id, 'a'), board.createLabel(project.id, 'b')];
    board.addLabel(t.id, l1.id, HUMAN);
    board.addLabel(t.id, l2.id, HUMAN);
    board.deleteLabel(l1.id);
    expect(count(db, 'SELECT COUNT(*) n FROM ticket_labels')).toBe(1);
    expect(board.detail(t.id).etiquetas.map((x) => x.nome)).toEqual(['b']);
    expect(code(() => board.deleteLabel(l1.id))).toBe('label_not_found');
    const c = board.createCycle(project.id, { inicio: '2026-10-19', fim: '2026-10-20' });
    board.assignCycle(t.id, c.id, HUMAN);
    repos.projects.delete(project.id);
    for (const tb of ['labels', 'ticket_labels', 'cycles', 'ticket_relations', 'tickets']) expect(count(db, `SELECT COUNT(*) n FROM ${tb}`)).toBe(0);
  });

  it('validacao: etiqueta (nome vazio/longo/duplicada/outro projeto, cor invalida, rename duplicado), mesma etiqueta duas vezes', () => {
    const { repos, board, make, project } = setup();
    const other = repos.projects.create({ nome: 'Outro', pasta: '/tmp/y' });
    expect(code(() => board.createLabel(project.id, '   '))).toBe('invalid_label');
    expect(code(() => board.createLabel(project.id, 'x'.repeat(41)))).toBe('invalid_label');
    expect(code(() => board.createLabel(project.id, 'ok', 'red'))).toBe('invalid_color');
    expect(code(() => board.createLabel(project.id, 'ok', '#fff'))).toBe('invalid_color');
    expect(code(() => board.createLabel('nope', 'ok'))).toBe('project_not_found');
    const a = board.createLabel(project.id, 'Bug');
    const b = board.createLabel(project.id, 'Feature');
    expect(code(() => board.createLabel(project.id, 'bug'))).toBe('label_exists');
    expect(code(() => board.updateLabel(b.id, { nome: 'BUG' }))).toBe('label_exists');
    expect(code(() => board.updateLabel(b.id, { cor: 'zzz' }))).toBe('invalid_color');
    expect(board.updateLabel(a.id, { nome: 'bug' }).nome).toBe('bug'); // renomear para si mesmo (caixa) e ok
    expect(board.createLabel(other.id, 'Bug').nome).toBe('Bug'); // mesmo nome em outro projeto
    const t = make();
    const foreign = board.createLabel(other.id, 'X');
    expect(code(() => board.addLabel(t.id, foreign.id, HUMAN))).toBe('other_project');
    expect(code(() => board.addLabel(t.id, 'nope', HUMAN))).toBe('label_not_found');
    board.addLabel(t.id, a.id, HUMAN);
    board.addLabel(t.id, a.id, HUMAN); // idempotente, sem evento duplicado
    expect(board.detail(t.id).events.filter((e) => e.tipo === 'etiqueta')).toHaveLength(1);
    board.removeLabel(t.id, a.id, HUMAN);
    board.removeLabel(t.id, a.id, HUMAN);
    expect(board.detail(t.id).events.filter((e) => e.tipo === 'etiqueta')).toHaveLength(2);
  });

  it('validacao de ciclo: id inexistente, datas malformadas, ciclo vazio tem progresso zerado, nome nulo', () => {
    const { board, project } = setup();
    expect(code(() => board.createCycle('nope', { inicio: '2026-10-19', fim: '2026-10-20' }))).toBe('project_not_found');
    expect(code(() => board.createCycle(project.id, { inicio: '19/10/2026', fim: '2026-10-20' }))).toBe('invalid_date');
    expect(code(() => board.createCycle(project.id, { inicio: '2026-10-19', fim: '2026-13-01' }))).toBe('invalid_date');
    expect(code(() => board.updateCycle('nope', {}))).toBe('cycle_not_found');
    expect(code(() => board.deleteCycle('nope'))).toBe('cycle_not_found');
    const c = board.createCycle(project.id, { inicio: '2026-10-19', fim: '2026-10-19' }); // 1 dia e valido
    expect(board.cycleProgress(c.id)).toEqual({ tickets: 0, concluidos: 0, pontos: 0, pontosConcluidos: 0, semEstimativa: 0, porStatus: {} });
    expect(board.updateCycle(c.id, { nome: 'S1' }).nome).toBe('S1');
    expect(board.updateCycle(c.id, { nome: null }).nome).toBeNull();
  });

  it('numero do ciclo nao e reutilizado apos apagar o ultimo? (documenta comportamento: MAX+1)', () => {
    const { board, project } = setup();
    const c1 = board.createCycle(project.id, { inicio: '2026-10-19', fim: '2026-10-20' });
    const c2 = board.createCycle(project.id, { inicio: '2026-10-21', fim: '2026-10-22' });
    board.deleteCycle(c2.id);
    expect(board.createCycle(project.id, { inicio: '2026-10-23', fim: '2026-10-24' }).numero).toBe(c1.numero + 1);
  });

  it('estimativa 0 conta como estimado; progresso por estimativa ignora sem-estimativa', () => {
    const { board, make, project } = setup();
    const c = board.createCycle(project.id, { inicio: '2026-10-19', fim: '2026-10-20' });
    const t = make({ estimativa: 0 });
    board.assignCycle(t.id, c.id, HUMAN);
    expect(board.cycleProgress(c.id)).toMatchObject({ semEstimativa: 0, pontos: 0 });
  });

  it('migracao 0011 em banco existente (0001-0010 com dados) preserva dados e adiciona colunas/tabelas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-mig-'));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0011')) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = openDb();
    dbs.push(db);
    migrate(db, dir);
    const repos0 = createRepos(db);
    // cria projeto + ticket com o esquema antigo (sem colunas novas)
    const project = repos0.projects.create({ nome: 'Velho', pasta: '/tmp/v' });
    db.prepare("INSERT INTO tickets (id, project_id, titulo, status, numero) VALUES ('t-old', ?, 'antigo', 'backlog', 1)").run(project.id);
    expect(migrate(db)).toEqual(['0011_quadro_avancado.sql', '0012_backfill_numero.sql', '0013_facts_atualizado_em.sql']);
    const row = db.prepare("SELECT titulo, estimativa, prazo, cycle_id FROM tickets WHERE id='t-old'").get();
    expect(row).toEqual({ titulo: 'antigo', estimativa: null, prazo: null, cycle_id: null });
    const board = new LocalBoard(createRepos(db));
    const l = board.createLabel(project.id, 'nova');
    board.addLabel('t-old', l.id, HUMAN);
    expect(board.detail('t-old').etiquetas.map((x) => x.nome)).toEqual(['nova']);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('constraints do banco: auto-relacao e par repetido recusados mesmo fora do LocalBoard', () => {
    const { repos, make } = setup();
    const [a, b] = [make(), make()];
    expect(() => repos.quadro.relations.create(a.id, a.id, 'bloqueia')).toThrow();
    repos.quadro.relations.create(a.id, b.id, 'bloqueia');
    expect(() => repos.quadro.relations.create(a.id, b.id, 'bloqueia')).toThrow();
  });
});
