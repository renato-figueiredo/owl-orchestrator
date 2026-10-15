import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunEvent, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { Executor } from './executor.js';

/** Fake adapter whose runs finish only when the test says so (or when aborted). */
function controllable() {
  const requests: RunRequest[] = [];
  const gates: Array<{ release: (e?: RunEvent[]) => void; req: RunRequest }> = [];
  const adapter: ProviderAdapter = {
    id: 'fake',
    isAvailable: async () => true,
    run(req, signal) {
      requests.push(req);
      return (async function* () {
        yield { type: 'start', runId: req.runId ?? '', provider: 'fake' } as RunEvent;
        let tail: RunEvent[] | undefined;
        await new Promise<void>((resolve) => {
          gates.push({ req, release: (e) => { tail = e; resolve(); } });
          signal.addEventListener('abort', () => { tail = [{ type: 'cancelled' }]; resolve(); });
        });
        for (const e of tail ?? [{ type: 'end', result: 'ok' }]) yield e;
      })();
    },
  };
  return { adapter, requests, gates };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function make(adapter: ProviderAdapter, concurrency?: number, keepFinished?: number) {
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const cwd = mkdtempSync(join(tmpdir(), 'owl-exec-'));
  dirs.push(cwd);
  const executor = new Executor({ repos, resolveAdapter: () => adapter, ...(concurrency ? { concurrency } : {}), ...(keepFinished ? { keepFinished } : {}) });
  const submit = (sessionId: string, texto = 'x') => executor.submit({ sessionId, texto, provider: 'claude-cli', cwd });
  return { repos, executor, submit, newSession: () => repos.sessions.create().id };
}

describe('executor queue', () => {
  it('default concurrency is 1: second run starts only after the first finishes (FIFO)', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter);
    const a = submit(newSession());
    const b = submit(newSession());
    const c = submit(newSession());
    await tick();
    expect(f.requests.map((r) => r.runId)).toEqual([a.id]);
    f.gates[0]!.release();
    await tick();
    expect(f.requests.map((r) => r.runId)).toEqual([a.id, b.id]);
    f.gates[1]!.release();
    await tick();
    f.gates[2]!.release();
    await executor.idle();
    expect(f.requests.map((r) => r.runId)).toEqual([a.id, b.id, c.id]);
  });

  it('honours a configured concurrency of 2 and never exceeds it', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter, 2);
    for (let i = 0; i < 4; i++) submit(newSession());
    await tick();
    expect(f.requests).toHaveLength(2);
    f.gates[0]!.release();
    await tick();
    expect(f.requests).toHaveLength(3);
    f.gates[1]!.release();
    f.gates[2]!.release();
    await tick();
    f.gates[3]!.release();
    await executor.idle();
    expect(f.requests).toHaveLength(4);
  });

  it('coerces concurrency below 1 to 1', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter, 0 as number);
    submit(newSession());
    submit(newSession());
    await tick();
    expect(f.requests).toHaveLength(1);
    await executor.shutdown();
  });

  it('never runs two runs of the same session at once, even with free slots', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter, 3);
    const s = newSession();
    submit(s);
    submit(s);
    const other = submit(newSession());
    await tick();
    expect(f.requests).toHaveLength(2); // first of s + other session
    expect(f.requests.map((r) => r.runId)).toContain(other.id);
    await executor.shutdown();
  });

  it('idle() resolves immediately when nothing is pending', async () => {
    const { executor } = make(controllable().adapter);
    await expect(executor.idle()).resolves.toBeUndefined();
  });
});

describe('executor persistence', () => {
  it('stores user message first, then reply, tokens, cost and cli session on success', async () => {
    const f = controllable();
    const { repos, executor, submit, newSession } = make(f.adapter);
    const sid = newSession();
    const run = submit(sid, 'pergunta');
    expect(repos.messages.list(sid).map((m) => m.papel)).toEqual(['usuario']);
    await tick();
    f.gates[0]!.release([
      { type: 'text', delta: 'par' },
      { type: 'usage', inputTokens: 3, outputTokens: 4, costUsd: 0.5 },
      { type: 'usage', inputTokens: 1, outputTokens: 2, costUsd: 0.25 },
      { type: 'end', cliSessionId: 'cli-1' },
    ]);
    await executor.idle();
    const stored = repos.runs.get(run.id)!;
    expect(stored).toMatchObject({ status: 'ok', tokensIn: 4, tokensOut: 6, custoEstimado: 0.75 });
    expect(repos.messages.list(sid).map((m) => m.conteudo)).toEqual(['pergunta', 'par']); // falls back to streamed text
    expect(repos.sessions.get(sid)).toMatchObject({ cliProvider: 'claude-cli', cliSessionId: 'cli-1' });
  });

  it('does not resume across providers', async () => {
    const f = controllable();
    const { repos, executor, submit, newSession } = make(f.adapter);
    const sid = newSession();
    repos.sessions.setCliSession(sid, 'codex-cli', 'other');
    submit(sid);
    await tick();
    expect(f.requests[0]!.resumeSessionId).toBeUndefined();
    await executor.shutdown();
  });

  it('adapter that throws becomes an error run', async () => {
    const adapter: ProviderAdapter = { id: 'x', isAvailable: async () => true, run: () => { throw new Error('boom'); } };
    const { repos, executor, submit, newSession } = make(adapter);
    const sid = newSession();
    const run = submit(sid);
    await executor.idle();
    expect(repos.runs.get(run.id)).toMatchObject({ status: 'erro', erro: 'boom' });
    expect(repos.messages.list(sid).map((m) => m.papel)).toEqual(['usuario']);
  });

  it('stream ending without terminal event is an error', async () => {
    const adapter: ProviderAdapter = { id: 'x', isAvailable: async () => true, run: async function* () { yield { type: 'text', delta: 'a' } as RunEvent; } };
    const { repos, executor, submit, newSession } = make(adapter);
    const run = submit(newSession());
    await executor.idle();
    expect(repos.runs.get(run.id)).toMatchObject({ status: 'erro' });
  });

  it('events after the terminal event are dropped', async () => {
    const adapter: ProviderAdapter = {
      id: 'x', isAvailable: async () => true,
      run: async function* () {
        yield { type: 'end', result: 'r' } as RunEvent;
        yield { type: 'text', delta: 'late' } as RunEvent;
      },
    };
    const { executor, submit, newSession } = make(adapter);
    const run = submit(newSession());
    await executor.idle();
    const sub = executor.subscribe(run.id, () => {})!;
    expect(sub.history.map((e) => e.type)).toEqual(['end']);
  });
});

describe('executor events and cancel', () => {
  it('subscribers get history then live events in order, and done flag after finish', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter);
    const run = submit(newSession());
    await tick();
    const live: string[] = [];
    const sub = executor.subscribe(run.id, (e) => live.push(e.type))!;
    expect(sub.history.map((e) => e.type)).toEqual(['start']);
    expect(sub.done).toBe(false);
    f.gates[0]!.release([{ type: 'text', delta: 'a' }, { type: 'text', delta: 'b' }, { type: 'end' }]);
    await executor.idle();
    expect(live).toEqual(['text', 'text', 'end']);
    expect(executor.subscribe(run.id, () => {})!.done).toBe(true);
  });

  it('unsubscribe stops delivery; unknown run returns undefined', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter);
    const run = submit(newSession());
    await tick();
    const live: string[] = [];
    executor.subscribe(run.id, (e) => live.push(e.type))!.unsubscribe();
    f.gates[0]!.release();
    await executor.idle();
    expect(live).toEqual([]);
    expect(executor.subscribe('nope', () => {})).toBeUndefined();
  });

  it('cancel: running -> cancelado; queued -> cancelado without ever starting; finished -> finished; unknown -> not_found', async () => {
    const f = controllable();
    const { repos, executor, submit, newSession } = make(f.adapter);
    const a = submit(newSession());
    const b = submit(newSession());
    await tick();
    expect(executor.cancel(b.id)).toBe('cancelled');
    expect(repos.runs.get(b.id)).toMatchObject({ status: 'cancelado' });
    expect(executor.cancel(a.id)).toBe('cancelled');
    await executor.idle();
    expect(repos.runs.get(a.id)).toMatchObject({ status: 'cancelado' });
    expect(f.requests.map((r) => r.runId)).toEqual([a.id]); // b never reached the adapter
    expect(executor.cancel(a.id)).toBe('finished');
    expect(executor.cancel('nope')).toBe('not_found');
    expect(repos.messages.list(repos.runs.get(a.id)!.sessionId!).map((m) => m.papel)).toEqual(['usuario']);
  });

  it('cancelling a queued run lets the next one start', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter);
    submit(newSession());
    const b = submit(newSession());
    const c = submit(newSession());
    await tick();
    executor.cancel(b.id);
    f.gates[0]!.release();
    await tick();
    expect(f.requests.map((r) => r.runId)).toContain(c.id);
    f.gates[1]!.release();
    await executor.idle();
  });

  it('shutdown aborts running and queued runs', async () => {
    const f = controllable();
    const { repos, executor, submit, newSession } = make(f.adapter);
    const a = submit(newSession());
    const b = submit(newSession());
    await tick();
    await executor.shutdown();
    expect(repos.runs.get(a.id)).toMatchObject({ status: 'cancelado' });
    expect(repos.runs.get(b.id)).toMatchObject({ status: 'cancelado' });
  });

  it('keepFinished trims old finished runs from memory but cancel still reports finished from the DB', async () => {
    const f = controllable();
    const { executor, submit, newSession } = make(f.adapter, 1, 1);
    const a = submit(newSession());
    await tick();
    f.gates[0]!.release();
    const b = submit(newSession());
    await tick();
    f.gates[1]!.release();
    await executor.idle();
    expect(executor.subscribe(a.id, () => {})).toBeUndefined();
    expect(executor.subscribe(b.id, () => {})).toBeDefined();
    expect(executor.cancel(a.id)).toBe('finished');
  });
});
