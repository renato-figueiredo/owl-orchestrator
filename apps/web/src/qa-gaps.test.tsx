// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './components/Markdown';
import { RunPanel } from './components/RunPanel';
import { useTheme } from './lib/useTheme';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('Markdown (QA)', () => {
  it('drops javascript: links and opens safe links in a new tab with noopener', () => {
    render(<Markdown>{'[ruim](javascript:alert(1)) e [bom](https://example.com)'}</Markdown>);
    const bad = screen.getByText('ruim').closest('a');
    expect(bad?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    const good = screen.getByRole('link', { name: 'bom' });
    expect(good).toHaveAttribute('target', '_blank');
    expect(good.getAttribute('rel')).toContain('noopener');
  });

  it('renders GFM tables and inline code without a copy button', () => {
    render(<Markdown>{'| a | b |\n|---|---|\n| 1 | 2 |\n\nusa `x`'}</Markdown>);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copiar' })).toBeNull();
  });

  it('gives each code block its own copy button', () => {
    render(<Markdown>{'```\na\n```\n\n```\nb\n```'}</Markdown>);
    expect(screen.getAllByRole('button', { name: 'Copiar' })).toHaveLength(2);
  });
});

function Probe() {
  const [t] = useTheme();
  return <span>{t}</span>;
}

describe('theme (QA)', () => {
  it('restores the saved theme on load', () => {
    localStorage.setItem('owl-theme', 'dark');
    render(<Probe />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('ignores an invalid saved value', () => {
    localStorage.setItem('owl-theme', 'neon');
    render(<Probe />);
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });
});

describe('RunPanel (QA)', () => {
  it('collapses and reopens via its toggle, reflected in aria-expanded', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(true);
      return <RunPanel runs={[]} stream={null} open={open} onToggle={() => setOpen((o) => !o)} />;
    }
    render(<Host />);
    const close = screen.getByRole('button', { name: 'Recolher painel de execução' });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    await user.click(close);
    const open = screen.getByRole('button', { name: 'Abrir painel de execução' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Histórico de execuções')).toBeNull();
    await user.click(open);
    expect(screen.getByLabelText('Histórico de execuções')).toBeInTheDocument();
  });
});
