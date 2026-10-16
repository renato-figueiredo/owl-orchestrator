import { Loader2, type LucideIcon } from 'lucide-react';
import { useId, useState, type ButtonHTMLAttributes, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';

/* Ported from design/claude-design/components/core/*. Inline styles use the design tokens (--c-*, --r-*, --h-*). */

const SIZES = { sm: { h: 'var(--h-ctl-sm)', px: 10, fs: 12 }, md: { h: 'var(--h-ctl)', px: 12, fs: 13 }, lg: { h: 'var(--h-ctl-lg)', px: 16, fs: 14 } } as const;
const VARIANTS = {
  primary: { bg: 'var(--c-accent)', fg: 'var(--c-accent-fg)', bd: 'transparent', hbg: 'var(--c-accent-hover)', hfg: 'var(--c-accent-fg)', hbd: 'transparent' },
  secondary: { bg: 'var(--c-raised)', fg: 'var(--c-fg)', bd: 'var(--c-line)', hbg: 'var(--c-overlay)', hfg: 'var(--c-fg)', hbd: 'var(--c-line-strong)' },
  ghost: { bg: 'transparent', fg: 'var(--c-muted)', bd: 'transparent', hbg: 'var(--c-raised)', hfg: 'var(--c-fg)', hbd: 'transparent' },
  danger: { bg: 'transparent', fg: 'var(--c-fg)', bd: 'var(--c-line)', hbg: 'var(--c-danger-wash)', hfg: 'var(--c-danger)', hbd: 'var(--c-danger)' },
} as const;

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** `primary` (amber) once per region: the main action or Aprovar. `danger` only tints on hover. */
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: LucideIcon;
  /** Shortcut shown on the right, e.g. "⌘A". */
  kbd?: string;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, kbd, loading = false, disabled = false, block = false, children, style, ...rest }: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const s = SIZES[size];
  const v = VARIANTS[variant];
  const off = disabled || loading;
  const h = hover && !off;
  return (
    <button
      type="button"
      disabled={off}
      aria-busy={loading || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPress(false);
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: block ? 'flex' : 'inline-flex',
        width: block ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: s.h,
        padding: `0 ${s.px}px`,
        borderRadius: 'var(--r-ctl)',
        border: `1px solid ${h ? v.hbd : v.bd}`,
        background: h ? v.hbg : v.bg,
        color: h ? v.hfg : v.fg,
        font: `${variant === 'primary' ? 600 : 500} ${s.fs}px var(--font-sans)`,
        cursor: off ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transform: press && !off ? 'translateY(1px)' : 'none',
        transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast), border-color var(--dur-fast)',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {loading ? <Loader2 size={s.fs + 2} aria-hidden="true" style={{ animation: 'owl-spin 0.8s linear infinite' }} /> : Icon ? <Icon size={s.fs + 2} aria-hidden="true" /> : null}
      {children}
      {kbd && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 4px', borderRadius: 'var(--r-xs)', background: variant === 'primary' ? 'rgba(1,7,54,0.15)' : 'var(--c-bg)', color: 'inherit', opacity: 0.85 }}>{kbd}</span>
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  active?: boolean;
  /** 40 in the rail; 28–32 in toolbars. */
  size?: number;
  /** Amber counter, only for what waits for the human. */
  badge?: number | string;
}

export function IconButton({ icon: Icon, label, active = false, size = 40, disabled = false, badge, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--r-ctl)',
        border: 0,
        background: active ? 'var(--c-raised)' : hover && !disabled ? 'var(--c-panel)' : 'transparent',
        color: active || (hover && !disabled) ? 'var(--c-fg)' : 'var(--c-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background var(--dur-fast), color var(--dur-fast)',
        ...style,
      }}
      {...rest}
    >
      <Icon size={size >= 40 ? 18 : 16} aria-hidden="true" />
      {badge != null && (
        <span style={{ position: 'absolute', top: 3, right: 3, minWidth: 15, height: 15, padding: '0 3px', boxSizing: 'border-box', borderRadius: 3, background: 'var(--c-accent)', color: 'var(--c-accent-fg)', font: '600 10px var(--font-mono)', display: 'grid', placeItems: 'center' }}>{badge}</span>
      )}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '16px', padding: '1px 6px', borderRadius: 'var(--r-sm)', border: '1px solid var(--c-line)', color: 'var(--c-muted)', background: 'transparent' }}>{children}</kbd>
  );
}

export interface InputProps {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  autoFocus?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/** Text field (input or textarea) with counter and error. Amber ring on focus, red on error. */
export function Input({ label, hint, error, mono = false, multiline = false, rows = 3, maxLength, value, defaultValue, onChange, disabled, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  const [len, setLen] = useState((value ?? defaultValue ?? '').length);
  const id = useId();
  const style: CSSProperties = {
    height: multiline ? 'auto' : 'var(--h-ctl)',
    padding: multiline ? '8px 10px' : '0 10px',
    resize: multiline ? 'vertical' : undefined,
    borderRadius: 'var(--r-ctl)',
    border: `1px solid ${error ? 'var(--c-danger)' : focus ? 'var(--c-accent)' : 'var(--c-line)'}`,
    background: 'var(--c-raised)',
    color: 'var(--c-fg)',
    font: `400 13px ${mono ? 'var(--font-mono)' : 'var(--font-sans)'}`,
    lineHeight: 1.5,
    outline: 'none',
  };
  const common = {
    id,
    maxLength,
    value,
    defaultValue,
    disabled,
    'aria-invalid': !!error || undefined,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLen(e.target.value.length);
      onChange?.(e);
    },
    style,
    ...rest,
  };
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--c-muted)', opacity: disabled ? 0.5 : 1 }}>
      {label && <span style={{ fontWeight: 500, color: 'var(--c-fg)' }}>{label}</span>}
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
      {(error || hint || maxLength) && (
        <span style={{ display: 'flex', gap: 8, color: error ? 'var(--c-danger)' : 'var(--c-muted)' }}>
          <span style={{ flex: 1 }}>{error || hint}</span>
          {maxLength && (
            <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {len}/{maxLength}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

/** Segmented control to switch the view of the same thing (Quadro/Lista). */
export function Tabs({ items, value, onChange, size = 'md', label }: { items: Array<string | { value: string; label: string }>; value: string; onChange?: (v: string) => void; size?: 'sm' | 'md'; label?: string }) {
  const h = size === 'sm' ? 26 : 32;
  return (
    <div role="tablist" aria-label={label} style={{ display: 'inline-flex', border: '1px solid var(--c-line)', borderRadius: 'var(--r-ctl)', overflow: 'hidden', height: h }}>
      {items.map((it) => {
        const k = typeof it === 'string' ? it : it.value;
        const l = typeof it === 'string' ? it : it.label;
        const on = k === value;
        return (
          <button
            key={k}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange?.(k)}
            style={{ padding: '0 12px', border: 0, borderRight: '1px solid var(--c-line)', background: on ? 'var(--c-raised)' : 'transparent', color: on ? 'var(--c-fg)' : 'var(--c-muted)', font: '500 12px var(--font-sans)', cursor: 'pointer' }}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

/** On/off. Square (radius 4), never a pill. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        style={{ width: 32, height: 18, borderRadius: 'var(--r-sm)', border: `1px solid ${checked ? 'var(--c-accent)' : 'var(--c-line-strong)'}`, background: checked ? 'var(--c-accent)' : 'var(--c-raised)', padding: 2, cursor: 'inherit', display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'background var(--dur-fast)' }}
      >
        <span style={{ width: 12, height: 12, borderRadius: 2, background: checked ? 'var(--c-accent-fg)' : 'var(--c-muted)' }} />
      </button>
      {label}
    </label>
  );
}
