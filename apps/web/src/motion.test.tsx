// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FadeIn, ListAnimated, Pulse, StreamCaret, useMotionPreference } from '@owl/ui';

function mockMedia(reduce: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: reduce,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  vi.stubGlobal('matchMedia', () => mq);
  return { set: (v: boolean) => { mq.matches = v; listeners.forEach((f) => f()); } };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useMotionPreference', () => {
  it('reflects prefers-reduced-motion and follows changes', () => {
    const m = mockMedia(true);
    const { result } = renderHook(() => useMotionPreference());
    expect(result.current.reduced).toBe(true);
    act(() => m.set(false));
    expect(result.current.reduced).toBe(false);
  });
  it('is not reduced when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useMotionPreference()).result.current.reduced).toBe(false);
  });
});

describe('primitives under reduced motion', () => {
  it('FadeIn renders visible at once, with no initial offset', () => {
    mockMedia(true);
    render(<FadeIn>olá</FadeIn>);
    const el = screen.getByText('olá');
    expect(el.style.opacity).not.toBe('0');
    expect(el.style.transform === '' || el.style.transform === 'none').toBe(true);
  });
  it('StreamCaret is aria-hidden and keeps a fixed width (no layout shift)', () => {
    mockMedia(true);
    render(<StreamCaret />);
    const el = screen.getByText('▍');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.style.width).toBe('0.5ch');
  });
  it('Pulse and ListAnimated render their children', () => {
    mockMedia(true);
    render(<Pulse>a</Pulse>);
    render(<ListAnimated><li>b</li></ListAnimated>);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});

describe('boundaries', () => {
  const root = join(__dirname, '../../..');
  const LIBS = ['"motion"', '"@formkit/auto-animate"', '"@dnd-kit/'];
  it('animation libraries are only dependencies of apps/web and packages/ui', () => {
    const dirs = [...readdirSync(join(root, 'apps')).map((d) => `apps/${d}`), ...readdirSync(join(root, 'packages')).map((d) => `packages/${d}`)];
    for (const d of dirs) {
      if (d === 'apps/web' || d === 'packages/ui') continue;
      const file = join(root, d, 'package.json');
      if (!statSync(root).isDirectory()) continue;
      let txt = '';
      try { txt = readFileSync(file, 'utf8'); } catch { continue; }
      for (const lib of LIBS) expect(txt, `${d} must not depend on ${lib}`).not.toContain(lib);
    }
  });
});
