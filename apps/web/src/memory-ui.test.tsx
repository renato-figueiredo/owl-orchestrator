// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Fact, Message, SummarizeResult } from './lib/types';

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  addEventListener() {}
  close() {}
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { method: string; path: string; body?: Record<string, unknown> };

let calls: Call[];
let session: Record<string, unknown>;
let facts: Fact[];
let summarizeResult: SummarizeResult;
const messages: Message[] = [
  { id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: 'olá', criadoEm: '' },
  { id: 2, sessionId: 's1', runId: 'r0', papel: 'assistente', conteudo: 'oi!', criadoEm: '' },
];
const settings = { ultimasN: 8, resumirACada: 10, orcamentoTokens: 4000, resumoAutomatico: true, trechosFts: true, mcpMemoria: false, resumidor: { provider: 'claude-cli', model: 'haiku' } };

beforeEach(() => {
  calls = [];
  facts = [];
  session = { id: 's1', projectId: null, titulo: 'Conversa', criadoEm: '', cliProvider: 'claude-cli', resumo: null, resumoAnterior: null };
  summarizeResult = { ok: true, runId: 'rs', resumo: 'novo', fatosNovos: 2 };
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/providers') return json({ providers: [{ id: 'claude-cli', available: true }, { id: 'codex-cli', available: true }] });
      if (path === '/projects') return json({ projects: [{ id: 'p1', nome: 'Alfa', pasta: '/x' }] });
      if (path === '/refiner') return json({ provedor: 'codex-cli', modelo: null, fallback: [] });
      if (path === '/settings' && method === 'GET') return json({ memory: settings });
      if (path === '/settings' && method === 'PUT') return json({ memory: { ...settings, ...(body?.memory as object) } });
      if (path.startsWith('/facts') && method === 'GET') return json({ facts });
      if (path === '/facts' && method === 'POST') return json({ fact: { id: 'fn', projectId: null, texto: body?.texto, fixado: body?.fixado } }, 201);
      if (path.match(/^\/facts\/\w+$/)) return json({ fact: {}, status: 'ok' });
      if (path === '/sessions' && method === 'GET') return json({ sessions: [session] });
      if (path === '/sessions/s1' && method === 'GET') return json({ session, messages, runs: [], approvals: [] });
      if (path === '/sessions/s1/summary' && method === 'PUT') {
        session = { ...session, resumoAnterior: session.resumo, resumo: body?.resumo };
        return json({ session });
      }
      if (path === '/sessions/s1/summary/undo') {
        session = { ...session, resumo: session.resumoAnterior, resumoAnterior: session.resumo };
        return json({ session });
      }
      if (path === '/sessions/s1/summarize') return json({ ...summarizeResult, session });
      if (path === '/sessions/s1/messages') return json({ runId: 'r1' }, 202);
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const sent = () => calls.find((c) => c.path === '/sessions/s1/messages');
const index = (path: string) => calls.findIndex((c) => c.path === path);
async function open() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Conversa' }));
  await screen.findByLabelText('Mensagem');
  return user;
}
async function write(user: ReturnType<typeof userEvent.setup>, text: string, provider?: string) {
  if (provider) await user.selectOptions(screen.getByLabelText('Provedor'), provider);
  await user.type(screen.getByLabelText('Mensagem'), `${text}{Enter}`);
}

describe('switching provider mid-conversation', () => {
  it('asks first, says what is lost and what carries over, and sends nothing yet', async () => {
    const user = await open();
    await write(user, 'continue no codex', 'codex-cli');
    const notice = await screen.findByRole('alertdialog', { name: 'Troca de provedor' });
    expect(notice).toHaveTextContent('Trocar de claude-cli para codex-cli?');
    expect(notice).toHaveTextContent('não acompanha');
    expect(notice).toHaveTextContent('começa do zero');
    expect(notice).toHaveTextContent('fatos fixados, o resumo da conversa e as últimas mensagens');
    expect(sent()).toBeUndefined();
    expect(screen.getByLabelText('Mensagem')).toHaveValue('continue no codex'); // the text is kept
  });

  it('"Trocar sem resumir" sends straight away, without summarizing', async () => {
    const user = await open();
    await write(user, 'oi codex', 'codex-cli');
    await user.click(await screen.findByRole('button', { name: 'Trocar sem resumir' }));
    await waitFor(() => expect(sent()?.body).toMatchObject({ texto: 'oi codex', provider: 'codex-cli' }));
    expect(index('/sessions/s1/summarize')).toBe(-1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Resumir e trocar" summarizes FIRST and then sends', async () => {
    const user = await open();
    await write(user, 'oi codex', 'codex-cli');
    await user.click(await screen.findByRole('button', { name: 'Resumir e trocar' }));
    await waitFor(() => expect(sent()).toBeDefined());
    expect(index('/sessions/s1/summarize')).toBeGreaterThan(-1);
    expect(index('/sessions/s1/summarize')).toBeLessThan(index('/sessions/s1/messages'));
  });

  it('when there is nothing new to summarize it still switches', async () => {
    summarizeResult = { ok: false, error: 'Nothing new to summarize', code: 'nothing_to_summarize' };
    const user = await open();
    await write(user, 'oi', 'codex-cli');
    await user.click(await screen.findByRole('button', { name: 'Resumir e trocar' }));
    await waitFor(() => expect(sent()).toBeDefined());
  });

  it('a failed summary does NOT switch by itself: the user decides', async () => {
    summarizeResult = { ok: false, error: 'The summarizer answered with invalid JSON; the previous summary was kept', code: 'invalid_output' };
    const user = await open();
    await write(user, 'oi', 'codex-cli');
    await user.click(await screen.findByRole('button', { name: 'Resumir e trocar' }));
    expect(await screen.findByText(/Não consegui resumir/)).toBeInTheDocument();
    expect(sent()).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    await waitFor(() => expect(sent()).toBeDefined());
  });

  it('Cancelar sends nothing and keeps the text', async () => {
    const user = await open();
    await write(user, 'talvez não', 'codex-cli');
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent()).toBeUndefined();
    expect(screen.getByLabelText('Mensagem')).toHaveValue('talvez não');
  });

  it('no notice when the provider is the same, or the conversation has no native session yet', async () => {
    let user = await open();
    await write(user, 'mesmo provedor');
    await waitFor(() => expect(sent()).toBeDefined());
    expect(screen.queryByRole('alertdialog')).toBeNull();

    cleanup();
    calls = [];
    session = { ...session, cliProvider: null };
    user = await open();
    await write(user, 'conversa nova', 'codex-cli');
    await waitFor(() => expect(sent()).toBeDefined());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('memory tab', () => {
  async function openMemory() {
    const user = await open();
    await user.click(screen.getByRole('tab', { name: 'Memória' }));
    return user;
  }

  it('shows the stored summary, saves an edit, and undo is only offered when there is a previous version', async () => {
    session = { ...session, resumo: 'Resumo atual', resumoAnterior: null };
    const user = await openMemory();
    const box = await screen.findByLabelText('Resumo (editável)');
    expect(box).toHaveValue('Resumo atual');
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar resumo' })).toBeDisabled(); // nothing changed yet

    await user.clear(box);
    await user.type(box, 'Resumo editado por mim');
    await user.click(screen.getByRole('button', { name: 'Salvar resumo' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/sessions/s1/summary')?.body).toEqual({ resumo: 'Resumo editado por mim' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desfazer' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/sessions/s1/summary/undo')).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('Resumo (editável)')).toHaveValue('Resumo atual'));
  });

  it('"Resumir agora" runs the summarizer and reports what happened', async () => {
    const user = await openMemory();
    await user.click(await screen.findByRole('button', { name: 'Resumir agora' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Resumo atualizado e 2 fato(s) novo(s) para você revisar.');
    summarizeResult = { ok: false, error: 'x', code: 'invalid_output' };
    await user.click(screen.getByRole('button', { name: 'Resumir agora' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('o resumo anterior foi mantido'));
  });

  it('facts: list, pin, edit, delete and add (scoped to the conversation\'s project)', async () => {
    facts = [{ id: 'f1', projectId: null, texto: 'Usar pnpm', fixado: false }];
    const user = await openMemory();
    expect(await screen.findByText('Usar pnpm')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fatos sem projeto' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Fixar: Usar pnpm' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/facts/f1')?.body).toEqual({ fixado: true }));

    await user.click(screen.getByRole('button', { name: 'Editar fato: Usar pnpm' }));
    const edit = screen.getByLabelText('Texto do fato');
    await user.clear(edit);
    await user.type(edit, 'Usar pnpm 12{Enter}');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH' && c.path === '/facts/f1').at(-1)?.body).toEqual({ texto: 'Usar pnpm 12' }));

    await user.type(screen.getByLabelText('Novo fato'), 'Responder em português');
    await user.click(screen.getByRole('button', { name: 'Adicionar fato' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/facts')?.body).toEqual({ texto: 'Responder em português', fixado: true, sessionId: 's1' }));

    await user.click(screen.getByRole('button', { name: 'Apagar fato: Usar pnpm' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/facts/f1')).toBe(true));
  });

  it('a conversation in a project reads and writes that project\'s facts', async () => {
    session = { ...session, projectId: 'p1' };
    const user = await openMemory();
    await screen.findByRole('heading', { name: 'Fatos do projeto Alfa' });
    expect(calls.some((c) => c.method === 'GET' && c.path === '/facts?projectId=p1')).toBe(true);
    await user.type(screen.getByLabelText('Novo fato'), 'regra do Alfa');
    await user.click(screen.getByRole('button', { name: 'Adicionar fato' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/facts')?.body).toEqual({ texto: 'regra do Alfa', fixado: true, projectId: 'p1' }));
  });

  it('settings are editable and saved', async () => {
    const user = await openMemory();
    await user.click(await screen.findByText('Configurações da memória'));
    const n = screen.getByLabelText('Últimas mensagens (N)');
    await user.clear(n);
    await user.type(n, '12');
    await user.click(screen.getByLabelText('Resumir automaticamente'));
    await user.selectOptions(screen.getByLabelText('Resumidor'), 'codex-cli');
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));
    await waitFor(() => {
      const body = calls.find((c) => c.method === 'PUT' && c.path === '/settings')?.body as { memory: Record<string, unknown> };
      expect(body.memory).toMatchObject({ ultimasN: 12, resumoAutomatico: false, resumidor: { provider: 'codex-cli', model: 'haiku' } });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Configurações salvas.');
  });

  it('system notes (e.g. a failed summary) are shown as muted notes, not chat bubbles', async () => {
    messages.push({ id: 3, sessionId: 's1', runId: null, papel: 'sistema', conteudo: 'Não consegui atualizar o resumo.', criadoEm: '' });
    try {
      await open();
      const log = await screen.findByRole('log');
      const note = await within(log).findByText('Não consegui atualizar o resumo.');
      expect(note.tagName).toBe('P');
      expect(note.className).toContain('text-muted');
    } finally {
      messages.pop();
    }
  });
});
