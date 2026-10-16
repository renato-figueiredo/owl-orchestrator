import React from 'react';

const SIZES = { sm: { h: 'var(--h-ctl-sm)', px: 10, fs: 12 }, md: { h: 'var(--h-ctl)', px: 12, fs: 13 }, lg: { h: 'var(--h-ctl-lg)', px: 16, fs: 14 } };
const VARIANTS = {
  primary: { bg: 'var(--c-accent)', fg: 'var(--c-accent-fg)', bd: 'transparent', hbg: 'var(--c-accent-hover)', hfg: 'var(--c-accent-fg)', hbd: 'transparent' },
  secondary: { bg: 'var(--c-raised)', fg: 'var(--c-fg)', bd: 'var(--c-line)', hbg: 'var(--c-overlay)', hfg: 'var(--c-fg)', hbd: 'var(--c-line-strong)' },
  ghost: { bg: 'transparent', fg: 'var(--c-muted)', bd: 'transparent', hbg: 'var(--c-raised)', hfg: 'var(--c-fg)', hbd: 'transparent' },
  danger: { bg: 'transparent', fg: 'var(--c-fg)', bd: 'var(--c-line)', hbg: 'var(--c-danger-wash)', hfg: 'var(--c-danger)', hbd: 'var(--c-danger)' },
};

export function Button({ variant = 'secondary', size = 'md', icon, kbd, loading = false, disabled = false, block = false, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size]; const v = VARIANTS[variant];
  const off = disabled || loading;
  const h = hover && !off;
  return (
    <button type="button" disabled={off} aria-busy={loading || undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)}
      style={{ display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined, alignItems: 'center', justifyContent: 'center', gap: 8,
        height: s.h, padding: `0 ${s.px}px`, borderRadius: 'var(--r-ctl)', border: `1px solid ${h ? v.hbd : v.bd}`,
        background: h ? v.hbg : v.bg, color: h ? v.hfg : v.fg, font: `${variant === 'primary' ? 600 : 500} ${s.fs}px var(--font-sans)`,
        cursor: off ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, transform: press && !off ? 'translateY(1px)' : 'none',
        transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast), border-color var(--dur-fast)', whiteSpace: 'nowrap', ...style }} {...rest}>
      {loading ? <i className="icon-loader-circle" aria-hidden="true" style={{ fontSize: s.fs + 2, animation: 'owl-spin 0.8s linear infinite', display: 'inline-block' }} />
        : icon ? <i className={`icon-${icon}`} aria-hidden="true" style={{ fontSize: s.fs + 2 }} /> : null}
      {children}
      {kbd && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 4px', borderRadius: 'var(--r-xs)', background: variant === 'primary' ? 'rgba(1,7,54,0.15)' : 'var(--c-bg)', color: 'inherit', opacity: 0.85 }}>{kbd}</span>}
    </button>
  );
}
