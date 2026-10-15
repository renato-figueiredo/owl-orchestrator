// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  addEventListener() {}
  close() {}
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { method: string; path: string; body?: Record<string, unknown> };

let calls: Call[];
let live: Array<Record<string, unknown>>;
let trashed: Array<Record<string, unknown>>;
let purgeResult: Record<string, unknown>;
const mk = (id: string, titulo: string) => ({ id, projectId: null, titulo, criadoEm: '' });

beforeEach(() => {
  calls = [];
  live = [mk('s1', 'Conversa viva')];
  trashed = [mk('t1', 'Conversa velha')];
  purgeResult = { sessionId: 't1', blobsRemoved: 0 };
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/providers') return json({ providers: [{ id: 'claude-cli', available: true }] });
      if (path === '/projects') return json({ projects: [] });
      if (path === '/refiner') return json({ provedor: 'codex-cli', modelo: null, fallback: [] });
      if (path === '/settings' && method === 'GET') return json({ memory: {}, lixeira: { diasRetencao: 30, purgaAutomatica: true }, backup: { ativo: false, retencao: 14, intervaloHoras: 24 } });
      if (path === '/backups') return json({ settings: { ativo: false, retencao: 14, intervaloHoras: 24 }, destinos: { criptografia: false, envio: false }, ultimo: null, arquivos: [] });
      if (path === '/sessions' && method === 'GET') return json({ sessions: live });
      if (path === '/sessions?trash=1') return json({ sessions: trashed });
      if (path === '/sessions/s1' && method === 'DELETE') {
        trashed = [...trashed, ...live];
        live = [];
        return json({ session: {} });
      }
      if (path === '/sessions/t1/restore') {
        live = [...live, ...trashed];
        trashed = [];
        return json({ session: {} });
      }
      if (path === '/trash/t1' && method === 'DELETE') {
        trashed = [];
        return json({ result: purgeResult });
      }
      if (path === '/trash' && method === 'DELETE') {
        trashed = [];
        return json({ result: { purged: 1, skipped: 0 } });
      }
      return json({ error: { code: 'x', message: `unexpected ${method} ${path}` } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('trash', () => {
  it('moves a conversation to the trash and lists it there', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Mover para a lixeira: Conversa viva/ }));
    await waitFor(() => expect(screen.queryByText('Conversa viva')).not.toBeInTheDocument());
    expect(calls).toContainEqual({ method: 'DELETE', path: '/sessions/s1' });
    await user.click(screen.getByText('Lixeira'));
    expect(await screen.findByText('Conversa viva')).toBeInTheDocument();
  });

  it('restores from the trash', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Lixeira'));
    await user.click(await screen.findByRole('button', { name: 'Restaurar' }));
    expect(await screen.findByRole('button', { name: 'Conversa velha' })).toBeInTheDocument();
  });

  it('deleting for good asks for a second click, and warns when the CLI keeps its own history', async () => {
    purgeResult = { sessionId: 't1', blobsRemoved: 0, cliSession: { provider: 'claude-cli', id: 'abc' } };
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Lixeira'));
    await user.click(await screen.findByRole('button', { name: 'Excluir de vez' }));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/trash/t1')).toBe(false);
    await user.click(screen.getByRole('button', { name: /Confirmar: excluir para sempre/ }));
    expect(await screen.findByText(/continua na pasta da CLI/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/trash/t1')).toBe(true);
  });

  it('empties the trash only after confirmation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Lixeira'));
    await user.click(await screen.findByRole('button', { name: 'Esvaziar lixeira' }));
    expect(calls.some((c) => c.path === '/trash' && c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: /Confirmar: esvaziar/ }));
    expect(await screen.findByText(/1 conversa\(s\) excluída/)).toBeInTheDocument();
  });
});

describe('storage settings', () => {
  it('saves the retention and starts a backup on demand', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation(((orig) => async (input: string, init?: RequestInit) => {
      const path = String(input).replace(/^\/api/, '');
      if (path === '/backups' && init?.method === 'POST') return json({ status: { em: '2026-10-15T00:00:00Z', ok: true, arquivo: 'owl-2026-10-15.db' } }, 201);
      if (path === '/settings' && init?.method === 'PUT') return json({ lixeira: { diasRetencao: 7, purgaAutomatica: true } });
      return orig(input, init);
    })(vi.mocked(fetch).getMockImplementation()!) as typeof fetch);
    render(<App />);
    await user.click(await screen.findByText('Armazenamento e backup'));
    const days = await screen.findByLabelText('Guardar por (dias)');
    await user.clear(days);
    await user.type(days, '7');
    await user.tab();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ lixeira: { diasRetencao: 7 } }) })));
    await user.click(screen.getByRole('button', { name: 'Fazer backup agora' }));
    expect(await screen.findByText(/Backup feito: owl-2026-10-15.db/)).toBeInTheDocument();
  });
});
