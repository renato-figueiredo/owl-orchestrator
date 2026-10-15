import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunRequest } from '../types.js';
import { buildCodexArgs, buildCodexPrompt, createCodexCliAdapter } from './codex-cli.js';
import { CodexStreamParser, codexErrorMessage } from './codex-stream.js';

const FAKE = fileURLToPath(new URL('../../test/fake-cli.mjs', import.meta.url));
const fixture = (n: string) => readFileSync(fileURLToPath(new URL(`../../test/fixtures/${n}`, import.meta.url)), 'utf8');
const THREAD = '019a0000-0000-7000-8000-000000000001';

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'owl-codex-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const record = () => JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8')) as { argv: string[]; stdin: string; hasOpenaiKey: boolean };
const adapter = (scenario: string) =>
  createCodexCliAdapter({
    bin: process.execPath,
    binArgs: [FAKE],
    env: { ...process.env, FAKE_SCENARIO: scenario, FAKE_RECORD: join(dir, 'rec.json'), OPENAI_API_KEY: 'dummy-not-a-real-key' },
  });
const run = async (scenario: string, req: Partial<RunRequest> = {}) => {
  const events: RunEvent[] = [];
  for await (const e of adapter(scenario).run({ prompt: 'faça X', cwd: dir, ...req }, new AbortController().signal)) events.push(e);
  return events;
};
const parse = (name: string) => {
  const p = new CodexStreamParser();
  return fixture(name).split('\n').flatMap((l) => p.feed(l));
};

describe('CodexStreamParser (real captured output, codex-cli 0.162)', () => {
  it('turns a plain answer into text, usage and an end with the thread id', () => {
    expect(parse('codex-text.jsonl')).toEqual([
      { type: 'text', delta: 'ok' },
      { type: 'usage', inputTokens: 12818, outputTokens: 5 },
      { type: 'end', result: 'ok', cliSessionId: THREAD },
    ]);
  });

  it('reports a command as ONE tool event, joins messages, and answers with the last message', () => {
    const ev = parse('codex-tool.jsonl');
    expect(ev.filter((e) => e.type === 'tool')).toEqual([{ type: 'tool', name: 'command', input: { command: '/bin/bash -lc ls' } }]);
    const text = ev.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta);
    expect(text).toEqual(['Vou listar o diretório atual e resumir os nomes em uma frase.', '\n\nHá um arquivo aqui: `nota.txt`.']);
    expect(ev.at(-1)).toEqual({ type: 'end', result: 'Há um arquivo aqui: `nota.txt`.', cliSessionId: THREAD });
  });

  it('resume keeps the same thread id', () => {
    expect(parse('codex-resume.jsonl').at(-1)).toMatchObject({ type: 'end', cliSessionId: THREAD });
  });

  it('an API failure is ONE error with the inner message (the item-level warning is not an error)', () => {
    const ev = parse('codex-error.jsonl');
    expect(ev).toEqual([{ type: 'error', message: "The 'modelo-que-nao-existe' model is not supported when using Codex with a ChatGPT account." }]);
  });

  it('ignores noise, unknown events and anything after the terminal event', () => {
    const p = new CodexStreamParser();
    expect(p.feed('not json')).toEqual([]);
    expect(p.feed('{"type":"something.new"}')).toEqual([]);
    expect(p.feed('{"type":"turn.completed","usage":{}}')).toEqual([{ type: 'end' }]);
    expect(p.feed('{"type":"item.completed","item":{"type":"agent_message","text":"late"}}')).toEqual([]);
  });

  it('codexErrorMessage handles JSON, plain text and garbage', () => {
    expect(codexErrorMessage('{"error":{"message":"limite atingido"}}')).toBe('limite atingido');
    expect(codexErrorMessage('{"message":"x"}')).toBe('x');
    expect(codexErrorMessage('texto simples')).toBe('texto simples');
    expect(codexErrorMessage(undefined)).toBe('codex reported an error');
  });
});

describe('buildCodexArgs', () => {
  const base = { prompt: 'SEGREDO', cwd: '/x' };
  it('fresh run: JSON, isolated, read-only, prompt only via stdin', () => {
    const args = buildCodexArgs({ ...base, model: 'gpt-x' });
    expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--model', 'gpt-x', '-']);
    expect(args.join(' ')).not.toContain('SEGREDO');
  });
  it('resume: subcommand + id, and no --sandbox (the flag does not exist there)', () => {
    const args = buildCodexArgs({ ...base, resumeSessionId: THREAD });
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', THREAD]);
    expect(args).not.toContain('--sandbox');
    expect(args.at(-1)).toBe('-');
  });
  it('options: isolate off, workspace-write', () => {
    const args = buildCodexArgs(base, { isolate: false, sandbox: 'workspace-write' });
    expect(args).not.toContain('--ignore-user-config');
    expect(args).toContain('workspace-write');
  });
  it('images go after the stdin marker, one --image each', () => {
    const args = buildCodexArgs({ ...base, images: ['/d/a.webp', '/d/b.webp'] });
    expect(args.slice(args.indexOf('-'))).toEqual(['-', '--image', '/d/a.webp', '--image', '/d/b.webp']);
  });
  it('rejects unsafe values instead of passing them on', () => {
    expect(() => buildCodexArgs({ ...base, images: ['a.png'] })).toThrow();
    expect(() => buildCodexArgs({ ...base, resumeSessionId: '--last' })).toThrow();
    expect(() => buildCodexArgs({ ...base, resumeSessionId: 'abc' })).toThrow();
    expect(() => buildCodexArgs({ ...base, model: '--bad' })).toThrow();
  });
  it('systemAppend is prepended on a first turn only', () => {
    expect(buildCodexPrompt({ ...base, systemAppend: 'Seja breve.' })).toBe('Seja breve.\n\n---\n\nSEGREDO');
    expect(buildCodexPrompt({ ...base, systemAppend: 'Seja breve.', resumeSessionId: THREAD })).toBe('SEGREDO');
  });
});

describe('codex-cli adapter (fake CLI replaying real output)', () => {
  it('streams events, ends with the thread id, sends the prompt on stdin and drops OPENAI_API_KEY', async () => {
    const events = await run('codex-text', { systemAppend: 'Instruções.' });
    expect(events.map((e) => e.type)).toEqual(['start', 'text', 'usage', 'end']);
    expect(events.at(-1)).toMatchObject({ type: 'end', cliSessionId: THREAD });
    const rec = record();
    expect(rec.stdin).toBe('Instruções.\n\n---\n\nfaça X');
    expect(rec.argv).toContain('--json');
    expect(rec.hasOpenaiKey).toBe(false);
  });

  it('resume passes the thread id', async () => {
    await run('codex-resume', { resumeSessionId: THREAD });
    expect(record().argv.slice(0, 3)).toEqual(['exec', 'resume', THREAD]);
  });

  it('a failing run is exactly one error (stream error, then the non-zero exit adds nothing)', async () => {
    const events = await run('codex-error');
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    expect(events.at(-1)).toMatchObject({ message: expect.stringContaining('not supported') });
  });

  it('exit 0 without a result is an error, not a silent success', async () => {
    const events = await run('noise');
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('unsupported request is start + error without spawning', async () => {
    const events = await run('codex-text', { images: ['a.png'] });
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    expect(() => readFileSync(join(dir, 'rec.json'))).toThrow();
  });
});
