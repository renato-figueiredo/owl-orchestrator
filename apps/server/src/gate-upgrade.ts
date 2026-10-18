import { askFor, isRisky, riskWord } from '@owl/core';
import type { createRepos } from '@owl/db';

type Repos = ReturnType<typeof createRepos>;

const EXACT = /^Bash\(([^*]+)\)$/;
const HEADER = '⚠ COMANDO PERIGOSO. ';
const NOTE = 'só esta parte do comando precisa de você; o resto já está liberado';

/**
 * Brings permission requests opened before the current rules up to date: the rule offered is the general one,
 * `pnpm install --frozen-lockfile --offline` is no longer a dangerous request, a chain is asked about by its dangerous
 * part alone, and a dangerous one is released by its short word instead of the whole command. Only pending requests
 * change; the exact commands are recovered from their old rules and the general rules already there are kept.
 * Idempotent. Returns how many it updated.
 */
export function upgradePermissionGates(repos: Repos): number {
  let changed = 0;
  for (const project of repos.projects.list()) {
    for (const a of repos.approvals.pendingByProject(project.id)) {
      if (a.tipo !== 'permissao' || !a.retomar || a.retomar.conceder) continue;
      const old = a.retomar.ferramentas ?? [];
      const commands = old.map((r) => EXACT.exec(r)?.[1]).filter((c): c is string => c !== undefined);
      if (commands.length === 0) continue; // already general (or nothing to recover)
      const risky = commands.find((c) => isRisky(c));
      const asks = (risky ? [risky] : commands).map((c) => ({ c, ask: askFor(c) }));
      const { confirmar: _old, ...rest } = a.retomar;
      void _old;
      const retomar = {
        ...rest,
        ferramentas: [...new Set([...old.filter((r) => r.includes('*')), ...asks.flatMap(({ ask }) => ask.regras)])],
        ...(risky ? { confirmar: riskWord(asks[0]!.ask.mostrar) ?? asks[0]!.ask.mostrar } : {}),
      };
      // The text follows: dangerous warning only while it is, and a chain shows only the part that needs the person.
      const who = a.motivo.replace(HEADER, '').split('\n')[0] ?? '';
      const description = (c: string) => a.motivo.split(`${c} — `)[1]?.split('\n')[0];
      const lines = asks.map(({ c, ask }) => `${ask.mostrar}${ask.reduzido ? ` — ${NOTE}` : description(c) ? ` — ${description(c)}` : ''}`);
      const motivo = `${risky ? HEADER : ''}${who}\n${lines.join('\n')}`.slice(0, 1500);
      if (motivo === a.motivo && JSON.stringify(retomar) === JSON.stringify(a.retomar)) continue; // already current
      repos.approvals.setRetomar(a.id, retomar);
      repos.approvals.setMotivo(a.id, motivo);
      changed++;
    }
  }
  return changed;
}
