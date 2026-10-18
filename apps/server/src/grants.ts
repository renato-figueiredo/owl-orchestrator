import { BASELINE_BASH } from '@owl/core';
import type { createRepos } from '@owl/db';

type Repos = ReturnType<typeof createRepos>;

export interface Grant {
  /** A tool rule such as `Bash(pnpm typecheck:*)`. */
  regra: string;
  /** When it stops applying (db time), or null for as long as the project lives. */
  expiraEm: string | null;
  origem: 'pessoa' | 'monitor';
  criadoEm: string;
}

/** How long "this session" lasts. */
export const SESSION_HOURS = 4;
const MAX_GRANTS = 100;
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const parseDb = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`);

/**
 * Commands a person let a project's agents run without asking again, next to the built-in baseline. Kept as a setting per
 * project; only a person's decision on a gate adds one (never an agent), and a dangerous command is never remembered.
 */
export class Grants {
  constructor(
    private readonly repos: Repos,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key = (projectId: string) => `permissoes:${projectId}`;

  /** The grants that still apply. */
  list(projectId: string): Grant[] {
    const raw = this.repos.settings.get(this.key(projectId));
    if (!Array.isArray(raw)) return [];
    const now = this.now().getTime();
    return (raw as Grant[]).filter((g) => typeof g?.regra === 'string' && (g.expiraEm === null || parseDb(g.expiraEm) > now));
  }

  add(projectId: string, regra: string, horas: number | null, origem: Grant['origem']): void {
    const kept = this.list(projectId).filter((g) => g.regra !== regra);
    const now = this.now();
    kept.push({ regra, expiraEm: horas === null ? null : stamp(new Date(now.getTime() + horas * 3_600_000)), origem, criadoEm: stamp(now) });
    this.repos.settings.set(this.key(projectId), kept.slice(-MAX_GRANTS));
  }

  remove(projectId: string, regra: string): boolean {
    const all = this.list(projectId);
    const next = all.filter((g) => g.regra !== regra);
    if (next.length === all.length) return false;
    this.repos.settings.set(this.key(projectId), next);
    return true;
  }

  /** Every Bash rule an agent with Bash tools gets on top of its own list. */
  rules(projectId: string): string[] {
    return [...new Set([...BASELINE_BASH, ...this.list(projectId).map((g) => g.regra)])];
  }

  covers(projectId: string, regra: string): boolean {
    return this.rules(projectId).includes(regra);
  }
}
