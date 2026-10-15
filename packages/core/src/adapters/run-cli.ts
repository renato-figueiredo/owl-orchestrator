import { randomUUID } from 'node:crypto';
import { runProcess } from '../process.js';
import type { RunEvent, RunRequest } from '../types.js';

export interface LineParser {
  feed(line: string): RunEvent[];
  /** Model reported by the CLI, once known. */
  readonly model?: string | undefined;
}

export interface RunCliParams {
  provider: string;
  bin: string;
  args: readonly string[];
  stdin: string;
  req: RunRequest;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  parser: LineParser;
  /** When true, exit code 0 without a terminal event is a successful `end`. */
  endOnCleanExit?: boolean;
  killGraceMs?: number | undefined;
}

const isTerminal = (e: RunEvent) => e.type === 'end' || e.type === 'error' || e.type === 'cancelled';

/**
 * Shared run loop: guarantees the RunEvent contract (one `start`, progress events, exactly one terminal
 * event) regardless of how the child behaves, and never throws for CLI failures.
 */
export async function* runCli(p: RunCliParams): AsyncGenerator<RunEvent> {
  const runId = p.req.runId ?? randomUUID();
  let started = false;
  let terminal = false;
  const start = (): RunEvent => {
    started = true;
    const model = p.parser.model ?? p.req.model;
    return { type: 'start', runId, provider: p.provider, ...(model ? { model } : {}) };
  };

  for await (const chunk of runProcess(p.bin, p.args, {
    cwd: p.req.cwd,
    env: p.env,
    signal: p.signal,
    stdin: p.stdin,
    ...(p.killGraceMs !== undefined ? { killGraceMs: p.killGraceMs } : {}),
  })) {
    if (chunk.kind === 'line') {
      const events = p.parser.feed(chunk.line);
      if (!started && (events.length > 0 || p.parser.model !== undefined)) yield start();
      for (const e of events) {
        if (terminal) break;
        yield e;
        if (isTerminal(e)) terminal = true;
      }
      continue;
    }

    if (!started) yield start();
    if (terminal) return;
    if (chunk.aborted) {
      yield { type: 'cancelled' };
    } else if (chunk.spawnError) {
      yield { type: 'error', message: `Could not run "${p.bin}": ${chunk.spawnError.message}` };
    } else if (chunk.code !== 0) {
      const tail = chunk.stderr.trim().split('\n').slice(-5).join('\n');
      const why = chunk.signal ? `signal ${chunk.signal}` : `code ${String(chunk.code)}`;
      yield { type: 'error', message: `${p.provider} exited with ${why}${tail ? `: ${tail}` : ''}` };
    } else if (p.endOnCleanExit) {
      yield { type: 'end' };
    } else {
      yield { type: 'error', message: `${p.provider} finished without a result` };
    }
  }
}
