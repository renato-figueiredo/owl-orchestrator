import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AuthMode } from './types.js';

/** Variables that make each CLI bill an API key instead of using the user's login. */
export const CLAUDE_API_KEY_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;
export const CODEX_API_KEY_ENV_VARS = ['OPENAI_API_KEY', 'CODEX_API_KEY'] as const;

/**
 * Returns the child's environment. We never read credential values; we only decide what to pass on:
 * in `subscription` mode the given API-key variables are removed so the CLI uses its own login.
 */
export function buildEnv(
  base: NodeJS.ProcessEnv,
  authMode: AuthMode,
  apiKeyVars: readonly string[],
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (authMode === 'subscription') for (const k of apiKeyVars) delete env[k];
  return env;
}

/** Guards values that end up as CLI option values or session ids (never start with '-'). */
export function assertSafeArg(name: string, value: string, pattern = /^[\w.:/[\]@-]+$/): string {
  if (value.startsWith('-') || !pattern.test(value)) throw new Error(`Invalid ${name}: ${JSON.stringify(value)}`);
  return value;
}

export type ProcessChunk =
  | { kind: 'line'; line: string }
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null; stderr: string; aborted: boolean; spawnError?: Error };

export interface RunProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  /** Written to the child's stdin, then closed. Keeps prompts out of argv. */
  stdin?: string;
  /** Grace period between SIGTERM and SIGKILL on abort. */
  killGraceMs?: number;
}

const STDERR_TAIL = 4096;

/**
 * Spawns `bin args` WITHOUT a shell and yields stdout lines, then a final `exit` chunk.
 * Aborting the signal (or stopping iteration early) terminates the child.
 */
export async function* runProcess(
  bin: string,
  args: readonly string[],
  opts: RunProcessOptions,
): AsyncGenerator<ProcessChunk> {
  const child = spawn(bin, [...args], { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });

  let spawnError: Error | undefined;
  child.once('error', (e) => (spawnError = e));
  child.stdin.on('error', () => {}); // EPIPE if the child exits before reading the prompt
  child.stdin.end(opts.stdin ?? '');

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c: string) => (stderr = (stderr + c).slice(-STDERR_TAIL)));

  let killTimer: NodeJS.Timeout | undefined;
  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), opts.killGraceMs ?? 2000);
    killTimer.unref();
  };
  if (opts.signal.aborted) terminate();
  else opts.signal.addEventListener('abort', terminate, { once: true });

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );

  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      yield { kind: 'line', line };
    }
    const { code, signal } = await closed;
    yield {
      kind: 'exit',
      code,
      signal,
      stderr,
      aborted: opts.signal.aborted,
      ...(spawnError ? { spawnError } : {}),
    };
  } finally {
    opts.signal.removeEventListener('abort', terminate);
    terminate(); // consumer stopped early
    if (child.exitCode !== null || child.signalCode !== null) clearTimeout(killTimer);
  }
}

/** True when `bin [binArgs] --version` exits 0 within the timeout. */
export function probeVersion(bin: string, binArgs: readonly string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, [...binArgs, '--version'], { env, timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}
