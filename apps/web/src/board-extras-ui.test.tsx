// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './components/Board';
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
  estimativa: null,
  prazo: null,
  cicloId: null,
  ordem: Number(id),
  orcamentoTokens: null,
  requerAprovacao: false,
  resumo: null,
  ...over,
});
const bug = { id: 'l1', nome: 'bug', cor: '#ff0000' };
const cycle = { id: 'c1', numero: 1, nome: 'Sprint 1', inicio: '2026-10-19', fim: '2026-11-01' };

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let data: BoardData;
let detail: TicketDetail;

beforeEach(() => {
  calls = [];
  data = {
    estados: [],
    tickets: [
      ticket('1', { etiquetas: [bug], estimativa: 3, prazo: '2026-11-30', cicloId: 'c1' }),
      ticket('2', { bloqueadoPor: ['OWL-1'] }),
      ticket('3', { status: 'concluido', cicloId: 'c1', estimativa: 5 }),
    ],
    aprovacoes: [],
    etiquetas: [bug],
    ciclos: [cycle],
  };
  detail = {
    ticket: data.tickets[1]!,
    parent: null,
    children: [],
    comments: [],
    events: [],
    runs: [],
    uso: { runs: 0, tokensIn: 0, tokensOut: 0, custoEstimado: 0 },
    aprovacoes: [],
    etiquetas: [],
    relacoes: { saem: [], entram: [{ id: 'r1', ticketId: '1', relatedId: '2', tipo: 'bloqueia' }] },
    bloqueadoPor: [{ id: '1', identificador: 'OWL-1', titulo: 'Ticket 1', status: 'pronto' }],
    ciclo: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (method === 'GET' && path === '/projects/p1/board') return json(data);
      if (method === 'GET' && path === '/tickets/2') return json(detail);
      return json({ ok: true }, 201);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (n: string) => new RegExp(`^OWL-${n}\\b.*Ticket ${n}`);
const open = () => render(<Board project={{ id: 'p1', nome: 'Meu app', pasta: '/x' }} onClose={() => {}} pollMs={0} />);

describe('board labels, cycles and blocks', () => {
  it('shows labels, estimate, due date and the block on the cards', async () => {
    open();
    const card1 = await screen.findByRole('button', { name: card('1') });
    expect(card1).toHaveTextContent('#bug');
    expect(card1).toHaveTextContent('3 pt');
    expect(card1).toHaveTextContent('até 30/11/2026');
    expect(await screen.findByRole('button', { name: card('2') })).toHaveTextContent('espera OWL-1');
  });

  it('filters by label and by cycle, and shows the cycle progress', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('button', { name: card('1') });
    await user.selectOptions(screen.getByLabelText('Etiqueta'), 'l1');
    expect(screen.getByRole('button', { name: card('1') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: card('2') })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Etiqueta'), '');
    await user.selectOptions(screen.getByLabelText('Ciclo'), 'c1');
    expect(screen.queryByRole('button', { name: card('2') })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Progresso do ciclo')).toHaveTextContent('1/2 tickets · 5/8 pontos');
    await user.selectOptions(screen.getByLabelText('Ciclo'), 'none');
    expect(screen.getByRole('button', { name: card('2') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: card('1') })).not.toBeInTheDocument();
  });

  it('creates a label and a cycle from the management area', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Etiquetas e ciclos' }));
    const lf = screen.getByRole('form', { name: 'Nova etiqueta' });
    await user.type(within(lf).getByLabelText('Nome'), 'feature');
    await user.click(within(lf).getByRole('button', { name: 'Criar etiqueta' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/projects/p1/labels')?.body).toMatchObject({ nome: 'feature' }));
    const cf = screen.getByRole('form', { name: 'Novo ciclo' });
    await user.type(within(cf).getByLabelText('Início'), '2026-11-02');
    await user.type(within(cf).getByLabelText('Fim'), '2026-11-15');
    await user.click(within(cf).getByRole('button', { name: 'Criar ciclo' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/cycles')?.body).toEqual({ inicio: '2026-11-02', fim: '2026-11-15' }));
  });

  it('in the ticket: warns about the blocker, toggles a label, assigns a cycle, saves estimate and adds a relation', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: card('2') }));
    const panel = await screen.findByRole('region', { name: 'Organização do ticket' });
    expect(panel).toHaveTextContent('Bloqueado por OWL-1');
    expect(panel).toHaveTextContent('bloqueado por');
    await user.click(within(panel).getByRole('checkbox'));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PUT', path: '/tickets/2/labels/l1' })));
    await user.selectOptions(within(panel).getByLabelText('Ciclo'), 'c1');
    await waitFor(() => expect(calls.find((c) => c.path === '/tickets/2/cycle')?.body).toEqual({ cicloId: 'c1' }));
    const f = within(panel).getByRole('form', { name: 'Estimativa e prazo' });
    await user.type(within(f).getByLabelText('Estimativa (pontos)'), '8');
    await user.click(within(f).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/tickets/2')?.body).toEqual({ estimativa: 8, prazo: null }));
    const rf = within(panel).getByRole('form', { name: 'Nova relação' });
    await user.selectOptions(within(rf).getByLabelText('Ticket'), '3');
    await user.click(within(rf).getByRole('button', { name: 'Relacionar' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/tickets/2/relations')?.body).toEqual({ relacionadoId: '3', tipo: 'bloqueia' }));
    await user.click(within(panel).getByRole('button', { name: /Remover relação com OWL-1/ }));
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/relations/r1' })));
  });
});
