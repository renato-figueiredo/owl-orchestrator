import { LocalBoard } from '@owl/board';
import { createRepos, migrate, openDb } from '@owl/db';
import { describe, expect, it } from 'vitest';
import { upgradePermissionGates } from './gate-upgrade.js';

function setup() {
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const project = repos.projects.create({ nome: 'p', pasta: '/tmp/p' });
  const t = new LocalBoard(repos).createTicket({ projectId: project.id, titulo: 'T' }, { tipo: 'humano', nome: 'x' } as never);
  const gate = (motivo: string, retomar: object) => repos.approvals.create({ ticketId: t.id, motivo, tipo: 'permissao', retomar });
  return { repos, gate };
}

describe('upgradePermissionGates', () => {
  it('turns exact rules into general ones, lifts the warning from a frozen offline install, and shortens the typing', () => {
    const { repos, gate } = setup();
    const filtered = gate('dev-back pede permissão para rodar:\npnpm --filter @owl/web typecheck 2>&1 | tail -30', { ferramentas: ['Bash(pnpm --filter @owl/web typecheck 2>&1 | tail -30)'], confirmar: undefined });
    const install = gate('⚠ COMANDO PERIGOSO. dev-back pede permissão para rodar:\npnpm install --frozen-lockfile --offline', { ferramentas: ['Bash(pnpm install --frozen-lockfile --offline)'], confirmar: 'pnpm install --frozen-lockfile --offline' });
    const add = gate('⚠ COMANDO PERIGOSO. dev-back pede permissão para rodar:\npnpm add left-pad', { ferramentas: ['Bash(pnpm add left-pad)'], confirmar: 'pnpm add left-pad' });
    expect(upgradePermissionGates(repos)).toBe(3);
    expect(repos.approvals.get(filtered.id)!.retomar?.ferramentas).toEqual(['Bash(pnpm --filter @owl/web typecheck:*)']);
    const i = repos.approvals.get(install.id)!;
    expect(i.retomar?.confirmar).toBeUndefined();
    expect(i.motivo).not.toContain('PERIGOSO');
    expect(repos.approvals.get(add.id)!.retomar).toMatchObject({ confirmar: 'pnpm add', ferramentas: ['Bash(pnpm add left-pad)'] });
    expect(repos.approvals.get(add.id)!.motivo).toContain('PERIGOSO');
    expect(upgradePermissionGates(repos)).toBe(0); // nothing left to change
  });
});
