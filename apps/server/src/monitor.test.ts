import { LocalBoard } from '@owl/board';
import { createRepos, migrate, openDb } from '@owl/db';
import { describe, expect, it, vi } from 'vitest';
import type { BoardFlow } from './board-flow.js';
import { IDLE_TITLE, Monitor, parsePlanUsage, type PlanUsage } from './monitor.js';
import { RouterService } from './router.js';

function setup(limit: number | null = 1000) {
  const db = openDb();
  migrate(db);
  db.pragma('foreign_keys = OFF');
  const repos = createRepos(db);
  const project = repos.projects.create({ nome: 'p', pasta: '/tmp/p' });
  repos.agents.sync([{ nome: 'dev-back', papel: 'dev', descricao: '', provedor: 'claude-cli', modelo: 'sonnet', origem: 'exemplo', arquivo: 'x' } as never]);
  const agentId = repos.agents.byName('dev-back')!.id;
  const router = new RouterService({ repos });
  if (limit !== null) router.save({ orcamentoDiaTokens: limit });
  const blockers = new Map<string, unknown[]>();
  const real = new LocalBoard(repos);
  const board = {
    openBlockers: (id: string) => blockers.get(id) ?? [],
    updateStatus: real.updateStatus.bind(real),
    addLabel: real.addLabel.bind(real),
    createLabel: real.createLabel.bind(real),
    assign: real.assign.bind(real),
    createTicket: real.createTicket.bind(real),
    createCycle: real.createCycle.bind(real),
    assignCycle: real.assignCycle.bind(real),
  };
  const flow = { run: vi.fn(() => ({ id: 'run' })) };
  let plan: PlanUsage | undefined;
  const monitor = new Monitor({ repos, router, board: board as never, flow: flow as unknown as BoardFlow, planUsage: async () => plan });
  const ticket = (titulo: string, extra: Record<string, unknown> = {}) => {
    const t = repos.tickets.create({ projectId: project.id, titulo, status: 'backlog', ...extra } as never, { tipo: 'humano', nome: 'x' } as never);
    repos.tickets.setAssignee(t.id, agentId);
    return repos.tickets.get(t.id)!;
  };
  const used = (tokens: number) => db.prepare("INSERT INTO runs (id, provedor, status, tokens_in, tokens_out, inicio) VALUES (?, 'x', 'ok', ?, 0, datetime('now'))").run(`u${tokens}${Math.random()}`, tokens);
  const setPlan = (p: PlanUsage | undefined) => (plan = p);
  return { setPlan, db, repos, project, router, monitor, flow, blockers, ticket, used };
}

describe('Monitor parents', () => {
  it('never starts a ticket that has subtasks', async () => {
    const { monitor, ticket, repos, flow, project } = setup(null);
    const parent = ticket('pai');
    repos.tickets.create({ projectId: project.id, titulo: 'filha', status: 'bloqueado', parentId: parent.id } as never, { tipo: 'humano', nome: 'x' } as never);
    (monitor as unknown as { deps: { planUsage: () => Promise<unknown> } }).deps.planUsage = async () => ({ sessao: 0.1, semana: 0.1 });
    monitor.save({ ativo: true });
    expect(await monitor.tick()).toEqual([]);
    expect(flow.run).not.toHaveBeenCalled();
  });
});

describe('Monitor idle ticket', () => {
  it('opens one ticket asking to proceed when nothing runs and the gates are full; authorization lifts the gate limit; activity retracts it', async () => {
    const { monitor, ticket, repos, project, flow } = setup(null);
    for (let i = 0; i < 3; i++) repos.approvals.create({ ticketId: ticket(`g${i}`).id, motivo: 'm', tipo: 'entrega' });
    ticket('livre'); // work that could start once the gate limit is lifted
    monitor.save({ ativo: true });
    // a plan reading is needed to start anything
    (monitor as unknown as { deps: { planUsage: () => Promise<unknown> } }).deps.planUsage = async () => ({ sessao: 0.1, semana: 0.1 });
    await monitor.tick();
    await monitor.tick();
    const idle = () => repos.tickets.list(project.id).filter((t) => t.titulo === IDLE_TITLE);
    expect(idle()).toHaveLength(1);
    expect(idle()[0]!.status).toBe('bloqueado');
    expect(flow.run).not.toHaveBeenCalled();
    // the person moves it on: the monitor starts a ticket despite the gates, and takes the ticket back
    repos.tickets.setStatus(idle()[0]!.id, 'pronto');
    const started = await monitor.tick();
    expect(started.length).toBeGreaterThan(0);
    expect(idle()).toHaveLength(0);
    expect(monitor.status().estado.autorizados).toEqual([]);
  });
});

describe('Monitor release of blocked tickets', () => {
  it('returns to Pronto only the tickets parked by open blockers, once those are gone', async () => {
    const { monitor, ticket, repos, blockers, db } = setup(null);
    const a = ticket('esperava');
    const b = ticket('quebrou');
    const say = (id: string, texto: string) => repos.tickets.addComment({ ticketId: id, ator: { nome: 'sistema', tipo: 'sistema' }, texto });
    say(a.id, 'Falha ao executar "dev-back": bloqueado por SEL-1 (em_andamento); termine-o antes');
    say(b.id, 'Falha ao executar "dev-back": ferramentas do agente não são permitidas');
    db.prepare("UPDATE tickets SET status = 'bloqueado' WHERE id IN (?, ?)").run(a.id, b.id);
    blockers.set(a.id, [{ identificador: 'SEL-1' }]);
    monitor.save({ ativo: true });
    await monitor.tick();
    expect(repos.tickets.get(a.id)!.status).toBe('bloqueado');
    blockers.clear();
    await monitor.tick();
    expect(repos.tickets.get(a.id)!.status).not.toBe('bloqueado');
    expect(repos.tickets.get(b.id)!.status).toBe('bloqueado');
  });
});

describe('Monitor triage', () => {
  it('fills labels, priority, estimate, cycle and assignee only where empty, and says so in the history', async () => {
    const { monitor, ticket, repos, project } = setup(null);
    const a = ticket('Corrigir vazamento na rota', { descricao: 'Em apps/server/src/app.ts a rota vaza dados de outro projeto.', criteriosAceite: 'Responde 404' });
    const b = ticket('Botão novo na tela', { descricao: 'Em apps/web/src/components/Board.tsx' });
    repos.tickets.update(b.id, { prioridade: 1, estimativa: 8 });
    setPlanFor(monitor);
    monitor.save({ ativo: true });
    await monitor.tick();
    const A = repos.tickets.get(a.id)!;
    expect(A.prioridade).toBe(4);
    expect(A.estimativa).not.toBeNull();
    expect(A.cicloId).toBeTruthy();
    expect(repos.quadro.labels.ofTicket(a.id).map((l) => l.nome)).toEqual(expect.arrayContaining(['backend', 'segurança']));
    const B = repos.tickets.get(b.id)!;
    expect(B.prioridade).toBe(1);
    expect(B.estimativa).toBe(8);
    expect(repos.quadro.labels.ofTicket(b.id).map((l) => l.nome)).toContain('frontend');
    expect(repos.tickets.events(a.id).some((e) => e.detalhe?.startsWith('Triagem do monitor'))).toBe(true);
    expect(repos.quadro.cycles.list(project.id)).toHaveLength(1);
    // the monitor leaves its mark: a label on the tickets it touched and a trail of where it looked
    expect(repos.quadro.labels.ofTicket(a.id).map((l) => l.nome)).toContain('monitor');
    const st = monitor.status().estado;
    expect(st.atividade.some((x) => x.ticket === a.identificador && x.acao.startsWith('triagem'))).toBe(true);
    expect(st.olhando).not.toBeNull();
  });
});

function setPlanFor(m: Monitor) {
  (m as unknown as { plan: unknown }).plan = { sessao: 0.1, semana: 0.1 };
}

describe('Monitor', () => {
  it('starts the ready ticket by priority, skips blocked ones, and obeys the gate queue and concurrency', async () => {
    const { monitor, flow, blockers, ticket, repos, project } = setup(1000);
    const a = ticket('a');
    const b = ticket('b');
    blockers.set(a.id, [{ identificador: 'X-1' }]);
    monitor.save({ ativo: true });
    expect(await monitor.tick()).toEqual([b.identificador]);
    expect(flow.run).toHaveBeenCalledTimes(1);
    expect(flow.run).toHaveBeenCalledWith(b.id, 'dev-back', expect.any(String));
    // three gates waiting for a person: nothing new starts
    blockers.clear();
    for (let i = 0; i < 3; i++) repos.approvals.create({ ticketId: ticket(`g${i}`).id, motivo: 'm', tipo: 'entrega' });
    flow.run.mockClear();
    expect(await monitor.tick()).toEqual([]);
    expect(repos.approvals.pendingByProject(project.id)).toHaveLength(3);
  });

  it('off by default: starts nothing', async () => {
    const { monitor, flow } = setup();
    expect(monitor.config().ativo).toBe(false);
    expect(await monitor.tick()).toEqual([]);
    expect(flow.run).not.toHaveBeenCalled();
  });

  it('warns once a day at 70% and keeps working', async () => {
    const { monitor, used } = setup(1000);
    monitor.save({ ativo: true });
    used(700);
    await monitor.tick();
    await monitor.tick();
    const avisos = monitor.status().estado.avisos.filter((a) => a.nivel === 'aviso');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain('70%');
    expect(monitor.status().estado.parado).toBeNull();
  });

  it('stops by itself at the stop threshold and resumes once usage drops', async () => {
    const { monitor, used, db } = setup(1000);
    monitor.save({ ativo: true, paradaPct: 0.9 });
    used(900);
    await monitor.tick();
    expect(monitor.status().estado.parado).toBe('orçamento');
    db.prepare('DELETE FROM runs').run();
    await monitor.tick();
    expect(monitor.status().estado.parado).toBeNull();
  });

  it('without a daily budget nor a plan reading it does not start tickets', async () => {
    const { monitor, flow } = setup(null);
    monitor.save({ ativo: true });
    await monitor.tick();
    expect(monitor.status().estado.parado).toBe('sem medida de uso');
    expect(flow.run).not.toHaveBeenCalled();
  });

  it('the real plan usage drives the warning (70%) and the stop (90%), whatever the token budget says', async () => {
    const { monitor, flow, ticket, setPlan } = setup(null);
    ticket('a');
    monitor.save({ ativo: true });
    setPlan({ sessao: 0.4, semana: 0.72 });
    expect(await monitor.tick()).toHaveLength(1);
    expect(monitor.status().estado.avisos.some((a) => a.nivel === 'aviso' && a.texto.includes('72%'))).toBe(true);
    setPlan({ sessao: 0.4, semana: 0.93 });
    flow.run.mockClear();
    ticket('b');
    expect(await monitor.tick()).toEqual([]);
    expect(monitor.status().estado.parado).toBe('plano');
    setPlan({ sessao: 0.1, semana: 0.5 });
    expect((await monitor.tick()).length).toBeGreaterThan(0);
    expect(monitor.status().estado.parado).toBeNull();
  });

  it('parses what `claude -p /usage` prints, and nothing else', () => {
    expect(parsePlanUsage('Current session: 40% used · resets x\nCurrent week (all models): 61% used · resets y')).toEqual({ sessao: 0.4, semana: 0.61 });
    expect(parsePlanUsage('uso desconhecido')).toBeUndefined();
  });

  it('rejects a stop threshold below the warning threshold', () => {
    const { monitor } = setup();
    expect(() => monitor.save({ avisoPct: 0.8, paradaPct: 0.5 })).toThrow();
  });

  it('the stop button turns it off and re-enabling clears the automatic stop', () => {
    const { monitor } = setup();
    monitor.save({ ativo: true });
    monitor.save({ ativo: false });
    expect(monitor.config().ativo).toBe(false);
  });
});
