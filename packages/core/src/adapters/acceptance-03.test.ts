// QA tests for build/prompts/03-adaptadores.md acceptance criteria. Fake processes only; no real CLI or API.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeArg, buildEnv, CLAUDE_API_KEY_ENV_VARS, CODEX_API_KEY_ENV_VARS } from '../process.js';
import type { RunEvent, RunRequest } from '../types.js';
import { buildClaudeArgs, createClaudeCliAdapter } from './claude-cli.js';
import { ClaudeStreamParser } from './claude-stream.js';
import { buildCodexArgs, createCodexCliAdapter } from './codex-cli.js';

const FAKE = fileURLToPath(new URL('../../test/fake-cli.mjs', import.meta.url));
const SRC = fileURLToPath(new URL('..', import.meta.url));

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'owl-qa03-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Writes a fake CLI script and returns the args to run it (a file, so node does not parse the adapter's flags). */
const scriptArgs = (body: string) => {
  const f = join(dir, `fake-${n++}.mjs`);
  writeFileSync(f, body);
  return [f];
};
const req = (over: Partial<RunRequest> = {}): RunRequest => ({ prompt: 'hi', cwd: dir, ...over });
async function collect(it: AsyncIterable<RunEvent>) {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const terminals = (ev: RunEvent[]) => ev.filter((e) => ['end', 'error', 'cancelled'].includes(e.type));
const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join('\n');
const result = (over: Record<string, unknown> = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's1', ...over });

describe('claude parser edge cases', () => {
  const feedAll = (...objs: unknown[]) => {
    const p = new ClaudeStreamParser();
    return objs.flatMap((o) => p.feed(JSON.stringify(o)));
  };

  it('sums input + cache creation + cache read tokens and reports cost', () => {
    const ev = feedAll(result({ total_cost_usd: 0.12, usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 7 } }));
    expect(ev[0]).toEqual({ type: 'usage', inputTokens: 111, outputTokens: 7, costUsd: 0.12 });
  });

  it('handles a result without usage', () => {
    const ev = feedAll(result());
    expect(ev[0]).toEqual({ type: 'usage', inputTokens: 0 });
    expect(ev[1]).toMatchObject({ type: 'end', result: 'done', cliSessionId: 's1' });
  });

  it('is_error:true wins even when subtype is success', () => {
    const ev = feedAll(result({ is_error: true, result: 'API Error: 500' }));
    expect(ev.at(-1)).toEqual({ type: 'error', message: 'API Error: 500' });
    expect(ev.some((e) => e.type === 'end')).toBe(false);
  });

  it('error_* subtype without is_error is still an error, with a fallback message', () => {
    const ev = feedAll({ type: 'result', subtype: 'error_max_turns', is_error: false });
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('error_max_turns') });
  });

  it('ignores text produced inside sub-agents (parent_tool_use_id)', () => {
    const ev = feedAll(
      { type: 'stream_event', parent_tool_use_id: 'toolu_1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inner' } } },
      { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { id: 'm', content: [{ type: 'text', text: 'inner' }] } },
    );
    expect(ev).toEqual([]);
  });

  it('does not duplicate text already streamed as deltas', () => {
    const ev = feedAll(
      { type: 'stream_event', api_message_id: 'm1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'Read', input: {} }] } },
    );
    expect(ev).toEqual([{ type: 'text', delta: 'a' }, { type: 'tool', name: 'Read', input: {} }]);
  });

  it('exposes the model from system/init and the finished flag', () => {
    const p = new ClaudeStreamParser();
    expect(p.finished).toBe(false);
    p.feed(JSON.stringify({ type: 'system', subtype: 'init', model: 'm-x' }));
    expect(p.model).toBe('m-x');
    p.feed(JSON.stringify(result()));
    expect(p.finished).toBe(true);
  });

  it('survives wrongly typed fields', () => {
    expect(() => feedAll({ type: 'assistant', message: { content: 'x' } }, { type: 'result', usage: 'x', result: 5 }, { type: 'stream_event', event: 'x' })).not.toThrow();
  });
});

describe('claude args: isolation and flag safety', () => {
  it('isolation adds strict MCP, no slash commands and empty setting sources', () => {
    const a = buildClaudeArgs(req());
    expect(a).toContain('--strict-mcp-config');
    expect(a).toContain('--disable-slash-commands');
    const i = a.indexOf('--setting-sources');
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe('');
  });

  it('isolate:false drops all isolation flags', () => {
    const a = buildClaudeArgs(req(), { isolate: false });
    for (const f of ['--strict-mcp-config', '--disable-slash-commands', '--setting-sources']) expect(a).not.toContain(f);
  });

  it('the adapter option isolate:false reaches the child argv', async () => {
    const a = createClaudeCliAdapter({ bin: process.execPath, binArgs: [FAKE], isolate: false, env: { ...process.env, FAKE_RECORD: join(dir, 'r.json') } });
    await collect(a.run(req(), new AbortController().signal));
    const { argv } = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    expect(argv).not.toContain('--strict-mcp-config');
  });

  it('a system prompt starting with a dash stays attached to its flag (single argv element)', () => {
    const a = buildClaudeArgs(req({ systemAppend: '--evil flag' }));
    expect(a).toContain('--append-system-prompt=--evil flag');
    expect(a).not.toContain('--evil flag');
  });

  it('never includes the prompt or cwd in argv, and omits optional flags when unset', () => {
    const a = buildClaudeArgs(req({ prompt: 'P-R-O-M-P-T' }));
    expect(a.join('\0')).not.toContain('P-R-O-M-P-T');
    for (const f of ['--resume', '--allowedTools', '--mcp-config', '--append-system-prompt']) expect(a.some((x) => x.startsWith(f))).toBe(false);
  });

  it('rejects model values with whitespace or newlines', () => {
    expect(() => buildClaudeArgs(req({ model: 'a b' }))).toThrow();
    expect(() => buildClaudeArgs(req({ model: 'a\nb' }))).toThrow();
  });

  it('rejects an mcp config path with NUL', () => {
    expect(() => buildClaudeArgs(req({ mcpConfigPath: 'a\0b' }))).toThrow();
  });

  it('accepts Bash(...) tool patterns with spaces and rejects multi-line tools', () => {
    expect(buildClaudeArgs(req({ allowedTools: ['Bash(git log *)'] }))).toContain('Bash(git log *)');
    expect(() => buildClaudeArgs(req({ allowedTools: ['Bash\n--x'] }))).toThrow();
  });
});

describe('environment handling (unit)', () => {
  const base = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', OPENAI_API_KEY: 'c', CODEX_API_KEY: 'd', PATH: '/bin' };

  it('subscription mode strips every Claude key variable and keeps the rest', () => {
    const env = buildEnv(base, 'subscription', CLAUDE_API_KEY_ENV_VARS);
    expect(env).toEqual({ OPENAI_API_KEY: 'c', CODEX_API_KEY: 'd', PATH: '/bin' });
  });

  it('subscription mode strips every Codex key variable', () => {
    const env = buildEnv(base, 'subscription', CODEX_API_KEY_ENV_VARS);
    expect(env).toEqual({ ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', PATH: '/bin' });
  });

  it('inherit mode passes everything; the base object is never mutated', () => {
    expect(buildEnv(base, 'inherit', CLAUDE_API_KEY_ENV_VARS)).toEqual(base);
    buildEnv(base, 'subscription', CLAUDE_API_KEY_ENV_VARS);
    expect(base.ANTHROPIC_API_KEY).toBe('a');
  });

  it('claude child does not see ANTHROPIC_AUTH_TOKEN in subscription mode', async () => {
    const script = `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.OUT, JSON.stringify(Object.keys(process.env))); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));`;
    const a = createClaudeCliAdapter({ bin: process.execPath, binArgs: scriptArgs(script), env: { ...process.env, OUT: join(dir, 'k.json'), ANTHROPIC_AUTH_TOKEN: 'x', ANTHROPIC_API_KEY: 'y' } });
    await collect(a.run(req(), new AbortController().signal));
    const keys = JSON.parse(readFileSync(join(dir, 'k.json'), 'utf8')) as string[];
    expect(keys).not.toContain('ANTHROPIC_AUTH_TOKEN');
    expect(keys).not.toContain('ANTHROPIC_API_KEY');
  });

  it('assertSafeArg rejects leading dash and odd characters', () => {
    expect(() => assertSafeArg('x', '-a')).toThrow();
    expect(() => assertSafeArg('x', 'a;b')).toThrow();
    expect(assertSafeArg('x', 'gpt-5.1:mini')).toBe('gpt-5.1:mini');
  });
});

describe('claude adapter via inline fake processes', () => {
  const inline = (script: string, extra: { killGraceMs?: number } = {}) =>
    createClaudeCliAdapter({ bin: process.execPath, binArgs: scriptArgs(script), env: { ...process.env }, ...extra });

  it('events after the result line are ignored (exactly one terminal event)', async () => {
    const out = lines(result(), result({ result: 'second' }), { type: 'result', is_error: true, result: 'late' });
    const ev = await collect(inline(`process.stdin.resume(); process.stdin.on('end',()=>{process.stdout.write(${JSON.stringify(out)}+'\\n')})`).run(req(), new AbortController().signal));
    expect(terminals(ev)).toHaveLength(1);
    expect(ev.at(-1)).toMatchObject({ type: 'end', result: 'done' });
  });

  it('a result with is_error and exit code 1 yields the CLI message, not a generic exit error', async () => {
    const out = lines(result({ is_error: true, result: 'Invalid API key' }));
    const ev = await collect(inline(`process.stdout.write(${JSON.stringify(out)}+'\\n'); process.exitCode=1; process.stdin.resume(); process.stdin.on('end',()=>{})`).run(req(), new AbortController().signal));
    expect(ev.at(-1)).toEqual({ type: 'error', message: 'Invalid API key' });
    expect(terminals(ev)).toHaveLength(1);
  });

  it('survives a child that exits without reading a large stdin prompt (EPIPE)', async () => {
    const ev = await collect(inline(`process.exit(2)`).run(req({ prompt: 'x'.repeat(5_000_000) }), new AbortController().signal));
    expect(ev[0]?.type).toBe('start');
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('code 2') });
  });

  it('delivers a large multi-byte prompt intact over stdin', async () => {
    const prompt = 'ação—日本語\n'.repeat(50_000);
    const script = `import {writeFileSync} from 'node:fs'; let s=''; process.stdin.setEncoding('utf8'); for await (const c of process.stdin) s+=c; writeFileSync(${JSON.stringify(join(dir, 'p.txt'))}, s);`;
    await collect(inline(script).run(req({ prompt }), new AbortController().signal));
    expect(readFileSync(join(dir, 'p.txt'), 'utf8')).toBe(prompt);
  });

  it('truncates stderr in the error to the last lines', async () => {
    const script = `console.error(Array.from({length:50},(_, i)=>'line'+i).join('\\n')); process.exit(4)`;
    const ev = await collect(inline(script).run(req(), new AbortController().signal));
    const msg = (ev.at(-1) as { message: string }).message;
    expect(msg).toContain('line49');
    expect(msg).not.toContain('line10\n');
  });

  it('reports death by signal', async () => {
    const ev = await collect(inline(`process.kill(process.pid,'SIGKILL')`).run(req(), new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('signal SIGKILL') });
  });

  it('abort during a stream of events: cancelled replaces the natural end and no more events follow', async () => {
    const ac = new AbortController();
    const script = `process.stdout.write(${JSON.stringify(lines({ type: 'system', subtype: 'init', model: 'm' }))}+'\\n'); setInterval(()=>{},1000);`;
    const ev: RunEvent[] = [];
    for await (const e of inline(script, { killGraceMs: 200 }).run(req(), ac.signal)) {
      ev.push(e);
      if (e.type === 'start') setTimeout(() => ac.abort(), 100);
    }
    expect(ev.map((e) => e.type)).toEqual(['start', 'cancelled']);
  });

  it('timeout: an AbortSignal.timeout cancels a hanging run', async () => {
    const ev = await collect(inline(`setInterval(()=>{},1000)`, { killGraceMs: 200 }).run(req(), AbortSignal.timeout(300)));
    expect(ev.map((e) => e.type)).toEqual(['start', 'cancelled']);
  });

  it('a relative/unsafe bin name is never resolved through a shell', async () => {
    const a = createClaudeCliAdapter({ bin: 'echo hi; touch ' + join(dir, 'PWNED') });
    const ev = await collect(a.run(req(), new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'error' });
    expect(readdirSync(dir)).not.toContain('PWNED');
    expect(await a.isAvailable()).toBe(false);
  });
});

describe('codex adapter (process handling)', () => {
  const codex = (extra: { killGraceMs?: number; scenario?: string } = {}) =>
    createCodexCliAdapter({ bin: process.execPath, binArgs: [FAKE], ...(extra.killGraceMs !== undefined ? { killGraceMs: extra.killGraceMs } : {}), env: { ...process.env, FAKE_SCENARIO: extra.scenario ?? 'codex-text', FAKE_RECORD: join(dir, 'c.json') } });

  it('passes model as separate safe args and prompt only via stdin', () => {
    const args = buildCodexArgs(req({ model: 'gpt-x', prompt: 'SECRET' }));
    expect(args).toContain('--model');
    expect(args.at(args.indexOf('--model') + 1)).toBe('gpt-x');
    expect(args.join(' ')).not.toContain('SECRET');
    expect(args.at(-1)).toBe('-');
  });

  it('non-zero exit yields a single error with stderr tail', async () => {
    const ev = await collect(codex({ scenario: 'crash' }).run(req(), new AbortController().signal));
    expect(terminals(ev)).toHaveLength(1);
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/codex-cli exited with code 3.*boom/s) });
  });

  it('cancels a hanging run and kills the child', async () => {
    const ac = new AbortController();
    const ev: RunEvent[] = [];
    for await (const e of codex({ scenario: 'ignoreterm', killGraceMs: 200 }).run(req(), ac.signal)) {
      ev.push(e);
      if (e.type === 'start') setTimeout(() => ac.abort(), 300);
    }
    expect(ev.at(-1)).toEqual({ type: 'cancelled' });
    expect(terminals(ev)).toHaveLength(1);
  });

  it('missing binary: error event and isAvailable() false (the CLI is not installed on the dev machine)', async () => {
    const a = createCodexCliAdapter({ bin: join(dir, 'nope') });
    const ev = await collect(a.run(req(), new AbortController().signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'error']);
    expect(await a.isAvailable()).toBe(false);
  });

  it('invalid request yields start + error without spawning', async () => {
    const ev = await collect(codex().run(req({ images: ['a.png'] }), new AbortController().signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'error']);
    expect(() => readFileSync(join(dir, 'c.json'))).toThrow();
  });

  it('subscription mode drops OPENAI_API_KEY and CODEX_API_KEY; inherit keeps them', async () => {
    const script = `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.OUT, JSON.stringify(Object.keys(process.env))); process.stdin.resume();`;
    for (const [mode, expected] of [['subscription', false], ['inherit', true]] as const) {
      const a = createCodexCliAdapter({ bin: process.execPath, binArgs: scriptArgs(script), authMode: mode, env: { ...process.env, OUT: join(dir, `${mode}.json`), OPENAI_API_KEY: 'x', CODEX_API_KEY: 'y' } });
      await collect(a.run(req(), new AbortController().signal));
      const keys = JSON.parse(readFileSync(join(dir, `${mode}.json`), 'utf8')) as string[];
      expect(keys.includes('OPENAI_API_KEY')).toBe(expected);
      expect(keys.includes('CODEX_API_KEY')).toBe(expected);
    }
  });
});

describe('static guarantees on production sources', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(SRC);
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('has production files to scan', () => expect(files.length).toBeGreaterThan(4));

  it('never uses a shell: no exec/execSync/shell:true, spawn has shell:false', () => {
    expect(code).not.toMatch(/\bexecSync\b|\bspawnSync\b|\bchild_process'\)?\.exec\b|shell:\s*true/);
    expect(code).not.toMatch(/\bexec\(/);
    expect(code).toMatch(/shell:\s*false/);
  });

  it('never reads credential files or calls provider HTTP APIs', () => {
    expect(code).not.toMatch(/readFile|readFileSync|createReadStream/);
    expect(code).not.toMatch(/\.credentials|auth\.json|\.codex|\.claude|keychain/i);
    expect(code).not.toMatch(/\bfetch\(|https?:\/\/|from 'node:https?'|axios/);
  });

  it('does not use trademarked names in package identifiers', () => {
    const pkg = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8');
    expect(pkg).not.toMatch(/"name":\s*"[^"]*(claude|gpt)/i);
  });
});
