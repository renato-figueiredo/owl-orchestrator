import { isDestructive } from './destructive.js';

/**
 * What an agent's `ferramentas` may contain (they become `--allowedTools`, which PRE-APPROVES tools; everything else is
 * denied in non-interactive mode). The rule of the board: reading and testing are free, writing only happens inside the
 * ticket's git worktree, and nothing destructive is ever pre-approved (golden rule 5).
 */
export interface ToolReport {
  /** Some tool can change files or run commands: the agent may only run inside a worktree. */
  writes: boolean;
  /** Why the list is not acceptable, one sentence each (empty = fine). */
  problems: string[];
}

const READ = new Set(['Read', 'Grep', 'Glob', 'LS']);
const WRITE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Commands a scoped `Bash(...)` may start with. Anything else must be approved by a person, per action. */
const BASH_FIRST = new Set(['pnpm', 'npm', 'yarn', 'npx', 'node', 'git', 'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'pwd']);
/** `pnpm <x>` / `npm <x>`: running the project's own scripts is allowed, installing or publishing is not. */
const PACKAGE_SCRIPTS = new Set(['test', 'run', 't', 'lint', 'typecheck', 'build', 'format', 'check', 'tsc', 'vitest']);
const NPX_TOOLS = new Set(['vitest', 'tsc', 'eslint', 'prettier']);
const GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'add', 'commit', 'branch', 'rev-parse', 'ls-files']);
const SHELL_META = /[;&|<>`$()\n\r\\]/;

/** Words of a Bash rule without its flags (`--filter x` and `-r` are dropped) and without the `:*` wildcard suffix. */
function words(rule: string): string[] {
  const raw = rule.replace(/:\*$/, '').trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i] ?? '';
    if (w === '--filter' || w === '-F') i++;
    else if (!w.startsWith('-') || out.length === 0) out.push(w);
  }
  return out;
}

function checkBash(inner: string): string | undefined {
  if (!inner.trim()) return 'Bash() sem comando';
  if (SHELL_META.test(inner)) return `Bash(${inner}): encadear comandos, redirecionar ou usar $() não é permitido`;
  if (isDestructive(inner)) return `Bash(${inner}): comando destrutivo (apagar, push, merge, deploy...) nunca é pré-aprovado`;
  const [first, second] = words(inner);
  if (!first || !BASH_FIRST.has(first)) return `Bash(${inner}): "${first ?? ''}" não está na lista de comandos permitidos (${[...BASH_FIRST].join(', ')})`;
  if ((first === 'pnpm' || first === 'npm' || first === 'yarn') && !(second && PACKAGE_SCRIPTS.has(second))) {
    return `Bash(${inner}): só scripts do projeto (${[...PACKAGE_SCRIPTS].join(', ')}); instalar ou publicar pede aprovação`;
  }
  if (first === 'npx' && !(second && NPX_TOOLS.has(second))) return `Bash(${inner}): npx só roda ${[...NPX_TOOLS].join(', ')}`;
  if (first === 'git') {
    if (!(second && GIT_SUBCOMMANDS.has(second))) return `Bash(${inner}): git só permite ${[...GIT_SUBCOMMANDS].join(', ')}`;
    if (second === 'branch' && /\s-[dDmMcC]\b|--delete|--move|--copy/.test(` ${inner}`)) return `Bash(${inner}): git branch só para listar`;
  }
  if (first === 'node' && inner.split(/\s+/).some((w) => w === '-e' || w === '--eval' || w === '-p')) return `Bash(${inner}): node -e executa código arbitrário`;
  return undefined;
}

/** Splits `Name(arg)` into its parts; `inner` is undefined for a bare name. */
export function parseTool(tool: string): { name: string; inner: string | undefined } {
  const m = tool.trim().match(/^([A-Za-z_][\w-]*)(?:\(([\s\S]*)\))?$/);
  return { name: m?.[1] ?? tool.trim(), inner: m?.[2] };
}

export function analyzeTools(tools: readonly string[]): ToolReport {
  const problems: string[] = [];
  let writes = false;
  for (const tool of tools) {
    const { name, inner } = parseTool(tool);
    if (READ.has(name)) continue;
    if (WRITE.has(name)) {
      writes = true;
      continue;
    }
    if (name === 'Bash') {
      writes = true;
      if (inner === undefined) problems.push('Bash sem escopo libera qualquer comando; use Bash(pnpm test:*) e afins');
      else {
        const p = checkBash(inner);
        if (p) problems.push(p);
      }
      continue;
    }
    problems.push(`${tool}: ferramenta não permitida em agentes do quadro (use ${[...READ, ...WRITE].join(', ')} ou Bash(<comando>:*))`);
  }
  return { writes, problems };
}

/** Only the tools that cannot change anything: what an agent gets when it runs outside a worktree. */
export const readOnlyTools = (tools: readonly string[]): string[] => tools.filter((t) => READ.has(parseTool(t).name));
