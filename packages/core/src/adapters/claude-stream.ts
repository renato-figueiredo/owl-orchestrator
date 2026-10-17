import type { DeniedTool, RunEvent } from '../types.js';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** `permission_denials` of the CLI's result: what the model tried and was not allowed to run. */
function deniedTools(v: unknown): DeniedTool[] {
  if (!Array.isArray(v)) return [];
  const out: DeniedTool[] = [];
  for (const d of v) {
    if (!isObj(d) || typeof d.tool_name !== 'string') continue;
    const input = isObj(d.tool_input) ? d.tool_input : {};
    out.push({
      name: d.tool_name,
      ...(typeof input.command === 'string' ? { command: input.command.slice(0, 1000) } : {}),
      ...(typeof input.description === 'string' ? { descricao: input.description.slice(0, 300) } : {}),
    });
  }
  return out;
}

/**
 * Translates `claude -p --output-format stream-json --verbose --include-partial-messages` lines into RunEvents.
 * Event shapes were captured from the real CLI (see test/fixtures). Unknown events are ignored, so new CLI
 * versions degrade gracefully instead of breaking the run.
 */
export class ClaudeStreamParser {
  /** Messages for which we already streamed text deltas (avoid printing the same text twice). */
  private readonly streamed = new Set<string>();
  private terminal = false;
  model: string | undefined;

  /** True once a `result` event was seen. */
  get finished(): boolean {
    return this.terminal;
  }

  feed(line: string): RunEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return []; // non-JSON noise on stdout
    }
    if (!isObj(raw)) return [];

    switch (raw.type) {
      case 'system':
        if (raw.subtype === 'init' && typeof raw.model === 'string') this.model = raw.model;
        return [];
      case 'stream_event':
        return this.streamEvent(raw);
      case 'assistant':
        return this.assistant(raw);
      case 'result':
        return this.result(raw);
      default:
        return [];
    }
  }

  private streamEvent(raw: Json): RunEvent[] {
    if (raw.parent_tool_use_id) return []; // text produced inside sub-agents
    const ev = raw.event;
    if (!isObj(ev) || ev.type !== 'content_block_delta' || !isObj(ev.delta)) return [];
    if (ev.delta.type !== 'text_delta' || typeof ev.delta.text !== 'string' || ev.delta.text === '') return [];
    if (typeof raw.api_message_id === 'string') this.streamed.add(raw.api_message_id);
    return [{ type: 'text', delta: ev.delta.text }];
  }

  private assistant(raw: Json): RunEvent[] {
    const msg = raw.message;
    if (!isObj(msg) || !Array.isArray(msg.content)) return [];
    const out: RunEvent[] = [];
    const alreadyStreamed = typeof msg.id === 'string' && this.streamed.has(msg.id);
    for (const block of msg.content) {
      if (!isObj(block)) continue;
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        out.push({ type: 'tool', name: block.name, input: block.input });
      } else if (block.type === 'text' && typeof block.text === 'string' && block.text && !alreadyStreamed && !raw.parent_tool_use_id) {
        out.push({ type: 'text', delta: block.text }); // CLI did not stream partials for this message
      }
    }
    return out;
  }

  private result(raw: Json): RunEvent[] {
    this.terminal = true;
    const out: RunEvent[] = [];
    const usage = isObj(raw.usage) ? raw.usage : {};
    const input =
      (num(usage.input_tokens) ?? 0) +
      (num(usage.cache_creation_input_tokens) ?? 0) +
      (num(usage.cache_read_input_tokens) ?? 0);
    const costUsd = num(raw.total_cost_usd);
    out.push({
      type: 'usage',
      inputTokens: input,
      ...(num(usage.output_tokens) !== undefined ? { outputTokens: num(usage.output_tokens)! } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    });
    const text = typeof raw.result === 'string' ? raw.result : undefined;
    // NOTE: errors arrive with subtype "success"; `is_error` is the reliable flag.
    if (raw.is_error === true || (typeof raw.subtype === 'string' && raw.subtype.startsWith('error'))) {
      out.push({ type: 'error', message: text ?? `claude finished with ${String(raw.subtype ?? 'an error')}` });
    } else {
      const denied = deniedTools(raw.permission_denials);
      out.push({
        type: 'end',
        ...(denied.length ? { denied } : {}),
        ...(text !== undefined ? { result: text } : {}),
        ...(typeof raw.session_id === 'string' ? { cliSessionId: raw.session_id } : {}),
      });
    }
    return out;
  }
}
