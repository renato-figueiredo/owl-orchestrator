import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliAdapterOptions, RunEvent, RunRequest } from '../types.js';
import { buildClaudeArgs, createClaudeCliAdapter } from './claude-cli.js';
import { ClaudeStreamParser } from './claude-stream.js';

const FAKE = fileURLToPath(new URL('../../test/fake-cli.mjs', import.meta.url));
const fixture = (n: string) => readFileSync(fileURLToPath(new URL(`../../test/fixtures/${n}`, import.meta.url)), 'utf8');

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'owl-core-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const record = () => JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8')) as {
  argv: string[]; stdin: string; cwd: string; pid: number; hasAnthropicKey: boolean;
};

function adapter(scenario: string, extra: CliAdapterOptions & { isolate?: boolean } = {}) {
  return createClaudeCliAdapter({
    bin: process.execPath,
    binArgs: [FAKE],
    env: { ...process.env, FAKE_SCENARIO: scenario, FAKE_RECORD: join(dir, 'rec.json'), ANTHROPIC_API_KEY: 'dummy-not-a-real-key' },
    ...extra,
  });
}
const req = (over: Partial<RunRequest> = {}): RunRequest => ({ prompt: 'olá', cwd: dir, ...over });
async function collect(it: AsyncIterable<RunEvent>) {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const run = (scenario: string, r: Partial<RunRequest> = {}, extra: Parameters<typeof adapter>[1] = {}) =>
  collect(adapter(scenario, extra).run(req(r), new AbortController().signal));
const pidAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitDead = async (pid: number) => {
  for (let i = 0; i < 50 && pidAlive(pid); i++) await new Promise((r) => setTimeout(r, 40));
  return !pidAlive(pid);
};

/** The RunEvent contract: one start first, exactly one terminal event, last. */
function expectContract(events: RunEvent[]) {
  expect(events[0]?.type).toBe('start');
  expect(events.filter((e) => e.type === 'start')).toHaveLength(1);
  const terminals = events.filter((e) => ['end', 'error', 'cancelled'].includes(e.type));
  expect(terminals).toHaveLength(1);
  expect(['end', 'error', 'cancelled']).toContain(events.at(-1)?.type);
}

describe('ClaudeStreamParser (real captured output)', () => {
  const parse = (name: string) => {
    const p = new ClaudeStreamParser();
    return fixture(name).split('\n').flatMap((l) => p.feed(l));
  };

  it('streams text once, reports usage and ends with the session id', () => {
    const ev = parse('claude-text-partial.jsonl');
    expect(ev.filter((e) => e.type === 'text')).toEqual([{ type: 'text', delta: 'ok' }]);
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ inputTokens: 540520, outputTokens: 4 });
    expect(ev.at(-1)).toMatchObject({ type: 'end', result: 'ok', cliSessionId: expect.any(String) });
  });

  it('maps tool use and tool-turn text', () => {
    const ev = parse('claude-tool.jsonl');
    expect(ev).toContainEqual({ type: 'tool', name: 'Bash', input: { command: 'echo hi', description: expect.any(String) } });
    expect(ev.find((e) => e.type === 'text')).toMatchObject({ delta: expect.stringContaining('hi') });
    expect(ev.at(-1)?.type).toBe('end');
  });

  it('turns API errors (is_error with subtype success) into an error event, not an end', () => {
    const ev = parse('claude-error.jsonl');
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('modelo-inexistente') });
    expect(ev.some((e) => e.type === 'end')).toBe(false);
  });

  it('falls back to assistant text when the CLI sent no partial deltas', () => {
    const p = new ClaudeStreamParser();
    const line = JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'oi' }] } });
    expect(p.feed(line)).toEqual([{ type: 'text', delta: 'oi' }]);
  });

  it('ignores noise and unknown events', () => {
    const p = new ClaudeStreamParser();
    expect(p.feed('garbage')).toEqual([]);
    expect(p.feed('')).toEqual([]);
    expect(p.feed('[1,2]')).toEqual([]);
    expect(p.feed('{"type":"something_new"}')).toEqual([]);
  });
});

describe('buildClaudeArgs', () => {
  it('uses verified flags, isolation by default, and never puts the prompt in argv', () => {
    const args = buildClaudeArgs({ prompt: 'SECRET PROMPT', cwd: '/x', model: 'haiku' });
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format=stream-json', '--verbose', '--include-partial-messages', '--strict-mcp-config', '--disable-slash-commands', '--model=haiku']));
    expect(args.join(' ')).not.toContain('SECRET PROMPT');
  });

  it('can turn isolation off', () => {
    expect(buildClaudeArgs({ prompt: 'x', cwd: '/x' }, { isolate: false })).not.toContain('--strict-mcp-config');
  });

  it('passes resume, system prompt, mcp config and tools', () => {
    const id = '35bef6d6-5dcc-4287-ad8d-1a314ab12876';
    const args = buildClaudeArgs({
      prompt: 'x', cwd: '/x', resumeSessionId: id, systemAppend: '- be brief', mcpConfigPath: '/tmp/m.json',
      allowedTools: ['Read', 'Bash(git *)'],
    });
    expect(args).toEqual(expect.arrayContaining([`--resume=${id}`, '--append-system-prompt=- be brief', '--mcp-config=/tmp/m.json']));
    expect(args.slice(args.indexOf('--allowedTools'))).toEqual(['--allowedTools', 'Read', 'Bash(git *)']);
  });

  it('rejects values that could be parsed as flags', () => {
    expect(() => buildClaudeArgs({ prompt: 'x', cwd: '/x', model: '--dangerously-skip-permissions' })).toThrow();
    expect(() => buildClaudeArgs({ prompt: 'x', cwd: '/x', resumeSessionId: '--x' })).toThrow();
    expect(() => buildClaudeArgs({ prompt: 'x', cwd: '/x', allowedTools: ['--bad'] })).toThrow();
    const args = buildClaudeArgs({ prompt: 'x', cwd: '/x', images: ['/data/a.png'] });
    expect(args).toContain('--add-dir=/data');
    expect(args.slice(args.indexOf('--allowedTools'))).toEqual(['--allowedTools', 'Read(//data/**)']);
    expect(() => buildClaudeArgs({ prompt: 'x', cwd: '/x', images: ['relativo.png'] })).toThrow(/image path/);
    expect(() => buildClaudeArgs({ prompt: 'x', cwd: '/x', images: ['/a\n.png'] })).toThrow(/image path/);
  });
});

describe('claude-cli adapter (fake CLI)', () => {
  it('runs a normal prompt: contract, model from init, prompt via stdin', async () => {
    const events = await run('text', { prompt: 'Qual é a capital?', model: 'haiku' });
    expectContract(events);
    expect(events[0]).toMatchObject({ type: 'start', provider: 'claude-cli', model: 'claude-haiku-5-5' });
    expect(events.at(-1)).toMatchObject({ type: 'end', result: 'ok' });
    const rec = record();
    expect(rec.stdin).toBe('Qual é a capital?');
    expect(rec.argv.join(' ')).not.toContain('Qual é a capital?');
    expect(rec.cwd).toBe(dir);
  });

  it('keeps a prompt that looks like a flag out of argv', async () => {
    await run('text', { prompt: '--dangerously-skip-permissions' });
    const rec = record();
    expect(rec.stdin).toBe('--dangerously-skip-permissions');
    expect(rec.argv).not.toContain('--dangerously-skip-permissions');
  });

  it('reports tool events', async () => {
    const events = await run('tool');
    expectContract(events);
    expect(events.some((e) => e.type === 'tool' && e.name === 'Bash')).toBe(true);
  });

  it('turns a CLI-reported error into a single error event', async () => {
    const events = await run('error');
    expectContract(events);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('survives non-JSON noise on stdout', async () => {
    const events = await run('noise');
    expectContract(events);
    expect(events.at(-1)?.type).toBe('end');
  });

  it('reports a crash with the stderr tail', async () => {
    const events = await run('crash');
    expectContract(events);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/code 3.*boom/s) });
  });

  it('reports a clean exit without a result as an error', async () => {
    const events = await run('noresult');
    expectContract(events);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('without a result') });
  });

  it('reports a missing binary as an error event instead of throwing', async () => {
    const a = createClaudeCliAdapter({ bin: join(dir, 'does-not-exist') });
    const events = await collect(a.run(req(), new AbortController().signal));
    expectContract(events);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('Could not run') });
    expect(await a.isAvailable()).toBe(false);
  });

  it('turns invalid requests into start + error events', async () => {
    const events = await run('text', { resumeSessionId: 'not-a-uuid' });
    expectContract(events);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('resumeSessionId') });
  });

  it('isAvailable() is true when --version answers', async () => {
    expect(await adapter('text').isAvailable()).toBe(true);
  });
});

describe('credentials & environment', () => {
  it('removes API-key variables in subscription mode (default)', async () => {
    await run('text');
    expect(record().hasAnthropicKey).toBe(false);
  });

  it('passes them through in inherit mode', async () => {
    await run('text', {}, { authMode: 'inherit' });
    expect(record().hasAnthropicKey).toBe(true);
  });
});

describe('no shell', () => {
  it('passes shell metacharacters as literal arguments and executes nothing', async () => {
    const marker = join(dir, 'PWNED');
    const evil = `Bash(echo $(touch ${marker}); touch ${marker})`;
    await run('text', { allowedTools: [evil] });
    expect(record().argv).toContain(evil);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('cancellation', () => {
  it('kills the child and emits a single cancelled event', async () => {
    const ac = new AbortController();
    const events: RunEvent[] = [];
    let pid = 0;
    for await (const e of adapter('hang').run(req(), ac.signal)) {
      events.push(e);
      if (e.type === 'start') {
        await new Promise((r) => setTimeout(r, 300)); // let the fake record its pid
        pid = record().pid;
        ac.abort();
      }
    }
    expectContract(events);
    expect(events.at(-1)).toEqual({ type: 'cancelled' });
    expect(await waitDead(pid)).toBe(true);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const ac = new AbortController();
    let pid = 0;
    const events: RunEvent[] = [];
    for await (const e of adapter('ignoreterm', { killGraceMs: 200 }).run(req(), ac.signal)) {
      events.push(e);
      if (e.type === 'start') {
        await new Promise((r) => setTimeout(r, 300));
        pid = record().pid;
        ac.abort();
      }
    }
    expect(events.at(-1)).toEqual({ type: 'cancelled' });
    expect(await waitDead(pid)).toBe(true);
  });

  it('an already-aborted signal yields cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(adapter('hang').run(req(), ac.signal));
    expectContract(events);
    expect(events.at(-1)).toEqual({ type: 'cancelled' });
  });

  it('stops the child when the consumer stops iterating early', async () => {
    const it = adapter('hang').run(req(), new AbortController().signal)[Symbol.asyncIterator]();
    await it.next(); // start
    await new Promise((r) => setTimeout(r, 300));
    const { pid } = record();
    await it.return?.();
    expect(await waitDead(pid)).toBe(true);
  });
});
