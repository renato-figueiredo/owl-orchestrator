import { describe, expect, it } from 'vitest';
import { getAdapter, listAdapters, registerAdapter } from './registry.js';

describe('adapter registry', () => {
  it('has the built-in adapters', () => {
    expect(getAdapter('claude-cli').id).toBe('claude-cli');
    expect(getAdapter('codex-cli').id).toBe('codex-cli');
    expect(listAdapters().map((a) => a.id)).toEqual(expect.arrayContaining(['claude-cli', 'codex-cli']));
  });
  it('throws for unknown ids and accepts custom adapters', () => {
    expect(() => getAdapter('nope')).toThrow(/Unknown provider adapter/);
    registerAdapter({ id: 'custom', isAvailable: async () => true, async *run() {} });
    expect(getAdapter('custom').id).toBe('custom');
  });
});
