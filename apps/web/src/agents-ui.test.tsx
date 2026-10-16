// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

const agent = (nome: string, over: Record<string, unknown> = {}) => ({
  nome,
  descricao: `Faz ${nome}`,
  papel: null,
  provedor: 'claude-cli',
  modelo: 'sonnet',
  ferramentas: ['Read'],
  skills: [],
  podeAprovar: false,
  origem: 'exemplo',
  sobrescreve: false,
  ...over,
});

let calls: Call[];
let agents: Array<Record<string, unknown>>;
let problemas: Array<Record<string, unknown>>;
let saveError: string | null;

beforeEach(() => {
  calls = [];
  agents = [agent('revisor'), agent('meu', { origem: 'usuario' })];
  problemas = [];
  saveError = null;
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
      if (path === '/sessions' && method === 'GET') return json({ sessions: [] });
      if (path === '/agents' && method === 'GET') return json({ agents, problemas });
      if (path.startsWith('/agents/') && method === 'GET') return json({ texto: `---\nnome: ${path.slice(8)}\nprovedor: claude-cli\n---\nTexto.\n`, origem: 'exemplo' });
      if (path.startsWith('/agents/') && method === 'PUT') {
        if (saveError) return json({ error: { code: 'invalid_agent', message: saveError } }, 400);
        const nome = path.slice(8);
        agents = [...agents.filter((a) => a.nome !== nome), agent(nome, { origem: 'usuario' })];
        return json({ status: 'saved' });
      }
      if (path.endsWith('/duplicate')) {
        agents = [...agents, agent(String(body?.novoNome), { origem: 'usuario' })];
        return json({ nome: body?.novoNome }, 201);
      }
      if (path.startsWith('/agents/') && method === 'DELETE') {
        agents = agents.filter((a) => a.nome !== path.slice(8));
        return json({ status: 'deleted' });
      }
      return json({ error: { code: 'x', message: `unexpected ${method} ${path}` } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Agentes' }));
  await screen.findByRole('main', { name: 'Biblioteca de agentes' });
  return user;
}

describe('agent library', () => {
  it('does not touch the agents API until it is opened', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Agentes' });
    expect(calls.some((c) => c.path.startsWith('/agents'))).toBe(false);
  });

  it('lists the agents with their origin, provider and tools', async () => {
    await open();
    const card = (await screen.findByRole('button', { name: 'Editar revisor' })).closest('li')!;
    expect(within(card).getByText('exemplo')).toBeInTheDocument();
    expect(within(card).getByText('claude-cli · sonnet')).toBeInTheDocument();
    expect(within(card).getByText('Ferramentas: Read')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Editar meu' }).closest('li')!).getByText('seu')).toBeInTheDocument();
    // the first agent is open in the editor, with its permissions as chips
    const editor = await screen.findByRole('complementary', { name: 'Editor de agente' });
    expect(within(editor).getByRole('heading', { name: 'revisor' })).toBeInTheDocument();
    expect(within(within(editor).getByRole('list', { name: 'Ferramentas' })).getByText('Read')).toBeInTheDocument();
  });

  it('shows a broken file with the reason, next to the working agents', async () => {
    problemas = [{ arquivo: 'agents/quebrado.md', origem: 'usuario', erro: 'ferramentas: Invalid input' }];
    await open();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('agents/quebrado.md');
    expect(alert).toHaveTextContent('ferramentas: Invalid input');
    expect(screen.getByRole('button', { name: 'Editar revisor' })).toBeInTheDocument();
  });

  it('edits an agent: loads the file text and saves it back under the same name', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Editar revisor' }));
    const box = await screen.findByRole('textbox', { name: /Arquivo do agente revisor/ });
    expect((box as HTMLTextAreaElement).value).toContain('nome: revisor');
    expect(screen.getByText(/cria a sua cópia/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/agents/revisor')).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === '/agents/revisor').length).toBeGreaterThan(2)); // reloaded after saving
  });

  it('keeps the editor and the text when the server refuses the agent, and says why', async () => {
    saveError = 'provedor: unknown provider "nuvem"';
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Editar meu' }));
    await screen.findByRole('textbox', { name: /Arquivo do agente meu/ });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown provider "nuvem"');
    expect((screen.getByRole('textbox', { name: /Arquivo do agente meu/ }) as HTMLTextAreaElement).value).toContain('Texto.');
  });

  it('creates a new agent from a template with the chosen name', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Novo agente' }));
    await user.type(screen.getByLabelText('Nome do arquivo'), 'dev-novo');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    const box = await screen.findByRole('textbox', { name: /Arquivo do agente dev-novo/ });
    expect((box as HTMLTextAreaElement).value).toContain('nome: dev-novo');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/agents/dev-novo')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Editar dev-novo' })).toBeInTheDocument();
  });

  it('refuses a bad or repeated name before calling the server', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Novo agente' }));
    await user.type(screen.getByLabelText('Nome do arquivo'), 'Nome Ruim');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('letras minúsculas');
    await user.clear(screen.getByLabelText('Nome do arquivo'));
    await user.type(screen.getByLabelText('Nome do arquivo'), 'revisor');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe');
  });

  it('duplicates an agent under a new name', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Editar revisor' }));
    await user.click(await screen.findByRole('button', { name: 'Duplicar revisor' }));
    const input = screen.getByLabelText('Nome da cópia');
    expect(input).toHaveValue('revisor-2');
    await user.click(screen.getByRole('button', { name: 'Criar cópia' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/agents/revisor/duplicate', body: { novoNome: 'revisor-2' } }));
    expect(await screen.findByRole('button', { name: 'Editar revisor-2' })).toBeInTheDocument();
  });

  it('deleting asks twice, and only the user’s own agents can be deleted', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Editar revisor' }));
    await screen.findByRole('textbox', { name: /Arquivo do agente revisor/ });
    expect(screen.queryByRole('button', { name: 'Excluir revisor' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Editar meu' }));
    await user.click(await screen.findByRole('button', { name: 'Excluir meu' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: '/agents/meu' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Editar meu' })).toBeNull());
  });

});
