import React from 'react';
export function Tabs({ items, value, onChange, size = 'md' }) {
  const h = size === 'sm' ? 26 : 32;
  return (
    <div role="tablist" style={{ display: 'inline-flex', border: '1px solid var(--c-line)', borderRadius: 'var(--r-ctl)', overflow: 'hidden', height: h }}>
      {items.map((it) => {
        const k = typeof it === 'string' ? it : it.value; const l = typeof it === 'string' ? it : it.label;
        const on = k === value;
        return <button key={k} role="tab" aria-selected={on} type="button" onClick={() => onChange && onChange(k)}
          style={{ padding: '0 12px', border: 0, borderRight: '1px solid var(--c-line)', background: on ? 'var(--c-raised)' : 'transparent', color: on ? 'var(--c-fg)' : 'var(--c-muted)', font: '500 12px var(--font-sans)', cursor: 'pointer' }}>{l}</button>;
      })}
    </div>
  );
}
