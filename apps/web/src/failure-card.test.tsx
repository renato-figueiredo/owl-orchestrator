// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailureCard } from './components/RefinedPrompt';

afterEach(cleanup);
const refiner = { provedor: 'codex-cli', modelo: null, fallback: [{ provedor: 'claude-cli', modelo: 'haiku' }] };

describe('FailureCard for a step that is not the refiner', () => {
  it('names the step, shows the reason and offers only to dismiss', async () => {
    const onDiscard = vi.fn();
    render(<FailureCard motivo={'Falha na etapa "revisar": usage limit reached'} refiner={refiner} onSkip={vi.fn()} onRetry={vi.fn()} onDiscard={onDiscard} disabled={false} />);
    expect(screen.getByRole('alert', { name: 'Falha na etapa revisar' })).toHaveTextContent('usage limit reached');
    expect(screen.queryByText(/melhorar/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tentar com/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(onDiscard).toHaveBeenCalled();
  });
});
