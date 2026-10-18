import { describe, expect, it } from 'vitest';
import { askFor, isRisky, riskWord, rulesFor } from './command-rules.js';

describe('rulesFor', () => {
  it('generalizes a command and drops output filters and file arguments', () => {
    expect(rulesFor('pnpm --filter ./apps/web typecheck 2>&1 | tail -30')).toEqual(['Bash(pnpm --filter ./apps/web typecheck:*)']);
    expect(rulesFor('pnpm --filter @owl/server exec vitest run src/a.test.ts')).toEqual(['Bash(pnpm --filter @owl/server exec vitest run:*)']);
    expect(rulesFor('pnpm --filter @owl/server exec tsc --noEmit 2>&1 | tail -20; pnpm --filter @owl/db exec tsc --noEmit')).toEqual([
      'Bash(pnpm --filter @owl/server exec tsc --noEmit:*)',
      'Bash(pnpm --filter @owl/db exec tsc --noEmit:*)',
    ]);
  });
  it('refuses to generalize what is dangerous, redirects to files, or substitutes', () => {
    for (const c of ['pnpm add left-pad', 'sudo ls', 'rm -rf x', 'echo hi > out.txt', 'echo $(whoami)', 'git push origin main', 'pnpm install']) expect(rulesFor(c)).toBeUndefined();
  });
});

describe('rulesFor with real agent commands', () => {
  it('keeps operators inside quotes, and skips echo, local cd and /dev/null noise', () => {
    expect(rulesFor('pnpm --filter @owl/server exec tsc --noEmit; echo "server:$?"; pnpm --filter @owl/db exec tsc --noEmit; echo "db:$?"; pnpm --filter @owl/server exec vitest run 2>&1 | tail -15')).toEqual([
      'Bash(pnpm --filter @owl/server exec tsc --noEmit:*)',
      'Bash(pnpm --filter @owl/db exec tsc --noEmit:*)',
      'Bash(pnpm --filter @owl/server exec vitest run:*)',
    ]);
    expect(rulesFor('cd apps/web && pnpm exec vitest run src/a.test.ts 2>&1 | grep -E "PROBE|Tests|Test Files"')).toEqual(['Bash(pnpm exec vitest run:*)']);
    expect(rulesFor('cd apps/web/src && git log --oneline -3 && ls && grep -rln "A|B" . 2>/dev/null')).toEqual(['Bash(git log --oneline -3:*)']);
  });
  it('refuses a cd out of the project and a quote left open', () => {
    expect(rulesFor('cd ../other && pnpm test')).toEqual(['Bash(cd ../other:*)', 'Bash(pnpm test:*)']);
    expect(rulesFor('pnpm test "oops')).toBeUndefined();
  });
});

describe('safe install', () => {
  it('pnpm install is risky unless it is frozen and offline', () => {
    expect(isRisky('pnpm install')).toBe(true);
    expect(isRisky('pnpm install --offline')).toBe(true);
    expect(isRisky('pnpm install --frozen-lockfile')).toBe(true);
    expect(isRisky('pnpm install --frozen-lockfile --offline 2>&1 | tail -15')).toBe(false);
    expect(isRisky('pnpm install --offline --frozen-lockfile')).toBe(false);
    expect(isRisky('pnpm install --frozen-lockfile --offline && pnpm add x')).toBe(true);
    expect(isRisky('pnpm install --frozen-lockfile --offline; sudo ls')).toBe(true);
  });
});

describe('riskWord', () => {
  it('gives the short word to type', () => {
    expect(riskWord('pnpm add left-pad')).toBe('pnpm add');
    expect(riskWord('sudo rm -rf /tmp/x')).toBe('sudo');
    expect(riskWord('git push origin main')).toBe('push');
    expect(riskWord('pnpm install')).toBe('pnpm install');
    expect(riskWord('pnpm typecheck')).toBeUndefined();
  });
});

describe('askFor', () => {
  it('asks only about the dangerous part of a chain and releases the rest as general rules', () => {
    const a = askFor('cd apps/web && pnpm exec vitest run src/a.test.ts 2>&1 | grep -E "PROBE|Tests"; rm src/lib/qaTmp.test.ts; git status --short');
    expect(a).toEqual({ mostrar: 'rm src/lib/qaTmp.test.ts', reduzido: true, regras: ['Bash(rm src/lib/qaTmp.test.ts)', 'Bash(pnpm exec vitest run:*)', 'Bash(git status --short:*)'] });
  });
  it('leaves a single command, or a chain nothing in which is safe, as it is', () => {
    expect(askFor('pnpm add left-pad')).toEqual({ mostrar: 'pnpm add left-pad', regras: ['Bash(pnpm add left-pad)'], reduzido: false });
    expect(askFor('sudo ls && rm x')).toMatchObject({ reduzido: false });
  });
});
