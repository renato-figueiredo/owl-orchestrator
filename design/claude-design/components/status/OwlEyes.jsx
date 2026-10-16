import React from 'react';
export function OwlEyes({ size = 4, color = 'var(--c-status-running)', animated = true }) {
  const dot = { width: size, height: size, borderRadius: '50%', background: color, display: 'block', animation: animated ? 'owl-eyes 3.2s ease-in-out infinite' : 'none' };
  return <span aria-hidden="true" style={{ display: 'inline-flex', gap: Math.max(2, size / 2), alignItems: 'center' }}><span style={dot} /><span style={dot} /></span>;
}
