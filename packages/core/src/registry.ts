import { createClaudeCliAdapter } from './adapters/claude-cli.js';
import { createCodexCliAdapter } from './adapters/codex-cli.js';
import { createOllamaAdapter } from './adapters/ollama.js';
import { childEnv } from './process.js';
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

// The CLIs get a filtered copy of the environment, not the server's own (see `childEnv`).
const passthrough = (process.env.OWL_ENV_PASSTHROUGH ?? '').split(',').map((x) => x.trim()).filter(Boolean);
registerAdapter(createClaudeCliAdapter({ env: childEnv(process.env, passthrough) }));
registerAdapter(createCodexCliAdapter({ env: childEnv(process.env, passthrough) }));
// Ollama is optional and runs outside this repository: without it the adapter just reports "unavailable".
try {
  registerAdapter(
    createOllamaAdapter({
      ...(process.env.OLLAMA_MODEL ? { defaultModel: process.env.OLLAMA_MODEL } : {}),
      allowRemote: process.env.OWL_OLLAMA_ALLOW_REMOTE === '1',
      ...(process.env.OLLAMA_USE_MMAP === '0' ? { useMmap: false } : {}),
    }),
  );
} catch (e) {
  console.warn(`ollama adapter disabled: ${e instanceof Error ? e.message : String(e)}`);
}
