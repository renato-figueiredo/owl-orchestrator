import { createRepos, migrate, openDb } from '@owl/db';
import { describe, expect, it, vi } from 'vitest';
import type { BoardFlow } from './board-flow.js';
import { Monitor } from './monitor.js';
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
  const board = { openBlockers: (id: string) => blockers.get(id) ?? [] };
  const flow = { run: vi.fn(() => ({ id: 'run' })) };
  const monitor = new Monitor({ repos, router, board: board as never, flow: flow as unknown as BoardFlow });
  const ticket = (titulo: string, extra: Record<string, unknown> = {}) => {
    const t = repos.tickets.create({ projectId: project.id, titulo, status: 'backlog', ...extra } as never, { tipo: 'humano', nome: 'x' } as never);
    repos.tickets.setAssignee(t.id, agentId);
    return repos.tickets.get(t.id)!;
  };
  const used = (tokens: number) => db.prepare("INSERT INTO runs (id, provedor, status, tokens_in, tokens_out, inicio) VALUES (?, 'x', 'ok', ?, 0, datetime('now'))").run(`u${tokens}${Math.random()}`, tokens);
  return { db, repos, project, router, monitor, flow, blockers, ticket, used };
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

  it('without a daily budget it does not start tickets', async () => {
    const { monitor, flow } = setup(null);
    monitor.save({ ativo: true });
    await monitor.tick();
    expect(monitor.status().estado.parado).toBe('sem orçamento diário');
    expect(flow.run).not.toHaveBeenCalled();
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
