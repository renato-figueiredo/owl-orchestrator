import React from 'react';
import { OwlEyes } from './OwlEyes';

const MAP = {
  running: { label: 'rodando', c: 'var(--c-status-running)' },
  waiting: { label: 'aguardando você', c: 'var(--c-status-waiting-human)', g: '▲' },
  queued: { label: 'na fila', c: 'var(--c-status-queued)', g: '○' },
  failed: { label: 'falhou', c: 'var(--c-status-failed)', g: '✕' },
  done: { label: 'concluído', c: 'var(--c-status-done)', g: '✓' },
  cancelled: { label: 'cancelado', c: 'var(--c-status-cancelled)', g: '—' },
};

export function StatusPill({ status, label, time, bare = false }) {
  const m = MAP[status];
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: bare ? 0 : '0 8px', borderRadius: 'var(--r-sm)', background: bare ? 'transparent' : 'var(--c-raised)', fontSize: 12, color: 'var(--c-fg)', whiteSpace: 'nowrap' }}>
      {status === 'running' ? <OwlEyes /> : <span aria-hidden="true" style={{ color: m.c, fontFamily: 'var(--font-mono)', fontSize: 11, width: 10, textAlign: 'center' }}>{m.g}</span>}
      <span style={{ color: status === 'waiting' || status === 'failed' ? m.c : 'var(--c-fg)' }}>{label || m.label}</span>
      {time && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{time}</span>}
    </span>
  );
}
