import type { ReactNode } from 'react';

/* Ported from design/claude-design/components/status/*. */

/** The owl's eyes: the "running" indicator. Cream, never amber. Blinks slowly; still with reduced motion (global CSS). */
export function OwlEyes({ size = 4, color = 'var(--c-status-running)', animated = true }: { size?: number; color?: string; animated?: boolean }) {
  const dot = { width: size, height: size, borderRadius: '50%', background: color, display: 'block', animation: animated ? 'owl-eyes 3.2s ease-in-out infinite' : 'none' } as const;
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', gap: Math.max(2, size / 2), alignItems: 'center' }}>
      <span style={dot} />
      <span style={dot} />
    </span>
  );
}

const MAP = {
  running: { label: 'rodando', c: 'var(--c-status-running)', g: '' },
  waiting: { label: 'aguardando você', c: 'var(--c-status-waiting-human)', g: '▲' },
  queued: { label: 'na fila', c: 'var(--c-status-queued)', g: '○' },
  failed: { label: 'falhou', c: 'var(--c-status-failed)', g: '✕' },
  done: { label: 'concluído', c: 'var(--c-status-done)', g: '✓' },
  cancelled: { label: 'cancelado', c: 'var(--c-status-cancelled)', g: '—' },
} as const;
export type RunStatus = keyof typeof MAP;

/** Run status: shape + text, never colour alone. */
export function StatusPill({ status, label, time, bare = false }: { status: RunStatus; label?: string; time?: string; bare?: boolean }) {
  const m = MAP[status];
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: bare ? 0 : '0 8px', borderRadius: 'var(--r-sm)', background: bare ? 'transparent' : 'var(--c-raised)', fontSize: 12, color: 'var(--c-fg)', whiteSpace: 'nowrap' }}>
      {status === 'running' ? (
        <OwlEyes />
      ) : (
        <span aria-hidden="true" style={{ color: m.c, fontFamily: 'var(--font-mono)', fontSize: 11, width: 10, textAlign: 'center' }}>
          {m.g}
        </span>
      )}
      <span style={{ color: status === 'waiting' || status === 'failed' ? m.c : 'var(--c-fg)' }}>{label || m.label}</span>
      {time && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{time}</span>}
    </span>
  );
}

const PROV: Record<string, string> = { 'claude-cli': 'var(--c-prov-claude-cli)', 'codex-cli': 'var(--c-prov-codex-cli)', ollama: 'var(--c-prov-ollama)' };
export const providerColor = (provider?: string | null) => (provider && PROV[provider]) || 'var(--c-prov-other)';

/** Provider marker: a 6px square, never a background. The provider name appears only as data. */
export function ProviderDot({ provider }: { provider?: string | null | undefined }) {
  return <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 'var(--r-xs)', flex: 'none', background: providerColor(provider), display: 'inline-block' }} />;
}

export function AgentTag({ name, provider, model, running = false, showProvider = false }: { name: string; provider?: string | null | undefined; model?: string | null | undefined; running?: boolean; showProvider?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-fg)', minWidth: 0 }}>
      {running && <OwlEyes />}
      <ProviderDot provider={provider} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      {showProvider && (
        <span style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
          adaptador: {provider}
          {model ? ` · ${model}` : ''}
        </span>
      )}
    </span>
  );
}

export type { ReactNode };
