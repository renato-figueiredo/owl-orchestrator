import { assertSafeArg, buildEnv, CODEX_API_KEY_ENV_VARS, probeVersion } from '../process.js';
import type { CliAdapterOptions, ProviderAdapter, RunEvent, RunRequest } from '../types.js';
import { runCli } from './run-cli.js';

/**
 * Codex adapter — TEXT ONLY, flags UNVERIFIED.
 * The `codex` binary is not installed on the development machine, so `codex exec --help` could not be
 * checked (project rule: never invent CLI flags). This adapter uses the minimal documented form
 * `codex exec -` (prompt on stdin) and forwards stdout as text. JSON events, images and resume are
 * deferred until the CLI is installed and its real output can be captured as fixtures.
 */
export function buildCodexArgs(req: RunRequest): string[] {
  if (req.images?.length) throw new Error('codex-cli does not support images yet');
  if (req.resumeSessionId) throw new Error('codex-cli does not support resume yet');
  const args = ['exec'];
  if (req.model) args.push('--model', assertSafeArg('model', req.model));
  args.push('-');
  return args;
}

const textParser = {
  feed: (line: string): RunEvent[] => (line === '' ? [] : [{ type: 'text', delta: `${line}\n` }]),
};

export function createCodexCliAdapter(opts: CliAdapterOptions = {}): ProviderAdapter {
  const bin = opts.bin ?? 'codex';
  const binArgs = opts.binArgs ?? [];
  const env = () => buildEnv(opts.env ?? process.env, opts.authMode ?? 'subscription', CODEX_API_KEY_ENV_VARS);
  return {
    id: 'codex-cli',
    isAvailable: () => probeVersion(bin, binArgs, env()),
    async *run(req, signal) {
      let args: string[];
      try {
        args = [...binArgs, ...buildCodexArgs(req)];
      } catch (e) {
        yield { type: 'start', runId: req.runId ?? 'invalid', provider: 'codex-cli' };
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
        return;
      }
      yield* runCli({
        provider: 'codex-cli',
        bin,
        args,
        stdin: req.prompt,
        req,
        env: env(),
        signal,
        killGraceMs: opts.killGraceMs,
        parser: textParser,
        endOnCleanExit: true,
      });
    },
  };
}
