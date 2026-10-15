import type { RunEvent } from '../types.js';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** Item types that are tool activity. Anything else (reasoning, warnings...) is not shown. */
const TOOL_ITEMS: Record<string, string> = {
  command_execution: 'command',
  file_change: 'file_change',
  mcp_tool_call: 'mcp_tool_call',
  web_search: 'web_search',
};

/**
 * The CLI reports API failures as a JSON string inside `message`
 * (`{"type":"error","status":400,"error":{"message":"..."}}`); show the inner message when there is one.
 */
export function codexErrorMessage(raw: unknown): string {
  if (typeof raw !== 'string') return 'codex reported an error';
  try {
    const v: unknown = JSON.parse(raw);
    if (isObj(v) && isObj(v.error) && typeof v.error.message === 'string') return v.error.message;
    if (isObj(v) && typeof v.message === 'string') return v.message;
  } catch {
    /* plain text */
  }
  return raw;
}

/**
 * Translates `codex exec --json` lines into RunEvents. Shapes were captured from the real CLI
 * (codex-cli 0.162, see test/fixtures/codex-*.jsonl). Unknown events are ignored.
 *
 * Differences from Claude worth knowing: there are no text deltas (each `agent_message` arrives whole, and a
 * run may have several: the first ones are usually "I will do X"), the session id is the `thread_id`, and usage
 * has no cost.
 */
export class CodexStreamParser {
  private threadId: string | undefined;
  private lastMessage: string | undefined;
  private sawText = false;
  private done = false;
  private readonly toolsSeen = new Set<string>();
  readonly model: string | undefined = undefined;

  feed(line: string): RunEvent[] {
    const trimmed = line.trim();
    if (!trimmed || this.done) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return []; // non-JSON noise on stdout
    }
    if (!isObj(raw)) return [];

    switch (raw.type) {
      case 'thread.started':
        if (typeof raw.thread_id === 'string') this.threadId = raw.thread_id;
        return [];
      case 'item.started':
      case 'item.completed':
        return this.item(raw);
      case 'turn.completed':
        return this.completed(raw);
      case 'turn.failed': {
        this.done = true;
        const e = isObj(raw.error) ? raw.error.message : undefined;
        return [{ type: 'error', message: codexErrorMessage(e) }];
      }
      case 'error':
        // Followed by `turn.failed`; report once, here.
        this.done = true;
        return [{ type: 'error', message: codexErrorMessage(raw.message) }];
      default:
        return [];
    }
  }

  private item(raw: Json): RunEvent[] {
    const item = raw.item;
    if (!isObj(item) || typeof item.type !== 'string') return [];
    if (item.type === 'agent_message' && raw.type === 'item.completed' && typeof item.text === 'string' && item.text) {
      this.lastMessage = item.text;
      const delta = this.sawText ? `\n\n${item.text}` : item.text;
      this.sawText = true;
      return [{ type: 'text', delta }];
    }
    const tool = TOOL_ITEMS[item.type];
    if (!tool) return [];
    const id = typeof item.id === 'string' ? item.id : undefined;
    if (id) {
      if (this.toolsSeen.has(id)) return []; // announced on `started`; `completed` repeats it
      this.toolsSeen.add(id);
    }
    const input = item.type === 'command_execution' && typeof item.command === 'string' ? { command: item.command } : undefined;
    return [{ type: 'tool', name: tool, ...(input ? { input } : {}) }];
  }

  private completed(raw: Json): RunEvent[] {
    this.done = true;
    const usage = isObj(raw.usage) ? raw.usage : {};
    const out: RunEvent[] = [];
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    if (input !== undefined || output !== undefined) {
      out.push({
        type: 'usage',
        ...(input !== undefined ? { inputTokens: input } : {}),
        ...(output !== undefined ? { outputTokens: output } : {}),
      });
    }
    out.push({
      type: 'end',
      // The answer is the LAST message; earlier ones are progress notes.
      ...(this.lastMessage !== undefined ? { result: this.lastMessage } : {}),
      ...(this.threadId ? { cliSessionId: this.threadId } : {}),
    });
    return out;
  }
}
