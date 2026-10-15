import { createClaudeCliAdapter } from './adapters/claude-cli.js';
import { createCodexCliAdapter } from './adapters/codex-cli.js';
import type { ProviderAdapter } from './types.js';

const adapters = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: string): ProviderAdapter {
  const a = adapters.get(id);
  if (!a) throw new Error(`Unknown provider adapter: ${id}. Known: ${[...adapters.keys()].join(', ')}`);
  return a;
}

export function listAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}

registerAdapter(createClaudeCliAdapter());
registerAdapter(createCodexCliAdapter());
