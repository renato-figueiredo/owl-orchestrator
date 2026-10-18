// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaToggle } from './components/shell/OllamaToggle';
import { api } from './lib/api';
import type { OllamaState } from './lib/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const down: OllamaState = { disponivel: false, modelos: [], via: 'container', dica: null };

describe('OllamaToggle', () => {
  it('is lit when Ollama is up and does nothing on click', async () => {
    vi.spyOn(api, 'ollama').mockResolvedValue({ disponivel: true, modelos: ['a', 'b'], via: null, dica: null });
    const start = vi.spyOn(api, 'ollamaStart');
    render(<OllamaToggle />);
    const button = await screen.findByRole('button', { name: 'Ollama no ar com 2 modelo(s)' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(start).not.toHaveBeenCalled();
  });

  it('is dim when it is down and a click turns it on', async () => {
    vi.spyOn(api, 'ollama').mockResolvedValue(down);
    const start = vi.spyOn(api, 'ollamaStart').mockResolvedValue({ disponivel: true, modelos: ['a'], via: null, dica: null });
    render(<OllamaToggle />);
    const button = await screen.findByRole('button', { name: 'Ollama desligado: clique para ligar' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ollama no ar com 1 modelo(s)' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('says why it cannot be turned on when OWL has no way to', async () => {
    vi.spyOn(api, 'ollama').mockResolvedValue({ disponivel: false, modelos: [], via: null, dica: 'O Ollama não está instalado aqui.' });
    const start = vi.spyOn(api, 'ollamaStart');
    render(<OllamaToggle />);
    const button = await screen.findByRole('button', { name: /não está instalado aqui/ });
    await userEvent.click(button);
    expect(start).not.toHaveBeenCalled();
  });
});
