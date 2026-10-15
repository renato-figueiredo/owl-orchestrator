// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Message, Session } from './lib/types';

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  addEventListener() {}
  close() {}
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let sessions: Session[];
let messages: Message[];
let uploads: Array<{ path: string; type: string | null; size: number }>;
let sent: Array<Record<string, unknown>>;
let failUpload: boolean;
let n: number;

beforeEach(() => {
  sessions = [];
  messages = [];
  uploads = [];
  sent = [];
  failUpload = false;
  n = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      if (path === '/providers') return json({ providers: [{ id: 'claude-cli', available: true }] });
      if (path === '/projects') return json({ projects: [] });
      if (path === '/refiner') return json({ provedor: 'codex-cli', modelo: null, fallback: [] });
      if (path === '/settings') return json({ memory: {} });
      if (path.startsWith('/facts')) return json({ facts: [] });
      if (path === '/sessions' && method === 'GET') return json({ sessions });
      if (path === '/sessions' && method === 'POST') {
        const s: Session = { id: 's1', projectId: null, titulo: null, criadoEm: '' };
        sessions = [s];
        return json({ session: s }, 201);
      }
      if (path.startsWith('/attachments') && method === 'POST') {
        const file = init!.body as File;
        uploads.push({ path, type: new Headers(init!.headers).get('content-type'), size: file.size });
        if (failUpload) return json({ error: { code: 'invalid_image', message: 'The file is not a valid image' } }, 400);
        return json({ attachment: { hash: String(uploads.length).repeat(64).slice(0, 64), url: '/attachments/x' } }, 201);
      }
      if (path === '/sessions/s1' && method === 'GET') return json({ session: sessions[0], messages, runs: [], approvals: [] });
      if (path === '/sessions/s1/messages') {
        const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
        sent.push(body);
        messages.push({
          id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: String(body.texto), criadoEm: '',
          ...(Array.isArray(body.anexos) ? { anexos: body.anexos.map((a: { hash: string; nome: string }) => ({ hash: a.hash, nome: a.nome, largura: 10, altura: 10, url: `/attachments/${a.hash}` })) } : {}),
        });
        return json({ runId: 'run1' }, 202);
      }
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const png = (name = 'print.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type });

async function start() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Nova conversa' }));
  const box = await screen.findByLabelText('Mensagem');
  await waitFor(() => expect(box).toBeEnabled());
  return { user, box };
}

describe('image attachments in the composer', () => {
  it('pasting an image uploads it as the raw body and shows a thumbnail; sending carries its hash', async () => {
    const { user, box } = await start();
    fireEvent.paste(box, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => png('colado.png') }] } });
    const strip = await screen.findByRole('list', { name: 'Imagens anexadas' });
    expect(await screen.findByAltText('colado.png')).toBeInTheDocument();
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ path: '/attachments?nome=colado.png', type: 'image/png', size: 3 });

    await user.type(box, 'veja{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ texto: 'veja', anexos: [{ hash: '1'.repeat(64), nome: 'colado.png' }] });
    expect(strip).not.toBeInTheDocument(); // composer cleared
    // the stored message shows the thumbnail from the server
    expect(await screen.findByRole('button', { name: 'Ampliar colado.png' })).toBeInTheDocument();
  });

  it('pasting plain text is left alone; an image alone can be sent', async () => {
    const { user, box } = await start();
    const e = createEvent.paste(box, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } });
    fireEvent(box, e);
    expect(e.defaultPrevented).toBe(false);

    await user.upload(screen.getByLabelText('Escolher imagens'), png('so-imagem.png'));
    const send = screen.getByRole('button', { name: 'Enviar' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ texto: '', anexos: [{ nome: 'so-imagem.png' }] });
  });

  it('dragging a file onto the composer attaches it; non-images are refused with a note', async () => {
    const { box } = await start();
    const form = box.closest('form')!;
    fireEvent.drop(form, { dataTransfer: { files: [png('arrastado.webp', 'image/webp'), new File(['x'], 'doc.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByAltText('arrastado.webp')).toBeInTheDocument();
    expect(screen.getByText(/Só imagens PNG, JPEG ou WebP/)).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
  });

  it('send waits for the upload; a failed upload shows its error, is not sent, and can be removed', async () => {
    failUpload = true;
    const { user, box } = await start();
    await user.upload(screen.getByLabelText('Escolher imagens'), png('ruim.png'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is not a valid image');
    await user.type(box, 'texto{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).not.toHaveProperty('anexos'); // the failed image is not part of the message
    await user.upload(screen.getByLabelText('Escolher imagens'), png('outra-ruim.png'));
    await user.click(await screen.findByRole('button', { name: 'Remover outra-ruim.png' }));
    expect(screen.queryByAltText('outra-ruim.png')).not.toBeInTheDocument();
  });

  it('clicking a thumbnail in the conversation opens the full-size image; Esc closes it', async () => {
    messages = [{ id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: 'olha', criadoEm: '', anexos: [{ hash: 'a'.repeat(64), nome: 'erro.png', largura: 1, altura: 1, url: `/attachments/${'a'.repeat(64)}` }] }];
    sessions = [{ id: 's1', projectId: null, titulo: 'x', criadoEm: '' }];
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('x'));
    await user.click(await screen.findByRole('button', { name: 'Ampliar erro.png' }));
    const dialog = await screen.findByRole('dialog', { name: 'erro.png' });
    expect(dialog.querySelector('img')).toHaveAttribute('src', `/api/attachments/${'a'.repeat(64)}`);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
