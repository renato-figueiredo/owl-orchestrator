// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board, dropTarget } from './components/Board';
import type { BoardData, Ticket, TicketApproval, TicketDetail } from './lib/types';

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
  estimativa: null,
  prazo: null,
  cicloId: null,
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
  data = { estados: [], tickets: [ticket('1'), ticket('2', { status: 'em_andamento', uso: { runs: 1, tokensIn: 100, tokensOut: 50, custoEstimado: 0.01 } })], aprovacoes: [], etiquetas: [], ciclos: [] };
  detail = {
    ticket: data.tickets[1]!,
    parent: null,
    children: [],
    comments: [{ id: 'c1', autor: 'dev-back', autorTipo: 'agente', texto: 'Implementei.', criadoEm: '2026-10-15 10:00:00' }],
    events: [{ id: 1, autor: 'tech-lead', autorTipo: 'agente', tipo: 'criado', de: null, para: 'pronto', detalhe: null, criadoEm: '2026-10-15 09:00:00' }],
    runs: [{ id: 'r1', agente: 'dev-back', etapa: 'quadro:dev', provedor: 'claude-cli', modelo: 'sonnet', status: 'ok', tokensIn: 100, tokensOut: 50, custoEstimado: 0.01, erro: null }],
    uso: { runs: 1, tokensIn: 100, tokensOut: 50, custoEstimado: 0.01 },
    aprovacoes: [],
    etiquetas: [],
    relacoes: { saem: [], entram: [] },
    bloqueadoPor: [],
    ciclo: null,
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

const card = (n: string) => new RegExp(`^OWL-${n}\\b.*Ticket ${n}`);
const gate = (id: string, over: Partial<TicketApproval> = {}): TicketApproval => ({ id, ticketId: '2', motivo: 'Entrega aguardando aprovação', tipo: 'entrega', status: 'pendente', comentario: null, criadoEm: null, ticketIdentificador: 'OWL-2', ticketTitulo: 'Ticket 2', ...over });
/** Board with ticket 2 waiting on the given gate; opens ticket 2. */
const openWithGate = async (g: TicketApproval) => {
  data.aprovacoes = [g];
  data.tickets[1] = { ...data.tickets[1]!, status: 'aguardando_aprovacao' };
  detail.ticket = data.tickets[1]!;
  detail.aprovacoes = [g];
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('button', { name: card('2') }));
  return { user, screen: await screen.findByRole('region', { name: 'Ticket OWL-2' }) };
};

describe('board', () => {
  it('lays the statuses out in three zones, each column with its tickets', async () => {
    open();
    await screen.findByRole('button', { name: card('1') });
    for (const zone of ['Com os agentes', 'Com você', 'Feito']) expect(screen.getByRole('region', { name: zone })).toBeInTheDocument();
    const agents = screen.getByRole('region', { name: 'Com os agentes' });
    for (const name of ['Backlog', 'Pronto', 'Em andamento', 'Revisão']) expect(within(agents).getByRole('group', { name })).toBeInTheDocument();
    const mine = screen.getByRole('region', { name: 'Com você' });
    for (const name of ['Aprovar', 'Destravar']) expect(within(mine).getByRole('group', { name })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Pronto' })).getByText('Ticket 1')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Em andamento' })).getByText('Ticket 2')).toBeInTheDocument();
    expect(within(mine).getByText('Nada esperando você')).toBeInTheDocument();
  });

  it('puts finished tickets in the Feito zone and a gate on the card as "na sua mesa"', async () => {
    data.tickets.push(ticket('3', { status: 'concluido' }), ticket('4', { status: 'aguardando_aprovacao' }));
    data.aprovacoes = [gate('a4', { ticketId: '4', ticketIdentificador: 'OWL-4', ticketTitulo: 'Ticket 4' })];
    open();
    const done = await screen.findByRole('group', { name: 'Concluído' });
    expect(within(done).getByRole('button', { name: /OWL-3: Ticket 3/ })).toBeInTheDocument();
    const waiting = within(screen.getByRole('group', { name: 'Aprovar' })).getByRole('button', { name: card('4') });
    expect(waiting).toHaveTextContent('Entrega · na sua mesa');
  });

  it('opens a ticket with its comments by agent, activity, runs and what it cost', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: card('2') }));
    const panel = await screen.findByRole('region', { name: 'Ticket OWL-2' });
    expect(await within(panel).findByText('Implementei.')).toBeInTheDocument();
    expect(within(panel).getByText(/\(agente\)/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('Custo do ticket')).toHaveTextContent('1 execução · 150 tok · $0,010');
    expect(within(panel).getByRole('list', { name: 'Atividade' })).toHaveTextContent('tech-lead criou pronto');
    await user.click(within(panel).getByRole('button', { name: 'Quadro' }));
    expect(await screen.findByRole('region', { name: 'Com os agentes' })).toBeInTheDocument();
  });

  it('shows the pending gate inline; rejecting needs a reason and sends it', async () => {
    const { user, screen: panel } = await openWithGate(gate('a1'));
    const g = await within(panel).findByRole('region', { name: 'Aprovação: Entrega OWL-2' });
    expect(g).toHaveTextContent('Entrega aguardando aprovação');
    await user.click(within(g).getByRole('button', { name: 'Reprovar com motivo' }));
    const reject = within(g).getByRole('button', { name: 'Reprovar' });
    expect(reject).toBeDisabled();
    await user.type(within(g).getByRole('textbox', { name: 'Motivo da reprovação' }), 'falta teste');
    await user.click(reject);
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/a1/decide')?.body).toEqual({ decisao: 'rejeitado', comentario: 'falta teste' }));
  });

  it('approves with one click', async () => {
    const { user, screen: panel } = await openWithGate(gate('a1', { motivo: 'Ação destrutiva: rm -rf dist', tipo: 'destrutiva' }));
    const g = await within(panel).findByRole('region', { name: 'Aprovação: Ação destrutiva OWL-2' });
    expect(g).toHaveTextContent('rm -rf dist');
    await user.click(within(g).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/a1/decide')?.body).toEqual({ decisao: 'aprovado' }));
  });

  it('a "reprovacao" gate says the author redoes it either way', async () => {
    const { user, screen: panel } = await openWithGate(gate('a1', { motivo: 'Revisor reprovou', tipo: 'reprovacao' }));
    const g = await within(panel).findByRole('region', { name: 'Aprovação: Reprovação OWL-2' });
    expect(within(g).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(g).toHaveTextContent('Nos dois casos o autor refaz');
    expect(within(g).getByRole('button', { name: 'Refazer do meu jeito' })).toBeDisabled();
    await user.click(within(g).getByRole('button', { name: 'Confirmar e refazer' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/a1/decide')?.body).toEqual({ decisao: 'aprovado' }));
  });

  it('comments as the human', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: card('2') }));
    await user.type(await screen.findByRole('textbox', { name: 'Novo comentário' }), 'ok, segue');
    await user.click(screen.getByRole('button', { name: 'Comentar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/tickets/2/comments')?.body).toEqual({ texto: 'ok, segue' }));
  });

  it('creates a ticket and starts a goal', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Novo ticket' }));
    const form = screen.getByRole('form', { name: 'Novo ticket' });
    await user.type(within(form).getByRole('textbox', { name: 'Título' }), 'Corrigir login');
    await user.click(within(form).getByRole('button', { name: 'Criar ticket' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/tickets')?.body).toMatchObject({ titulo: 'Corrigir login', requerAprovacao: true, status: 'pronto' }));

    await user.click(await screen.findByRole('button', { name: 'Quadro' })); // creating opens the new ticket
    await user.click(await screen.findByRole('button', { name: 'Novo objetivo' }));
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
