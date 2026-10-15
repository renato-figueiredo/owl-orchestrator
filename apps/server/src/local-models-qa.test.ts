import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalModels, type LocalProbe } from './local-models.js';

afterEach(() => vi.useRealTimers());

describe('QA LocalModels periodic refresh (30 s)', () => {
  it('probes at start, then every 30 s, and stop() ends it', async () => {
    vi.useFakeTimers();
    const isAvailable = vi.fn(async () => true);
    const p: LocalProbe = { isAvailable, listModels: async () => [{ name: 'a:1' }] };
    const l = new LocalModels(p);
    l.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(isAvailable).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(isAvailable).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(isAvailable).toHaveBeenCalledTimes(2);
    expect(l.pick()).toBe('a:1');
    l.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(isAvailable).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the snapshot between checks and picks up a server that comes back', async () => {
    vi.useFakeTimers();
    let up = false;
    const l = new LocalModels({ isAvailable: async () => up, listModels: async () => [{ name: 'm:1' }] });
    l.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.pick()).toBeUndefined();
    up = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(l.pick()).toBeUndefined(); // still the cached state
    await vi.advanceTimersByTimeAsync(20_000);
    expect(l.pick()).toBe('m:1');
    l.stop();
  });

  it('snapshot returns a copy and listModels failing after isAvailable marks it down', async () => {
    const l = new LocalModels({ isAvailable: async () => true, listModels: async () => Promise.reject(new Error('x')) });
    expect((await l.refresh()).disponivel).toBe(false);
    const ok = new LocalModels({ isAvailable: async () => true, listModels: async () => [{ name: 'a' }] });
    await ok.refresh();
    ok.snapshot().modelos.push('hack');
    expect(ok.snapshot().modelos).toEqual(['a']);
  });
});
