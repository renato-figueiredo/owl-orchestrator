import React from 'react';

export function IconButton({ icon, label, active = false, size = 40, disabled = false, badge, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active || undefined} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: 'var(--r-ctl)', border: 0,
        background: active ? 'var(--c-raised)' : hover && !disabled ? 'var(--c-panel)' : 'transparent',
        color: active || (hover && !disabled) ? 'var(--c-fg)' : 'var(--c-muted)', fontSize: size >= 40 ? 18 : 16,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, transition: 'background var(--dur-fast), color var(--dur-fast)', ...style }} {...rest}>
      <i className={`icon-${icon}`} aria-hidden="true" />
      {badge != null && <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 'var(--r-sm)', background: 'var(--c-accent)', color: 'var(--c-accent-fg)', font: '600 10px var(--font-mono)', display: 'grid', placeItems: 'center' }}>{badge}</span>}
    </button>
  );
}
