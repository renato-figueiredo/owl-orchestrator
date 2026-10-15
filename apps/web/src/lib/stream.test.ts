import { describe, expect, it } from 'vitest';
import { initialStream, reduceStream, type StreamState } from './stream';
import type { RunEvent } from './types';

const run = (events: RunEvent[]): StreamState => events.reduce(reduceStream, initialStream);

describe('reduceStream', () => {
  it('accumulates text, tools and usage, then ends', () => {
    const s = run([
      { type: 'start', runId: 'r', provider: 'claude-cli', model: 'haiku' },
      { type: 'text', delta: 'Olá, ' },
      { type: 'tool', name: 'Read', input: { path: 'a' } },
      { type: 'text', delta: 'mundo' },
      { type: 'usage', inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
      { type: 'end', result: 'Olá, mundo' },
    ]);
    expect(s).toMatchObject({ phase: 'ended', text: 'Olá, mundo', provider: 'claude-cli', model: 'haiku', inputTokens: 10, outputTokens: 2, costUsd: 0.001 });
    expect(s.tools).toEqual([{ name: 'Read', input: { path: 'a' } }]);
  });

  it('uses the final result when no text deltas arrived', () => {
    expect(run([{ type: 'start', runId: 'r', provider: 'p' }, { type: 'end', result: 'só o resultado' }]).text).toBe('só o resultado');
  });

  it('a replay after reconnect (new start) does not duplicate text', () => {
    const first: RunEvent[] = [{ type: 'start', runId: 'r', provider: 'p' }, { type: 'text', delta: 'abc' }];
    const s = run([...first, ...first, { type: 'text', delta: 'd' }]);
    expect(s.text).toBe('abcd');
  });

  it('maps error and cancelled', () => {
    expect(run([{ type: 'start', runId: 'r', provider: 'p' }, { type: 'error', message: 'boom' }])).toMatchObject({ phase: 'error', error: 'boom' });
    expect(run([{ type: 'start', runId: 'r', provider: 'p' }, { type: 'cancelled' }]).phase).toBe('cancelled');
  });
});
