import React from 'react';
export function Kbd({ children }) {
  return <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '16px', padding: '1px 6px', borderRadius: 'var(--r-sm)', border: '1px solid var(--c-line)', color: 'var(--c-muted)', background: 'transparent' }}>{children}</kbd>;
}
