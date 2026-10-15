// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailureCard, RefinedPromptDone, ReviewCard } from './components/RefinedPrompt';

// QA gap tests for prompt 06: review UI edge cases at component level.

afterEach(cleanup);

const refiner = { provedor: 'codex-cli', modelo: null, fallback: [{ provedor: 'claude-cli', modelo: 'haiku' }] };
const handlers = () => ({ onRun: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn(), disabled: false });

describe('ReviewCard', () => {
  it('starts with the stored text, button says "Executar"; editing flips the label', async () => {
    const user = userEvent.setup();
    render(<ReviewCard texto="Objetivo: X" refiner={refiner} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Executar' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Prompt melhorado (editável)'), '!');
    expect(screen.getByRole('button', { name: 'Executar com a minha edição' })).toBeInTheDocument();
  });

  it('only whitespace differences do not count as an edit', async () => {
    const user = userEvent.setup();
    render(<ReviewCard texto="Objetivo: X" refiner={refiner} {...handlers()} />);
    await user.type(screen.getByLabelText('Prompt melhorado (editável)'), '   ');
    expect(screen.getByRole('button', { name: 'Executar' })).toBeInTheDocument();
  });

  it('an emptied editor cannot be executed (button disabled)', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<ReviewCard texto="Objetivo: X" refiner={refiner} {...h} />);
    await user.clear(screen.getByLabelText('Prompt melhorado (editável)'));
    const btn = screen.getByRole('button', { name: /Executar/ });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(h.onRun).not.toHaveBeenCalled();
  });

  it('passes the edited text, multiline and with braces, untouched', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<ReviewCard texto="a" refiner={refiner} {...h} />);
    const box = screen.getByLabelText('Prompt melhorado (editável)');
    await user.clear(box);
    await user.type(box, 'linha 1{Enter}use {{{{ x }}');
    await user.click(screen.getByRole('button', { name: /Executar/ }));
    expect(h.onRun).toHaveBeenCalledWith('linha 1\nuse {{ x }}');
  });

  it('offers the refiner default and every fallback as "Melhorar de novo"', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<ReviewCard texto="a" refiner={refiner} {...h} />);
    await user.click(screen.getByRole('button', { name: 'Melhorar de novo codex-cli' }));
    expect(h.onRetry).toHaveBeenLastCalledWith({ provider: 'codex-cli' });
    await user.click(screen.getByRole('button', { name: 'Melhorar de novo haiku' }));
    expect(h.onRetry).toHaveBeenLastCalledWith({ provider: 'claude-cli', model: 'haiku' });
  });

  it('renders without refiner info (no retry buttons, run and discard still work)', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<ReviewCard texto="a" refiner={null} {...h} />);
    expect(screen.queryByRole('button', { name: /Melhorar de novo/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(h.onDiscard).toHaveBeenCalled();
  });

  it('while a decision is in flight every action is disabled (no double submit)', () => {
    render(<ReviewCard texto="a" refiner={refiner} {...handlers()} disabled />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});

describe('FailureCard', () => {
  it('strips the "Falha ao melhorar o prompt:" prefix and keeps long reasons readable', () => {
    render(<FailureCard motivo={`Falha ao melhorar o prompt: ${'x'.repeat(500)}`} refiner={refiner} {...{ onSkip: vi.fn(), ...handlers() }} />);
    const alert = screen.getByRole('alert', { name: 'Falha ao melhorar o prompt' });
    expect(alert).toHaveTextContent('x'.repeat(500));
    expect(alert).not.toHaveTextContent('Falha ao melhorar o prompt:');
  });

  it('does not offer a retry with the model that just failed, only the fallbacks', () => {
    render(<FailureCard motivo="limit" refiner={refiner} {...{ onSkip: vi.fn(), ...handlers() }} />);
    expect(screen.queryByRole('button', { name: /Tentar com codex-cli/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tentar com haiku' })).toBeInTheDocument();
  });

  it('skip and discard call their handlers; nothing is called on render', async () => {
    const user = userEvent.setup();
    const h = { onSkip: vi.fn(), ...handlers() };
    render(<FailureCard motivo="limit" refiner={refiner} {...h} />);
    expect(h.onSkip).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Executar sem melhorar' }));
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(h.onSkip).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('RefinedPromptDone', () => {
  it('is collapsed by default and shows the text as markdown when opened', async () => {
    const user = userEvent.setup();
    render(<RefinedPromptDone texto={'**Objetivo**: X'} />);
    const summary = screen.getByText('Prompt melhorado usado nesta execução');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    await waitFor(() => expect(summary.closest('details')).toHaveAttribute('open'));
    expect(screen.getByText('Objetivo').tagName).toBe('STRONG');
  });

  it('does not execute html in the refined prompt', () => {
    render(<RefinedPromptDone texto={'<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>'} />);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(document.querySelector('script')).toBeNull();
  });
});
