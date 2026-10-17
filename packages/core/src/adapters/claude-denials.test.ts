import { describe, expect, it } from 'vitest';
import { ClaudeStreamParser } from './claude-stream.js';

describe('ClaudeStreamParser permission_denials', () => {
  it('reports the refused Bash command and the model\'s reason on the end event', () => {
    const p = new ClaudeStreamParser();
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 },
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'pnpm --filter x exec vitest run', description: 'Rodar o teste' } },
        { tool_name: 'Write', tool_use_id: 't2', tool_input: { file_path: '/etc/x' } },
      ],
    });
    const end = p.feed(line).find((e) => e.type === 'end');
    expect(end).toMatchObject({ type: 'end', result: 'ok', denied: [{ name: 'Bash', command: 'pnpm --filter x exec vitest run', descricao: 'Rodar o teste' }, { name: 'Write' }] });
  });
  it('no denials, no field', () => {
    const end = new ClaudeStreamParser().feed(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: {} })).find((e) => e.type === 'end');
    expect(end).not.toHaveProperty('denied');
  });
});
