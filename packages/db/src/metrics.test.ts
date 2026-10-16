import { describe, expect, it } from 'vitest';
import { createRepos, migrate, openDb } from './index.js';

function setup() {
  const db = openDb();
  migrate(db);
  db.pragma('foreign_keys = OFF'); // aggregate-only test: the rows below are synthetic
  const add = (id: string, inicio: string, o: { ticket?: string; agent?: string; etapa?: string; status?: string; tin?: number; tout?: number } = {}) =>
    db
      .prepare('INSERT INTO runs (id, ticket_id, agent_id, provedor, modelo, etapa, status, tokens_in, tokens_out, inicio) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, o.ticket ?? null, o.agent ?? null, 'claude-cli', 'sonnet', o.etapa ?? null, o.status ?? 'ok', o.tin ?? 10, o.tout ?? 5, inicio);
  return { repos: createRepos(db), add };
}

describe('metrics period boundaries', () => {
  it('desde is inclusive, ate is exclusive, and month ends roll over', () => {
    const { repos, add } = setup();
    add('a', '2026-01-31 23:59:59');
    add('b', '2026-02-01 00:00:00');
    add('c', '2026-02-28 23:59:59');
    add('d', '2026-03-01 00:00:00');
    const n = (desde?: string, ate?: string) => repos.metrics.metrics({ ...(desde ? { desde } : {}), ...(ate ? { ate } : {}) }).totais.runs;
    expect(n('2026-02-01 00:00:00', '2026-03-01 00:00:00')).toBe(2); // b, c
    expect(n('2026-01-31 00:00:00', '2026-02-01 00:00:00')).toBe(1); // a only
    expect(n()).toBe(4);
    expect(repos.metrics.tokensSince('2026-02-01 00:00:00')).toBe(45);
  });

  it('rework numbering ignores the chosen period and the router runs', () => {
    const { repos, add } = setup();
    add('r1', '2026-01-10 10:00:00', { ticket: 't', agent: 'ag' });
    add('r2', '2026-02-10 10:00:00', { ticket: 't', agent: 'ag' });
    add('rt', '2026-02-10 11:00:00', { ticket: 't', agent: 'ag', etapa: 'roteador' });
    add('q', '2026-02-10 12:00:00', { ticket: 't', agent: 'other' });
    const m = repos.metrics.metrics({ desde: '2026-02-01 00:00:00' });
    expect(m.totais.runs).toBe(3);
    expect(m.totais.retrabalho).toBe(1); // r2 is the 2nd run of ag on t even though r1 is outside the range
    expect(m.totais.taxaRetrabalho).toBeCloseTo(1 / 2); // board runs in range: r2, q (router excluded)
  });

  it('success rate ignores cancelled and running; null when nothing finished', () => {
    const { repos, add } = setup();
    add('x', '2026-02-01 00:00:00', { status: 'cancelado' });
    add('y', '2026-02-01 00:00:01', { status: 'rodando' });
    expect(repos.metrics.metrics().totais.taxaSucesso).toBeNull();
    expect(repos.metrics.runningCount()).toBe(1);
    add('z', '2026-02-01 00:00:02', { status: 'erro' });
    add('w', '2026-02-01 00:00:03', { status: 'ok' });
    expect(repos.metrics.metrics().totais.taxaSucesso).toBe(0.5);
  });
});
