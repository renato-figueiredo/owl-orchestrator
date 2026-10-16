import React from 'react';
import { OwlEyes } from '../status/OwlEyes';

const NODE = {
  done: { c: 'var(--c-status-done)', fill: true },
  running: { c: 'var(--c-status-running)', fill: false },
  think: { c: 'var(--c-muted)', fill: false },
  failed: { c: 'var(--c-status-failed)', fill: true },
  waiting: { c: 'var(--c-status-waiting-human)', fill: true },
};

export function RunStep({ time, name, detail, duration, status = 'done', expanded = false, onToggle, last = false, children }) {
  const n = NODE[status];
  const can = !!children;
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '52px 20px 1fr', alignItems: 'start', listStyle: 'none', animation: 'owl-slide-in var(--dur) var(--ease-out)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)', textAlign: 'right', paddingRight: 8, paddingTop: 1, fontVariantNumeric: 'tabular-nums' }}>{time}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 4, flex: 'none', boxSizing: 'border-box', border: `1.5px solid ${n.c}`, background: n.fill ? n.c : 'transparent' }} />
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--c-line)', minHeight: 14 }} />}
      </span>
      <div style={{ padding: '0 0 14px 6px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <button type="button" onClick={can ? onToggle : undefined} aria-expanded={can ? expanded : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: can ? 'pointer' : 'default', textAlign: 'left' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: status === 'failed' ? 'var(--c-danger)' : 'var(--c-fg)' }}>{name}</span>
          {status === 'running' && <OwlEyes />}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{duration}</span>
          {can && <i className={expanded ? 'icon-chevron-up' : 'icon-chevron-down'} style={{ fontSize: 12, color: 'var(--c-muted)' }} />}
        </button>
        {detail && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>}
        {expanded && children && <div style={{ marginTop: 6, background: 'var(--c-bg)', border: '1px solid var(--c-line)', borderRadius: 'var(--r-ctl)', padding: '6px 0', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6, overflow: 'hidden', animation: 'owl-fade-in var(--dur) var(--ease-out)' }}>{children}</div>}
      </div>
    </li>
  );
}
