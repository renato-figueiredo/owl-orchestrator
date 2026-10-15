// Fake CLI used by tests. Behavior is selected with FAKE_SCENARIO; what it received goes to FAKE_RECORD.
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('fake-cli 1.0.0');
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;

if (process.env.FAKE_RECORD) {
  writeFileSync(
    process.env.FAKE_RECORD,
    JSON.stringify({
      argv,
      stdin,
      cwd: process.cwd(),
      pid: process.pid,
      hasAnthropicKey: 'ANTHROPIC_API_KEY' in process.env,
      hasOpenaiKey: 'OPENAI_API_KEY' in process.env,
    }),
  );
}

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const emit = (text) => process.stdout.write(text);
const scenario = process.env.FAKE_SCENARIO ?? 'text';

switch (scenario) {
  case 'text':
    emit(fixture('claude-text-partial.jsonl'));
    break;
  case 'tool':
    emit(fixture('claude-tool.jsonl'));
    break;
  case 'error':
    emit(fixture('claude-error.jsonl'));
    process.exitCode = 1;
    break;
  case 'noise':
    emit('not json at all\n\n{broken\n');
    emit(fixture('claude-text-partial.jsonl'));
    break;
  case 'noresult':
    emit(fixture('claude-text-partial.jsonl').split('\n').slice(0, 2).join('\n') + '\n');
    break;
  case 'crash':
    console.error('boom: something went wrong\nsecond line');
    process.exitCode = 3;
    break;
  case 'hang':
  case 'ignoreterm':
    if (scenario === 'ignoreterm') process.on('SIGTERM', () => {});
    emit(fixture('claude-text-partial.jsonl').split('\n').slice(0, 2).join('\n') + '\n');
    setInterval(() => {}, 1000);
    await new Promise(() => {});
    break;
  case 'empty':
    emit(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: '0ebc5870-da74-48ab-88a4-2e4c4aaeb936', usage: {} }) + '\n');
    break;
  case 'codex-text':
    emit(fixture('codex-text.jsonl'));
    break;
  case 'codex-resume':
    emit(fixture('codex-resume.jsonl'));
    break;
  case 'codex-tool':
    emit(fixture('codex-tool.jsonl'));
    break;
  case 'codex-error':
    emit(fixture('codex-error.jsonl'));
    process.exitCode = 1;
    break;
}
