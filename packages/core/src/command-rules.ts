import { isDangerous, isDestructive } from './destructive.js';

/**
 * Commands an agent that already holds `Bash` rules may run without asking: checking and testing the code, reading the
 * tree, and installing from the lockfile with no network (it adds nothing that is not already pinned). Output filters
 * come along because agents pipe everything through them (`| tail -15`).
 */
/** `pnpm --filter <pkg> <task>`: the wildcard sits between fixed words, so `--filter x add y` is not covered. */
const filtered = (task: string): string[] => [`Bash(pnpm --filter * ${task})`, `Bash(pnpm --filter * ${task} *)`];

export const BASELINE_BASH: readonly string[] = [
  'Bash(pnpm typecheck:*)',
  'Bash(pnpm lint:*)',
  'Bash(pnpm test:*)',
  'Bash(pnpm vitest run:*)',
  'Bash(pnpm exec tsc --noEmit:*)',
  'Bash(pnpm exec vitest run:*)',
  ...filtered('typecheck'),
  ...filtered('lint'),
  ...filtered('test'),
  ...filtered('exec tsc --noEmit'),
  ...filtered('exec vitest run'),
  'Bash(pnpm install --frozen-lockfile --offline)',
  'Bash(pnpm install --offline --frozen-lockfile)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(tail:*)',
  'Bash(head:*)',
  'Bash(grep:*)',
  'Bash(wc:*)',
  'Bash(echo:*)',
  'Bash(ls:*)',
];

/** Filters that only shape output: they never need their own rule beyond the baseline. */
const SINKS = new Set(['tail', 'head', 'grep', 'wc', 'sort', 'uniq', 'echo', 'ls']);
/** `cd` inside the project is read-only for the CLI; a path that leaves it is not skipped. */
const isLocalCd = (segment: string): boolean => /^cd\s+(?!\/|~|-)(?!.*\.\.)\S+$/.test(segment);
const SAFE_INSTALL = /(^|[;&|\n]\s*)pnpm install((?:\s+--(?:frozen-lockfile|offline))+)(?=\s*(?:2>&1)?\s*(?:$|[;&|\n]))/g;

/** `pnpm install --frozen-lockfile --offline` is the one install that cannot fetch or change anything: the rest of the dangerous list stays. */
function withoutSafeInstalls(command: string): string {
  return command.replace(SAFE_INSTALL, (m, lead: string, flags: string) => (/--frozen-lockfile/.test(flags) && /--offline/.test(flags) ? `${lead}true` : m));
}

export function isRisky(command: string): boolean {
  return isDangerous(withoutSafeInstalls(command));
}

const PATTERNS: RegExp[] = [
  /\b(?:pnpm|npm|yarn|bun)\s+(?:i|install|add|remove|rm|uninstall|update|up|upgrade|publish|dlx|config|link|login|logout|store|self-update|rebuild|patch|env)\b/i,
  /\b(?:pip3?|pipx|cargo|gem|apt(?:-get)?|dnf|rpm-ostree|brew|go|flatpak)\s+(?:install|add|get|remove|uninstall|publish|upgrade)\b/i,
  /\bnpx\s+(?!(?:vitest|tsc|eslint|prettier)\b)/i,
  /\b(?:sudo|su|doas|chown|mkfs|dd)\b/i,
  /\bchmod\s+-[a-z]*R/i,
];

/**
 * The short word that makes a command risky (`pnpm add`, `sudo`, `rm`): what the person types to release it. Typing the
 * whole command proved too slow; this still takes reading the command to find out what to type.
 */
export function riskWord(command: string): string | undefined {
  const text = withoutSafeInstalls(command);
  // Destructive wording is matched through isDestructive; find the word through the same list order as isDangerous.
  const hit = PATTERNS.map((re) => re.exec(text)).find(Boolean) ?? /\b(rm|rmdir|unlink|drop|truncate|push|deploy\w*|publish|merge|rebase|force|shred|mkfs|wipe|clean|delete|remove)\b/i.exec(text) ?? /\|\s*(?:ba|z)?sh\b/.exec(text);
  if (!hit) return isDangerous(text) ? text.trim().split(/\s+/)[0] : undefined;
  const w = hit[0].trim().replace(/\s+/g, ' ');
  return w.length > 24 ? w.split(' ').at(-1) : w.replace(/^\|\s*/, '');
}

/**
 * Splits a shell line into its simple commands (`a 2>&1 | tail -5; b` → `a`, `tail -5`, `b`). Operators inside quotes
 * stay where they are (`grep -E "a|b"` is one command). Undefined when a quote is left open.
 */
export function splitCommand(command: string): string[] | undefined {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '|' || c === '&' || c === '\n') {
      if (c === '&' && command[i - 1] === '>') cur += c; // the `&` of `2>&1`
      else {
        out.push(cur);
        cur = '';
        if ((c === '|' || c === '&') && command[i + 1] === c) i++;
      }
    } else cur += c;
  }
  if (quote) return undefined;
  out.push(cur);
  return out.map((x) => x.replace(/\s*2>&1\s*/g, ' ').replace(/\s*2>\/dev\/null\s*/g, ' ').trim()).filter(Boolean);
}

/** Drops trailing path-like arguments so `vitest run src/a.test.ts` and `vitest run src/b.test.ts` share one rule. */
function stem(segment: string): string {
  const tokens = segment.split(/\s+/);
  while (tokens.length > 2) {
    const last = tokens.at(-1)!;
    if (last.startsWith('-') || last.startsWith('@') || !(last.includes('/') || /\.\w+$/.test(last))) break;
    tokens.pop();
  }
  return tokens.join(' ');
}

/**
 * The tool rules that let a command (and its siblings: same program and subcommand, other arguments) run again without
 * asking. Undefined when the line cannot be generalized safely (redirects, substitutions, parentheses) or is dangerous:
 * the caller then offers the exact command, for one run.
 */
export function rulesFor(command: string): string[] | undefined {
  if (isRisky(command) || isDestructive(command)) return undefined;
  if (/[()`$<>]|\\/.test(command.replace(/2>&1|2>\/dev\/null|\$\?/g, ''))) return undefined;
  const segments = splitCommand(command)?.filter((s) => !SINKS.has(s.split(/\s+/)[0]!) && !isLocalCd(s));
  if (!segments) return undefined;
  if (segments.length === 0) return undefined;
  const rules = segments.map((s) => `Bash(${stem(s)}:*)`);
  return [...new Set(rules)];
}

export interface Ask {
  /** What the person is asked about: only the dangerous parts of a chained command. */
  mostrar: string;
  /** The rules approving lets through: general ones for the safe parts, exact ones for the dangerous. */
  regras: string[];
  /** The command was cut down (its safe parts are left out of `mostrar`). */
  reduzido: boolean;
}

const exact = (c: string) => `Bash(${c})`;

/**
 * What to ask about for a command the CLI refused. A chain with one dangerous part (`vitest … ; rm x.test.ts ; git status`)
 * is asked about by that part alone: the rest is released as general rules, and the CLI checks each part of a chain
 * against its own rule, so the whole line still runs.
 */
export function askFor(command: string): Ask {
  const parts = splitRisk(command);
  if (parts) {
    const safe = rulesFor(parts.safe.join(' ; ')) ?? parts.safe.map(exact);
    return { mostrar: parts.risky.join('; '), regras: [...new Set([...parts.risky.map(exact), ...safe])], reduzido: true };
  }
  return { mostrar: command, regras: rulesFor(command) ?? [exact(command)], reduzido: false };
}

function splitRisk(command: string): { risky: string[]; safe: string[] } | undefined {
  const segments = splitCommand(command);
  if (!segments || segments.length < 2) return undefined;
  const risky = segments.filter((s) => isRisky(s));
  const safe = segments.filter((s) => !isRisky(s));
  return risky.length === 0 || safe.length === 0 ? undefined : { risky, safe };
}
