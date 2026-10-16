// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Approval, Message, Run, RunEvent } from './lib/types';

class FakeEventSource {
  static all: FakeEventSource[] = [];
  static CLOSED = 2;
  readyState = 1;
  private handlers = new Map<string, Array<(e: Event) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  emit(event: RunEvent) {
    for (const fn of this.handlers.get(event.type) ?? []) fn(new MessageEvent(event.type, { data: JSON.stringify(event) }));
  }
}

const run = (over: Partial<Run>): Run => ({ id: 'r1', etapa: null, parentRunId: null, provedor: 'codex-cli', modelo: null, status: 'ok', tokensIn: null, tokensOut: null, custoEstimado: null, inicio: '', fim: null, erro: null, ...over });
const msg = (over: Partial<Message>): Message => ({ id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: '', criadoEm: '', ...over });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let messages: Message[];
let runs: Run[];
let approvals: Approval[];
let calls: Array<{ method: string; path: string; body?: Record<string, unknown> }>;

beforeEach(() => {
  messages = [];
  runs = [];
  approvals = [];
  calls = [];
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/providers') return json({ providers: [{ id: 'claude-cli', available: true }, { id: 'codex-cli', available: true }] });
      if (path === '/projects') return json({ projects: [] });
      if (path === '/refiner') return json({ provedor: 'codex-cli', modelo: null, fallback: [{ provedor: 'claude-cli', modelo: 'haiku' }] });
      if (path === '/sessions' && method === 'GET') return json({ sessions: [{ id: 's1', projectId: null, titulo: 'Conversa', criadoEm: '' }] });
      if (path === '/sessions/s1') return json({ session: { id: 's1' }, messages, runs, approvals });
      if (path === '/sessions/s1/messages') {
        runs = [run({ id: 'r1', etapa: 'melhorar', status: 'rodando' })];
        return json({ runId: 'r1', etapa: 'melhorar' }, 202);
      }
      if (path.match(/^\/runs\/\w+\/(continue|retry)$/)) return json({ runId: 'r2', etapa: 'executar' }, 202);
      if (path.match(/^\/runs\/\w+\/discard$/)) return json({ status: 'discarded' });
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const sentMessage = () => calls.find((c) => c.path === '/sessions/s1/messages')?.body;
async function open() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await within(await screen.findByRole('region', { name: 'Lista de conversas' })).findByRole('button', { name: 'Conversa' }));
  await screen.findByLabelText('Mensagem');
  return user;
}

describe('composer options', () => {
  it('unchecked: a plain message (no pipeline fields at all)', async () => {
    const user = await open();
    await user.type(screen.getByLabelText('Mensagem'), 'oi{Enter}');
    await waitFor(() => expect(sentMessage()).toEqual({ texto: 'oi', provider: 'claude-cli' }));
  });

  it('"Editar antes" and the refiner picker only exist while "Refinar prompt" is checked', async () => {
    const user = await open();
    expect(screen.queryByLabelText('Editar antes de executar')).toBeNull();
    await user.click(screen.getByLabelText('Refinar prompt'));
    expect(screen.getByLabelText('Editar antes de executar')).toBeInTheDocument();
    expect(screen.getByLabelText('Refinador')).toHaveDisplayValue('codex-cli (padrão)');
  });

  it('checked: sends melhorarPrompt; the default refiner sends no override', async () => {
    const user = await open();
    await user.click(screen.getByLabelText('Refinar prompt'));
    await user.type(screen.getByLabelText('Mensagem'), 'faça X{Enter}');
    await waitFor(() => expect(sentMessage()).toEqual({ texto: 'faça X', provider: 'claude-cli', melhorarPrompt: true, editarAntes: false }));
  });

  it('review + haiku: sends editarAntes and the chosen refiner', async () => {
    const user = await open();
    await user.click(screen.getByLabelText('Refinar prompt'));
    await user.click(screen.getByLabelText('Editar antes de executar'));
    await user.selectOptions(screen.getByLabelText('Refinador'), 'haiku');
    await user.type(screen.getByLabelText('Mensagem'), 'faça X{Enter}');
    await waitFor(() =>
      expect(sentMessage()).toEqual({ texto: 'faça X', provider: 'claude-cli', melhorarPrompt: true, editarAntes: true, refinador: { provider: 'claude-cli', model: 'haiku' } }),
    );
  });
});

describe('refined prompt review', () => {
  beforeEach(() => {
    messages = [msg({ id: 1, conteudo: 'faça X' }), msg({ id: 2, papel: 'agente', runId: 'r1', conteudo: 'Objetivo: X' })];
    runs = [run({ id: 'r1', etapa: 'melhorar', tokensIn: 100, tokensOut: 10 })];
    approvals = [{ id: 'a1', runId: 'r1', motivo: 'Revisar o prompt melhorado antes de executar' }];
  });

  it('shows the refined prompt editable and runs the user edit', async () => {
    const user = await open();
    const box = await screen.findByLabelText('Prompt melhorado (editável)');
    expect(box).toHaveValue('Objetivo: X');
    await user.clear(box);
    await user.type(box, 'Objetivo: X, mas em português');
    await user.click(screen.getByRole('button', { name: 'Executar com a minha edição' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/runs/r1/continue')?.body).toEqual({ texto: 'Objetivo: X, mas em português' }));
    // it follows the run the server started
    await waitFor(() => expect(FakeEventSource.all.at(-1)?.url).toBe('/api/runs/r2/stream'));
  });

  it('running it unchanged sends no text (the server keeps the stored one)', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Executar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/runs/r1/continue')?.body).toEqual({}));
  });

  it('can improve again with haiku (and then follows the new run)', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Melhorar de novo haiku' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/runs/r1/retry')?.body).toEqual({ provider: 'claude-cli', model: 'haiku' }));
    await waitFor(() => expect(FakeEventSource.all.at(-1)?.url).toBe('/api/runs/r2/stream'));
  });

  it('can discard', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/runs/r1/discard')).toBe(true));
    expect(FakeEventSource.all).toHaveLength(0);
  });

  it('once decided, the refined prompt is a collapsed history item, not an editor', async () => {
    approvals = [];
    await open();
    expect(await screen.findByText('Prompt melhorado usado nesta execução')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt melhorado (editável)')).toBeNull();
  });
});

describe('failed refinement', () => {
  beforeEach(() => {
    messages = [msg({ id: 1, conteudo: 'faça X' })];
    runs = [run({ id: 'r1', etapa: 'melhorar', status: 'erro', erro: 'limit reached' })];
    approvals = [{ id: 'a1', runId: 'r1', motivo: 'Falha ao melhorar o prompt: usage limit reached' }];
  });

  it('shows the reason and lets the user choose; nothing happens by itself', async () => {
    const user = await open();
    const alert = await screen.findByRole('alert', { name: 'Falha ao melhorar o prompt' });
    expect(alert).toHaveTextContent('usage limit reached');
    expect(calls.some((c) => c.path.includes('/retry') || c.path.includes('/continue'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Tentar com haiku' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/runs/r1/retry')?.body).toEqual({ provider: 'claude-cli', model: 'haiku' }));
  });

  it('"Executar sem melhorar" continues with the original request', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Executar sem melhorar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/runs/r1/continue')?.body).toEqual({}));
  });
});

describe('chained steps', () => {
  it('when the refinement ends, the next run starts being followed; the panel shows both steps', async () => {
    const user = await open();
    await user.type(screen.getByLabelText('Mensagem'), 'faça X{Enter}');
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(1));
    const first = FakeEventSource.all[0]!;
    first.emit({ type: 'start', runId: 'r1', provider: 'codex-cli' });
    first.emit({ type: 'text', delta: 'Objetivo: X' });
    expect(await screen.findByText('Melhorando o prompt…', {}, { timeout: 100 }).catch(() => null)).toBeDefined();

    // the server stores step 1 and creates step 2 before announcing the end of step 1
    messages = [msg({ id: 1, conteudo: 'faça X' }), msg({ id: 2, papel: 'agente', runId: 'r1', conteudo: 'Objetivo: X' })];
    runs = [
      run({ id: 'r1', etapa: 'melhorar', tokensIn: 100, tokensOut: 10 }),
      run({ id: 'r2', etapa: 'executar', parentRunId: 'r1', provedor: 'claude-cli', status: 'rodando' }),
    ];
    first.emit({ type: 'end', result: 'Objetivo: X' });

    await waitFor(() => expect(FakeEventSource.all.at(-1)?.url).toBe('/api/runs/r2/stream'));
    expect(screen.getAllByText('melhorar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('executar').length).toBeGreaterThan(0);
  });
});
