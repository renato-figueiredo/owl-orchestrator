import React from 'react';
import { OwlEyes } from './OwlEyes';
const PROV = { 'claude-cli': 'var(--c-prov-claude-cli)', 'codex-cli': 'var(--c-prov-codex-cli)', ollama: 'var(--c-prov-ollama)' };
export function AgentTag({ name, provider, model, running = false, showProvider = false }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-fg)', minWidth: 0 }}>
      {running && <OwlEyes />}
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 'var(--r-xs)', flex: 'none', background: PROV[provider] || 'var(--c-prov-other)' }} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      {showProvider && <span style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>adaptador: {provider}{model ? ` · ${model}` : ''}</span>}
    </span>
  );
}
