import React from 'react';
export function Input({ label, hint, error, mono = false, multiline = false, rows = 3, maxLength, value, defaultValue, onChange, disabled, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const [len, setLen] = React.useState((value ?? defaultValue ?? '').length);
  const Tag = multiline ? 'textarea' : 'input';
  const id = React.useId();
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--c-muted)', opacity: disabled ? 0.5 : 1 }}>
      {label && <span style={{ fontWeight: 500, color: 'var(--c-fg)' }}>{label}</span>}
      <Tag id={id} rows={multiline ? rows : undefined} maxLength={maxLength} value={value} defaultValue={defaultValue} disabled={disabled}
        aria-invalid={!!error || undefined}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={(e) => { setLen(e.target.value.length); onChange && onChange(e); }}
        style={{ height: multiline ? 'auto' : 'var(--h-ctl)', padding: multiline ? '8px 10px' : '0 10px', resize: multiline ? 'vertical' : undefined,
          borderRadius: 'var(--r-ctl)', border: `1px solid ${error ? 'var(--c-danger)' : focus ? 'var(--c-accent)' : 'var(--c-line)'}`,
          background: 'var(--c-raised)', color: 'var(--c-fg)', font: `400 13px ${mono ? 'var(--font-mono)' : 'var(--font-sans)'}`, lineHeight: 1.5, outline: 'none' }} {...rest} />
      {(error || hint || maxLength) && (
        <span style={{ display: 'flex', gap: 8, color: error ? 'var(--c-danger)' : 'var(--c-muted)' }}>
          <span style={{ flex: 1 }}>{error || hint}</span>
          {maxLength && <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{len}/{maxLength}</span>}
        </span>
      )}
    </label>
  );
}
