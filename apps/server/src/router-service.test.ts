import { createRepos, migrate, openDb } from '@owl/db';
import { describe, expect, it } from 'vitest';
import { RouterService } from './router.js';

function svc() {
  const db = openDb();
  migrate(db);
  db.pragma('foreign_keys = OFF');
  const repos = createRepos(db);
  const run = (id: string, tokens: number, status = 'ok') =>
    db.prepare("INSERT INTO runs (id, provedor, status, tokens_in, tokens_out, inicio) VALUES (?, 'x', ?, ?, 0, datetime('now'))").run(id, status, tokens);
  return { router: new RouterService({ repos }), repos, run };
}

describe('RouterService.failures', () => {
  it('counts rejected deliveries and reproofs, not approved deliveries or other gates', () => {
    const { router, repos } = svc();
    const mk = (tipo: 'entrega' | 'reprovacao' | 'custo', decisao?: 'aprovado' | 'rejeitado') => {
      const a = repos.approvals.create({ ticketId: 'T', motivo: 'm', tipo });
      if (decisao) repos.approvals.decide(a.id, decisao);
    };
    mk('entrega', 'rejeitado');
    mk('entrega', 'aprovado');
    mk('reprovacao');
    mk('reprovacao', 'aprovado');
    mk('custo', 'rejeitado');
    expect(router.failures('T')).toBe(3);
    expect(router.failures('other')).toBe(0);
  });
});

describe('RouterService daily budget thresholds', () => {
  it('no limit: never warns nor blocks', () => {
    const { router, run } = svc();
    run('a', 1_000_000);
    expect(router.dayUsage()).toMatchObject({ limite: null, aviso: false, estourado: false });
    expect(router.overDaily(1e9)).toBe(false);
    expect(router.takeDailyWarning()).toBeUndefined();
  });

  it('79% silent, 80% warns once, 100% is over, and a running run counts as in flight', () => {
    const { router, run } = svc();
    router.save({ orcamentoDiaTokens: 1000 });
    run('a', 790);
    expect(router.dayUsage()).toMatchObject({ aviso: false, estourado: false });
    expect(router.takeDailyWarning()).toBeUndefined();
    run('b', 10);
    expect(router.dayUsage()).toMatchObject({ aviso: true, estourado: false });
    expect(router.takeDailyWarning()).toContain('80%');
    expect(router.takeDailyWarning()).toBeUndefined();
    run('c', 200);
    expect(router.dayUsage()).toMatchObject({ aviso: false, estourado: true });
  });

  it('a run in progress is reserved against the limit', () => {
    const { router, run } = svc();
    router.save({ orcamentoDiaTokens: 4_050 });
    expect(router.overDaily(100)).toBe(false);
    run('r', 0, 'rodando');
    expect(router.overDaily(100)).toBe(true); // 4000 reserved + 100 > 4050
  });
});
