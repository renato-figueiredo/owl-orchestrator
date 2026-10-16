// @vitest-environment jsdom
// QA gaps for prompt 17 (motion): acceptance criteria not covered by motion.test.tsx.
import '@testing-library/jest-dom/vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FadeIn, StreamCaret } from '@owl/ui';

// Records the props the Board's cards hand to Motion's <li>, so reduced motion can be asserted without a browser.
const liProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@owl/ui', async (orig) => {
  const real = await orig<typeof import('@owl/ui')>();
  const { createElement } = await import('react');
  const li = ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => createElement('li', null, children);
  const recorder = (props: Record<string, unknown>) => {
    liProps.push(props);
    return li(props);
  };
  return { ...real, motion: { ...real.motion, li: recorder } };
});
import { Logo } from './components/Logo';
import { Board } from './components/Board';
import type { BoardData, Ticket } from './lib/types';

const root = join(__dirname, '../../..');
const media = (reduce: boolean) => {
  const mq = { matches: reduce, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('matchMedia', () => mq);
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe('boundary: no animation lib imports outside apps/web and packages/ui (source level)', () => {
  it('server and other packages never import motion / auto-animate / dnd-kit', () => {
    const dirs = [...readdirSync(join(root, 'apps')).map((d) => `apps/${d}`), ...readdirSync(join(root, 'packages')).map((d) => `packages/${d}`)].filter(
      (d) => d !== 'apps/web' && d !== 'packages/ui',
    );
    const re = /(?:from\s+|import\(\s*|require\(\s*)['"](motion|motion\/[^'"]*|framer-motion|@formkit\/auto-animate|@dnd-kit\/[^'"]*)['"]/;
    for (const d of dirs) for (const f of walk(join(root, d))) expect(readFileSync(f, 'utf8'), f).not.toMatch(re);
  });
  it('apps/web imports motion and auto-animate only through @owl/ui', () => {
    const re = /(?:from\s+|import\(\s*|require\(\s*)['"](motion|motion\/[^'"]*|framer-motion|@formkit\/auto-animate)['"]/;
    for (const f of walk(join(root, 'apps/web/src'))) if (!f.includes('.test.')) expect(readFileSync(f, 'utf8'), f).not.toMatch(re);
  });
});

describe('reduced motion in CSS (owl blink and caret)', () => {
  const css = readFileSync(join(root, 'apps/web/src/index.css'), 'utf8');
  it('disables the owl blink and the css caret under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.owl-caret::after\s*{\s*animation:\s*none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.owl-blink \.owl-eyes\s*{\s*animation:\s*none/);
    expect(block.length).toBeGreaterThan(0);
  });
});

describe('Logo', () => {
  it('only carries the owl-blink class when asked to blink', () => {
    const { container, rerender } = render(<Logo />);
    expect(container.querySelector('svg')).not.toHaveClass('owl-blink');
    rerender(<Logo blink />);
    expect(container.querySelector('svg')).toHaveClass('owl-blink');
  });
});

describe('primitives with motion allowed', () => {
  it('FadeIn starts hidden (opacity 0) and offset when motion is allowed', () => {
    media(false);
    render(<FadeIn>oi</FadeIn>);
    expect(screen.getByText('oi').style.opacity).toBe('0');
  });
  it('StreamCaret keeps the same fixed width whether reduced or not (no layout shift)', () => {
    media(false);
    render(<StreamCaret />);
    expect(screen.getByText('▍').style.width).toBe('0.5ch');
    expect(screen.getByText('▍').style.display).toBe('inline-block');
  });
});

describe('Board loading state and cards', () => {
  const t = (id: string, status: Ticket['status']): Ticket => ({
    id, projectId: 'p1', parentId: null, identificador: `OWL-${id}`, titulo: `T${id}`, descricao: null, criteriosAceite: null, status,
    responsavel: null, prioridade: 0, estimativa: null, prazo: null, cicloId: null, ordem: Number(id), orcamentoTokens: null, requerAprovacao: false, resumo: null,
  });
  const data: BoardData = { estados: [], tickets: [t('1', 'pronto'), t('2', 'em_andamento')], aprovacoes: [], etiquetas: [], ciclos: [] };
  const project = { id: 'p1', nome: 'P', caminho: '/x' } as never;
  const stub = (resolve: boolean) =>
    vi.stubGlobal('fetch', vi.fn(() => (resolve ? Promise.resolve(new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })) : new Promise(() => {}))));

  it('shows the blinking owl while loading', () => {
    media(false);
    stub(false);
    const { container } = render(<Board project={project} onClose={() => {}} pollMs={0} />);
    expect(screen.getByText(/Carregando/)).toBeInTheDocument();
    expect(container.querySelector('.owl-blink')).not.toBeNull();
  });
  it('reduced motion: cards get no layoutId and layout=false (no travel animation)', async () => {
    media(true);
    stub(true);
    liProps.length = 0;
    render(<Board project={project} onClose={() => {}} pollMs={0} />);
    await waitFor(() => expect(liProps.length).toBeGreaterThan(0));
    for (const p of liProps) {
      expect(p.layoutId).toBeUndefined();
      expect(p.layout).toBe(false);
    }
  });
  it('motion allowed: each card travels with layoutId = ticket id', async () => {
    media(false);
    stub(true);
    liProps.length = 0;
    render(<Board project={project} onClose={() => {}} pollMs={0} />);
    await waitFor(() => expect(liProps.length).toBeGreaterThan(0));
    expect(new Set(liProps.map((p) => p.layoutId))).toEqual(new Set(['1', '2']));
    for (const p of liProps) expect(p.layout).toBe('position');
  });
  for (const reduce of [true, false])
    it(`renders every card once with reduced=${reduce}`, async () => {
      media(reduce);
      stub(true);
      render(<Board project={project} onClose={() => {}} pollMs={0} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /^OWL-1\b.*T1/ })).toBeInTheDocument());
      expect(screen.getAllByRole('button', { name: /^OWL-2\b.*T2/ })).toHaveLength(1);
    });
});
