import React from 'react';
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange && onChange(!checked)}
        style={{ width: 32, height: 18, borderRadius: 'var(--r-sm)', border: `1px solid ${checked ? 'var(--c-accent)' : 'var(--c-line-strong)'}`, background: checked ? 'var(--c-accent)' : 'var(--c-raised)', padding: 2, cursor: 'inherit', display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'background var(--dur-fast)' }}>
        <span style={{ width: 12, height: 12, borderRadius: 2, background: checked ? 'var(--c-accent-fg)' : 'var(--c-muted)' }} />
      </button>
      {label}
    </label>
  );
}
