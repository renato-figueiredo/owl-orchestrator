import { assertImagePath, assertSafeArg, buildEnv, CODEX_API_KEY_ENV_VARS, probeVersion } from '../process.js';
import type { CliAdapterOptions, ProviderAdapter, RunRequest } from '../types.js';
import { CodexStreamParser } from './codex-stream.js';
import { runCli } from './run-cli.js';

export interface CodexCliOptions extends CliAdapterOptions {
  /**
   * Ignore the user's `config.toml` and execpolicy rules (default: true), so a run does not depend on, or
   * inherit MCP servers and settings from, the user's interactive setup. Login is unaffected.
   */
  isolate?: boolean;
  /** Sandbox for commands the model runs (default `read-only`). Not available when resuming (see below). */
  sandbox?: 'read-only' | 'workspace-write';
}

const SAFE_MODEL = /^[\w.:/[\]@-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds the argument vector for `codex exec`. Flags verified against `codex exec --help` (codex-cli 0.162):
 * `--json` (JSONL events), `--skip-git-repo-check`, `-s/--sandbox`, `--ignore-user-config`, `--ignore-rules`, `-m`,
 * and `codex exec resume <id>`. The prompt goes through stdin (`-`), never argv.
 *
 * Known limits, on purpose:
 * - `resume` has no `--sandbox` flag: a resumed session keeps the sandbox of its first turn (read-only by default).
 * - Codex has no "append system prompt" flag, so `systemAppend` is prepended to the prompt of a FIRST turn only;
 *   a resumed thread already carries it.
 * - `allowedTools` and `mcpConfigPath` do not map to `codex exec` flags and are ignored.
 * - Images go as `--image <file>` AFTER the `-` stdin marker: the flag is variadic and would swallow the marker if it came first.
 */
export function buildCodexArgs(req: RunRequest, opts: Pick<CodexCliOptions, 'isolate' | 'sandbox'> = {}): string[] {
  const args = ['exec'];
  if (req.resumeSessionId) {
    if (!UUID.test(req.resumeSessionId)) throw new Error(`Invalid resumeSessionId: ${JSON.stringify(req.resumeSessionId)}`);
    args.push('resume', req.resumeSessionId);
  }
  args.push('--json', '--skip-git-repo-check');
  if (opts.isolate ?? true) args.push('--ignore-user-config', '--ignore-rules');
  if (!req.resumeSessionId) args.push('--sandbox', opts.sandbox ?? 'read-only');
  if (req.model) args.push('--model', assertSafeArg('model', req.model, SAFE_MODEL));
  args.push('-');
  for (const image of req.images ?? []) args.push('--image', assertImagePath(image));
  return args;
}

/** The text sent on stdin: the agent's instructions (first turn only) followed by the user's prompt. */
export function buildCodexPrompt(req: RunRequest): string {
  if (!req.systemAppend || req.resumeSessionId) return req.prompt;
  return `${req.systemAppend}\n\n---\n\n${req.prompt}`;
}

export function createCodexCliAdapter(opts: CodexCliOptions = {}): ProviderAdapter {
  const bin = opts.bin ?? 'codex';
  const binArgs = opts.binArgs ?? [];
  const env = () => buildEnv(opts.env ?? process.env, opts.authMode ?? 'subscription', CODEX_API_KEY_ENV_VARS);
  return {
    id: 'codex-cli',
    isAvailable: () => probeVersion(bin, binArgs, env()),
    async *run(req, signal) {
      let args: string[];
      try {
        args = [...binArgs, ...buildCodexArgs(req, opts)];
      } catch (e) {
        yield { type: 'start', runId: req.runId ?? 'invalid', provider: 'codex-cli' };
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
        return;
      }
      yield* runCli({
        provider: 'codex-cli',
        bin,
        args,
        stdin: buildCodexPrompt(req),
        req,
        env: env(),
        signal,
        killGraceMs: opts.killGraceMs,
        parser: new CodexStreamParser(),
        startEarly: true,
      });
    },
  };
}
