// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Message, Run, RunEvent, Session } from './lib/types';

/** Minimal EventSource: tests push server events with `emit`. */
class FakeEventSource {
  static all: FakeEventSource[] = [];
  static CLOSED = 2;
  readyState = 1;
  closed = false;
  private handlers = new Map<string, Array<(e: Event) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(event: RunEvent) {
    for (const fn of this.handlers.get(event.type) ?? []) fn(new MessageEvent(event.type, { data: JSON.stringify(event) }));
  }
}

interface Server {
  sessions: Session[];
  messages: Message[];
  runs: Run[];
  calls: Array<{ method: string; path: string; body?: unknown }>;
}
let server: Server;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  server = { sessions: [], messages: [], runs: [], calls: [] };
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      server.calls.push({ method, path, body });
      if (path === '/providers') return json({ providers: [{ id: 'claude-cli', available: true }, { id: 'codex-cli', available: false }] });
      if (path === '/projects' && method === 'GET') return json({ projects: [{ id: 'p1', nome: 'Alfa', pasta: '/x' }] });
      if (path === '/sessions' && method === 'GET') return json({ sessions: server.sessions });
      if (path === '/sessions' && method === 'POST') {
        const s: Session = { id: `s${server.sessions.length + 1}`, projectId: body.projectId ?? null, titulo: null, criadoEm: '' };
        server.sessions.unshift(s);
        return json({ session: s }, 201);
      }
      const detail = path.match(/^\/sessions\/(\w+)$/);
      if (detail) return json({ session: server.sessions.find((s) => s.id === detail[1]), messages: server.messages, runs: server.runs });
      if (path.match(/^\/sessions\/\w+\/messages$/)) {
        server.messages.push({ id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: body.texto, criadoEm: '' });
        server.runs.push({ id: 'run1', provedor: body.provider, modelo: null, status: 'rodando', tokensIn: null, tokensOut: null, custoEstimado: null, inicio: '', fim: null, erro: null });
        server.sessions[0]!.titulo = body.texto;
        return json({ runId: 'run1' }, 202);
      }
      if (path === '/runs/run1/cancel') return json({ status: 'cancelling' }, 202);
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

/** What the server does when a run finishes: store the reply, then announce `end`. */
function finishRun(text: string) {
  server.messages.push({ id: 2, sessionId: 's1', runId: 'run1', papel: 'assistente', conteudo: text, criadoEm: '' });
  server.runs[0] = { ...server.runs[0]!, status: 'ok', tokensIn: 1200, tokensOut: 34, custoEstimado: 0.0012 };
}

async function startChat() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Nova conversa' }));
  const box = await screen.findByLabelText('Mensagem');
  await waitFor(() => expect(box).toBeEnabled());
  return { user, box };
}

describe('chat', () => {
  it('streams the answer as it arrives, then keeps the stored reply', async () => {
    const { user, box } = await startChat();
    await user.type(box, 'diga olá{Enter}');

    const es = await waitFor(() => {
      expect(FakeEventSource.all).toHaveLength(1);
      return FakeEventSource.all[0]!;
    });
    expect(es.url).toBe('/api/runs/run1/stream');
    expect(server.calls.find((c) => c.path.endsWith('/messages'))?.body).toEqual({ texto: 'diga olá', provider: 'claude-cli' });
    expect(await screen.findByText('diga olá', { selector: 'p' })).toBeInTheDocument();

    es.emit({ type: 'start', runId: 'run1', provider: 'claude-cli', model: 'haiku' });
    es.emit({ type: 'text', delta: 'Olá, ' });
    expect(await screen.findByText(/Olá,/)).toBeInTheDocument();
    es.emit({ type: 'tool', name: 'Read', input: { file: 'a.ts' } });
    es.emit({ type: 'text', delta: 'mundo' });
    expect(await screen.findByText('Olá, mundo')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument(); // tool timeline in the run panel
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();

    finishRun('Olá, mundo');
    es.emit({ type: 'usage', inputTokens: 1200, outputTokens: 34, costUsd: 0.0012 });
    es.emit({ type: 'end', result: 'Olá, mundo' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument());
    expect(es.closed).toBe(true);
    // exactly one copy of the reply (live bubble replaced by the stored message)
    await waitFor(() => expect(screen.getAllByText('Olá, mundo')).toHaveLength(1));
    expect(screen.getByTestId('session-total')).toHaveTextContent('1.200 ent · 34 saí');
  });

  it('persists across reload: reopening a session shows its history and follows a run still going', async () => {
    server.sessions = [{ id: 's1', projectId: null, titulo: 'Antiga', criadoEm: '' }];
    server.messages = [
      { id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: 'pergunta antiga', criadoEm: '' },
      { id: 2, sessionId: 's1', runId: 'run0', papel: 'assistente', conteudo: 'resposta **guardada**', criadoEm: '' },
    ];
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Antiga' }));
    expect(await screen.findByText('pergunta antiga')).toBeInTheDocument();
    expect(screen.getByText('guardada').tagName).toBe('STRONG'); // markdown rendered
    expect(FakeEventSource.all).toHaveLength(0);

    cleanup();
    server.runs = [{ id: 'run1', provedor: 'claude-cli', modelo: null, status: 'rodando', tokensIn: null, tokensOut: null, custoEstimado: null, inicio: '', fim: null, erro: null }];
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Antiga' }));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
  });

  it('cancel calls the API and shows the cancelled state', async () => {
    const { user, box } = await startChat();
    await user.type(box, 'algo longo{Enter}');
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    const es = FakeEventSource.all[0]!;
    es.emit({ type: 'start', runId: 'run1', provider: 'claude-cli' });
    es.emit({ type: 'text', delta: 'parcial' });

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/runs/run1/cancel')).toBe(true);

    es.emit({ type: 'cancelled' });
    expect(await screen.findByText('Execução cancelada.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
  });

  it('shows run errors', async () => {
    const { user, box } = await startChat();
    await user.type(box, 'x{Enter}');
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    FakeEventSource.all[0]!.emit({ type: 'start', runId: 'run1', provider: 'claude-cli' });
    FakeEventSource.all[0]!.emit({ type: 'error', message: 'CLI quebrou' });
    expect(await screen.findByRole('alert')).toHaveTextContent('CLI quebrou');
  });

  it('Enter sends, Shift+Enter keeps writing, empty text is not sent', async () => {
    const { user, box } = await startChat();
    await user.type(box, '{Enter}');
    await user.type(box, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect(box).toHaveValue('linha 1\nlinha 2');
    expect(server.calls.some((c) => c.path.endsWith('/messages'))).toBe(false);
    await user.type(box, '{Enter}');
    await waitFor(() => expect(server.calls.find((c) => c.path.endsWith('/messages'))?.body).toMatchObject({ texto: 'linha 1\nlinha 2' }));
  });

  it('does not offer an unavailable provider', async () => {
    await startChat();
    expect(screen.getByRole('option', { name: /codex-cli/ })).toBeDisabled();
  });

  it('code blocks render with a copy button that copies the code', async () => {
    server.sessions = [{ id: 's1', projectId: null, titulo: 'Codigo', criadoEm: '' }];
    server.messages = [{ id: 2, sessionId: 's1', runId: 'r', papel: 'assistente', conteudo: 'Veja:\n\n```ts\nconst a = 1;\n```\n', criadoEm: '' }];
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Codigo' }));
    await user.click(await screen.findByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('never renders raw HTML from the model', async () => {
    server.sessions = [{ id: 's1', projectId: null, titulo: 'Html', criadoEm: '' }];
    server.messages = [{ id: 2, sessionId: 's1', runId: 'r', papel: 'assistente', conteudo: '<img src=x onerror="alert(1)"> <script>alert(2)</script>', criadoEm: '' }];
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Html' }));
    await screen.findByRole('log');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('sessions list and keyboard', () => {
  it('arrow keys move through sessions and Enter opens one', async () => {
    server.sessions = [
      { id: 's1', projectId: null, titulo: 'Primeira', criadoEm: '' },
      { id: 's2', projectId: null, titulo: 'Segunda', criadoEm: '' },
      { id: 's3', projectId: 'p1', titulo: 'Do projeto', criadoEm: '' },
    ];
    const user = userEvent.setup();
    render(<App />);
    const first = await screen.findByRole('button', { name: 'Primeira' });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Segunda' })).toHaveFocus();
    // DOM order: project group first ("Do projeto"), then the loose ones; the list stops at the top.
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('button', { name: 'Do projeto' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('groups sessions by project', async () => {
    server.sessions = [
      { id: 's1', projectId: null, titulo: 'Solta', criadoEm: '' },
      { id: 's2', projectId: 'p1', titulo: 'Do projeto', criadoEm: '' },
    ];
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Projetos e conversas' });
    await within(nav).findByText('Do projeto');
    const heads = within(nav).getAllByRole('heading').map((h) => h.textContent);
    expect(heads).toEqual(['Alfa', 'Sem projeto']);
  });

  it('creates a project and starts a conversation inside it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Nova conversa em Alfa' }));
    await waitFor(() => expect(server.calls.find((c) => c.method === 'POST' && c.path === '/sessions')?.body).toEqual({ projectId: 'p1' }));
  });

  it('reports a rejected folder when creating a project', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Projeto +' }));
    await screen.findByRole('button', { name: 'Nova conversa em Alfa' }); // initial load finished
    vi.mocked(fetch).mockImplementation(async () => json({ error: { code: 'folder_not_allowed', message: 'Folder is outside the allowed workspace roots' } }, 403));
    await user.type(screen.getByLabelText('Nome'), 'X');
    await user.type(screen.getByLabelText('Pasta do projeto'), '/etc');
    await user.click(screen.getByRole('button', { name: 'Criar projeto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outside the allowed workspace roots');
  });
});

describe('theme', () => {
  it('toggles light/dark, applies data-theme and remembers only the theme name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('navigation');
    const before = document.documentElement.dataset.theme;
    await user.click(screen.getByRole('button', { name: /Mudar para tema/ }));
    const after = document.documentElement.dataset.theme;
    expect(after).not.toBe(before);
    expect(localStorage.getItem('owl-theme')).toBe(after);
    expect(Object.keys(localStorage)).toEqual(['owl-theme']);
  });
});
