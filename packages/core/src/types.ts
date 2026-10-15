export type RunEvent =
  | { type: 'start'; runId: string; provider: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input?: unknown }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'end'; result?: string; cliSessionId?: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export interface RunRequest {
  prompt: string;
  /** Working folder of the run. */
  cwd: string;
  runId?: string;
  model?: string;
  /** Appended to the CLI's system prompt (agent instructions). */
  systemAppend?: string;
  /** Tools pre-approved for this run; everything else is denied in non-interactive mode. */
  allowedTools?: string[];
  /** Native CLI session continuity. */
  resumeSessionId?: string;
  mcpConfigPath?: string;
  /** Image file paths. Not supported by the CLI adapters yet (see build/prompts/08). */
  images?: string[];
}

/**
 * Contract: `run` yields exactly one `start` first, then zero or more progress events, then exactly one
 * terminal event (`end`, `error` or `cancelled`), then completes. It never throws for CLI failures.
 */
export interface ProviderAdapter {
  readonly id: string;
  /** The binary exists and answers `--version`. */
  isAvailable(): Promise<boolean>;
  run(req: RunRequest, signal: AbortSignal): AsyncIterable<RunEvent>;
}

/** How the subprocess is authenticated. */
export type AuthMode =
  /** Use the CLI's own login. API-key variables are removed from the child's environment. */
  | 'subscription'
  /** Pass the environment through untouched (API keys, if set, will be used and billed). */
  | 'inherit';

export interface CliAdapterOptions {
  /** Binary to execute (no shell). */
  bin?: string;
  /** Arguments placed before the adapter's own (used by tests to run a fake CLI through `node`). */
  binArgs?: string[];
  authMode?: AuthMode;
  /** Base environment (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Milliseconds between SIGTERM and SIGKILL when a run is cancelled (default 2000). */
  killGraceMs?: number;
}
