// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOllamaDown, OllamaPanel } from './components/OllamaPanel';
import { api } from './lib/api';
import type { OllamaState } from './lib/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const down: OllamaState = { disponivel: false, modelos: [], via: 'container', dica: null };

describe('OllamaPanel', () => {
  it('recognizes the adapter error for a server nobody answers on', () => {
    expect(isOllamaDown('ollama: could not reach http://127.0.0.1:11434: fetch failed')).toBe(true);
    expect(isOllamaDown('ollama: no model chosen')).toBe(false);
    expect(isOllamaDown(null)).toBe(false);
  });

  it('says it is down, turns it on with one click, and tells the caller', async () => {
    vi.spyOn(api, 'ollama').mockResolvedValue({ ...down });
    const start = vi.spyOn(api, 'ollamaStart').mockResolvedValue({ disponivel: true, modelos: ['gemma4:e4b'], via: null, dica: null });
    const onUp = vi.fn();
    render(<OllamaPanel onUp={onUp} />);
    expect(await screen.findByText(/contêiner "ollama" está parado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ligar o ollama/i }));
    await waitFor(() => expect(onUp).toHaveBeenCalled());
    expect(start).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/no ar com 1 modelo/)).toBeInTheDocument();
  });

  it('shows how to set it up when OWL cannot turn it on, with no button', async () => {
    vi.spyOn(api, 'ollama').mockResolvedValue({ disponivel: false, modelos: [], via: null, dica: 'O Ollama não está instalado aqui. Veja docs/06-research/ollama.md' });
    render(<OllamaPanel />);
    expect(await screen.findByText(/não está instalado aqui/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ligar/i })).toBeNull();
  });

  it('keeps the reason when it would not start, and stays quiet when it is up in an error banner', async () => {
    vi.spyOn(api, 'ollama').mockResolvedValue({ ...down });
    vi.spyOn(api, 'ollamaStart').mockResolvedValue({ ...down, dica: 'Liguei, mas ele ainda não respondeu em 30 s.' });
    const { unmount } = render(<OllamaPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /ligar o ollama/i }));
    expect(await screen.findByText(/não respondeu em 30 s/)).toBeInTheDocument();
    unmount();
    vi.spyOn(api, 'ollama').mockResolvedValue({ disponivel: true, modelos: [], via: null, dica: null });
    const { container } = render(<OllamaPanel quiet />);
    await waitFor(() => expect(api.ollama).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
