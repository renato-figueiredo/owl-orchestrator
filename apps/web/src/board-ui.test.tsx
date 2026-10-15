// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, dropTarget } from './components/Board';
import type { BoardData, Ticket, TicketDetail } from './lib/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  projectId: 'p1',
  parentId: null,
  identificador: `OWL-${id}`,
  titulo: `Ticket ${id}`,
  descricao: null,
  criteriosAceite: null,
  status: 'pronto',
  responsavel: null,
  prioridade: 0,
  ordem: Number(id),
  orcamentoTokens: null,
  requerAprovacao: false,
  resumo: null,
  ...over,
});

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let data: BoardData;
let detail: TicketDetail;

beforeEach(() => {
  calls = [];
  data = { estados: [], tickets: [ticket('1'), ticket('2', { status: 'em_andamento', uso: { runs: 1, tokensIn: 100, tokensOut: 50, custoEstimado: 0.01 } })], aprovacoes: [] };
  detail = {
    ticket: data.tickets[1]!,
    parent: null,
    children: [],
    comments: [{ id: 'c1', autor: 'dev-back', autorTipo: 'agente', texto: 'Implementei.', criadoEm: '2026-10-15 10:00:00' }],
    events: [{ id: 1, autor: 'tech-lead', autorTipo: 'agente', tipo: 'criado', de: null, para: 'pronto', detalhe: null, criadoEm: '2026-10-15 09:00:00' }],
    runs: [{ id: 'r1', agente: 'dev-back', etapa: 'quadro:dev', provedor: 'claude-cli', modelo: 'sonnet', status: 'ok', tokensIn: 100, tokensOut: 50, custoEstimado: 0.01, erro: null }],
    uso: { runs: 1, tokensIn: 100, tokensOut: 50, custoEstimado: 0.01 },
    aprovacoes: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/projects/p1/board') return json(data);
      if (path === '/tickets/2') return json(detail);
      if (path.endsWith('/decide')) return json({ aprovacao: {}, ticket: {}, runId: null });
      if (path === '/projects/p1/tickets') return json({ ticket: { id: '9' } }, 201);
      if (path === '/projects/p1/board/goals') return json({ ticket: { id: '9' } }, 202);
      if (path.endsWith('/comments')) return json({ comment: {} }, 201);
      return json({ error: { code: 'x', message: `unexpected ${method} ${path}` } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project = { id: 'p1', nome: 'Meu app', pasta: '/x' };
const open = () => render(<Board project={project} onClose={() => {}} pollMs={0} />);

describe('board', () => {
  it('shows the seven columns with their tickets', async () => {
    open();
    await screen.findByRole('button', { name: /OWL-1: Ticket 1/ });
    for (const name of ['Backlog', 'Pronto', 'Em andamento', 'Em revisão', 'Aguardando aprovação', 'Concluído', 'Bloqueado']) {
      expect(screen.getByRole('listitem', { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('listitem', { name: 'Pronto' })).getByText('Ticket 1')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Em andamento' })).getByText('Ticket 2')).toBeInTheDocument();
  });

  it('opens a ticket with its comments by agent, history, runs and what it cost', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /OWL-2: Ticket 2/ }));
    const panel = await screen.findByRole('complementary', { name: 'Ticket OWL-2' });
    expect(await within(panel).findByText('Implementei.')).toBeInTheDocument();
    expect(within(panel).getByText(/dev-back \(agente\)/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('Custo do ticket')).toHaveTextContent('1 execução(ões) · 150 tokens · US$ 0,0100');
    expect(within(panel).getByRole('list', { name: 'Histórico' })).toHaveTextContent('tech-lead criou Pronto');
  });

  it('lists pending approvals; rejecting needs a comment and sends it', async () => {
    data.aprovacoes = [{ id: 'a1', ticketId: '2', motivo: 'Entrega aguardando aprovação', tipo: 'entrega', status: 'pendente', comentario: null, criadoEm: null, ticketIdentificador: 'OWL-2', ticketTitulo: 'Ticket 2' }];
    const user = userEvent.setup();
    open();
    const queue = await screen.findByRole('region', { name: 'Fila de aprovações' });
    expect(queue).toHaveTextContent('OWL-2 Ticket 2');
    expect(queue).toHaveTextContent('Entrega');
    const reject = within(queue).getByRole('button', { name: 'Rejeitar' });
    expect(reject).toBeDisabled();
    await user.type(within(queue).getByRole('textbox', { name: 'Comentário da decisão' }), 'falta teste');
    await user.click(reject);
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/a1/decide')?.body).toEqual({ decisao: 'rejeitado', comentario: 'falta teste' }));
  });

  it('approves with one click, comment optional', async () => {
    data.aprovacoes = [{ id: 'a1', ticketId: '2', motivo: 'Ação destrutiva: rm -rf', tipo: 'destrutiva', status: 'pendente', comentario: null, criadoEm: null, ticketIdentificador: 'OWL-2', ticketTitulo: 'Ticket 2' }];
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/a1/decide')?.body).toEqual({ decisao: 'aprovado' }));
  });

  it('creates a ticket and starts a goal', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Novo ticket' }));
    const form = screen.getByRole('form', { name: 'Novo ticket' });
    await user.type(within(form).getByRole('textbox', { name: 'Título' }), 'Corrigir login');
    await user.click(within(form).getByRole('button', { name: 'Criar ticket' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/tickets')?.body).toMatchObject({ titulo: 'Corrigir login', requerAprovacao: true, status: 'pronto' }));

    await user.click(screen.getByRole('button', { name: 'Novo objetivo' }));
    await user.type(screen.getByRole('textbox', { name: 'Objetivo' }), 'Login com e-mail');
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/board/goals')?.body).toEqual({ objetivo: 'Login com e-mail' }));
  });
});

describe('dropTarget', () => {
  const tickets = [ticket('1', { ordem: 1 }), ticket('2', { ordem: 2 }), ticket('3', { ordem: 3, status: 'concluido' })];
  it('dropping on a column puts the card at its end', () => {
    expect(dropTarget(tickets, '1', 'col:concluido')).toEqual({ status: 'concluido', ordem: 4 });
    expect(dropTarget(tickets, '1', 'col:backlog')).toEqual({ status: 'backlog', ordem: 1 });
  });
  it('dropping on a card places it before that card, between its neighbours', () => {
    expect(dropTarget(tickets, '3', '2')).toEqual({ status: 'pronto', ordem: 1.5 });
    expect(dropTarget(tickets, '3', '1')).toEqual({ status: 'pronto', ordem: 0 });
  });
  it('ignores unknown targets', () => {
    expect(dropTarget(tickets, '1', 'col:inventado')).toBeNull();
    expect(dropTarget(tickets, '1', 'nada')).toBeNull();
  });
});
