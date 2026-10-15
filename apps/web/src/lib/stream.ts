import type { RunEvent } from './types';

export interface ToolCall {
  name: string;
  input?: unknown;
}
export interface StreamState {
  phase: 'connecting' | 'running' | 'ended' | 'error' | 'cancelled';
  text: string;
  tools: ToolCall[];
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

export const initialStream: StreamState = { phase: 'connecting', text: '', tools: [] };

/** `start` resets everything: after an automatic reconnect the server replays the whole run from its first event. */
export function reduceStream(state: StreamState, e: RunEvent): StreamState {
  switch (e.type) {
    case 'start':
      return { ...initialStream, phase: 'running', provider: e.provider, ...(e.model ? { model: e.model } : {}) };
    case 'text':
      return { ...state, phase: 'running', text: state.text + e.delta };
    case 'tool':
      return { ...state, tools: [...state.tools, { name: e.name, ...(e.input !== undefined ? { input: e.input } : {}) }] };
    case 'usage':
      return {
        ...state,
        ...(e.inputTokens !== undefined ? { inputTokens: e.inputTokens } : {}),
        ...(e.outputTokens !== undefined ? { outputTokens: e.outputTokens } : {}),
        ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
      };
    case 'end':
      return { ...state, phase: 'ended', ...(e.result !== undefined && !state.text ? { text: e.result } : {}) };
    case 'error':
      return { ...state, phase: 'error', error: e.message };
    case 'cancelled':
      return { ...state, phase: 'cancelled' };
  }
}

export const isTerminal = (e: RunEvent) => e.type === 'end' || e.type === 'error' || e.type === 'cancelled';

export const EVENT_TYPES = ['start', 'text', 'tool', 'usage', 'end', 'error', 'cancelled'] as const;
