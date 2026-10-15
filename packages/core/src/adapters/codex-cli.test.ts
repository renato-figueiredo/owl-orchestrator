import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RunEvent } from '../types.js';
import { buildCodexArgs, createCodexCliAdapter } from './codex-cli.js';

const FAKE = fileURLToPath(new URL('../../test/fake-cli.mjs', import.meta.url));

describe('codex-cli adapter (fake CLI, text only)', () => {
  it('forwards stdout as text, ends cleanly, sends the prompt on stdin and drops OPENAI_API_KEY', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-codex-'));
    try {
      const a = createCodexCliAdapter({
        bin: process.execPath,
        binArgs: [FAKE],
        env: { ...process.env, FAKE_SCENARIO: 'codex', FAKE_RECORD: join(dir, 'rec.json'), OPENAI_API_KEY: 'dummy-not-a-real-key' },
      });
      const events: RunEvent[] = [];
      for await (const e of a.run({ prompt: 'faça X', cwd: dir }, new AbortController().signal)) events.push(e);
      expect(events.map((e) => e.type)).toEqual(['start', 'text', 'text', 'end']);
      const rec = JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8'));
      expect(rec.stdin).toBe('faça X');
      expect(rec.argv).toEqual(['exec', '-']);
      expect(rec.hasOpenaiKey).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported options instead of guessing flags', () => {
    expect(() => buildCodexArgs({ prompt: 'x', cwd: '/x', images: ['/a.png'] })).toThrow();
    expect(() => buildCodexArgs({ prompt: 'x', cwd: '/x', resumeSessionId: 'abc' })).toThrow();
    expect(() => buildCodexArgs({ prompt: 'x', cwd: '/x', model: '--bad' })).toThrow();
  });
});
