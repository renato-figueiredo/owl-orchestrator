/**
 * Manual smoke test: runs one prompt with every adapter whose CLI is installed.
 *   pnpm --filter @owl/core try "olá" [--model haiku] [--only claude-cli] [--resume <session-id>]
 *   pnpm --filter @owl/core try --model haiku -- "--prompt starting with dashes"
 * Uses the real CLIs and your own login. Nothing is stored.
 */
import { listAdapters } from '../src/registry.js';
import type { RunEvent } from '../src/types.js';

const raw = process.argv.slice(2);
const sep = raw.indexOf('--');
// Everything after a bare `--` is the prompt, even if it looks like a flag.
const argv = sep >= 0 ? raw.slice(0, sep) : raw;
const literalPrompt = sep >= 0 ? raw.slice(sep + 1).join(' ') : undefined;
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const prompt = literalPrompt ?? argv.find((a, i) => !a.startsWith('--') && !['--model', '--only', '--resume'].includes(argv[i - 1] ?? ''));
if (!prompt) {
  console.error('usage: try "<prompt>" | try [opts] -- "<prompt>" [--model <m>] [--only <adapter-id>] [--resume <session-id>]');
  process.exit(2);
}
const model = flag('--model');
const only = flag('--only');
const resume = flag('--resume');

const ac = new AbortController();
process.once('SIGINT', () => ac.abort());

function print(e: RunEvent): void {
  switch (e.type) {
    case 'start': console.log(`[start] ${e.provider} ${e.model ?? ''} run=${e.runId}`); break;
    case 'text': process.stdout.write(e.delta); break;
    case 'tool': console.log(`\n[tool] ${e.name} ${JSON.stringify(e.input)}`); break;
    case 'usage': console.log(`\n[usage] in=${e.inputTokens ?? '?'} out=${e.outputTokens ?? '?'} cost=$${e.costUsd ?? '?'}`); break;
    case 'end': console.log(`[end] session=${e.cliSessionId ?? '-'}`); break;
    case 'error': console.log(`[error] ${e.message}`); break;
    case 'cancelled': console.log('[cancelled]'); break;
  }
}

let ran = 0;
for (const adapter of listAdapters()) {
  if (only && adapter.id !== only) continue;
  if (!(await adapter.isAvailable())) {
    console.log(`- ${adapter.id}: not installed, skipped`);
    continue;
  }
  ran++;
  console.log(`\n=== ${adapter.id}`);
  for await (const e of adapter.run(
    { prompt, cwd: process.cwd(), ...(model ? { model } : {}), ...(resume ? { resumeSessionId: resume } : {}) },
    ac.signal,
  )) print(e);
}
if (ran === 0) console.log('No CLI available.');
