// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsQueue } from './screens/ApprovalsQueue';
import type { Project, TicketApproval, TicketDetail } from './lib/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gate = (id: string, over: Partial<TicketApproval> = {}): TicketApproval => ({
  id,
  ticketId: `t${id}`,
  motivo: 'Entrega aguardando aprovação',
  tipo: 'entrega',
  status: 'pendente',
  comentario: null,
  criadoEm: null,
  ticketIdentificador: `OWL-${id}`,
  ticketTitulo: `Ticket ${id}`,
  ...over,
});
const projects: Project[] = [
  { id: 'p1', nome: 'App', pasta: '/a' },
  { id: 'p2', nome: 'Site', pasta: '/s' },
];

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let pending: Record<string, TicketApproval[]>;

const detailOf = (ticketId: string): TicketDetail => ({
  ticket: { id: ticketId, projectId: 'p1', parentId: null, identificador: 'OWL-1', titulo: 'x', descricao: null, criteriosAceite: '- compila\n- testes passam', status: 'aguardando_aprovacao', responsavel: 'dev-back', prioridade: 0, estimativa: null, prazo: null, cicloId: null, ordem: 1, orcamentoTokens: null, requerAprovacao: true, resumo: null },
  parent: null,
  children: [],
  comments: [],
  events: [],
  runs: [{ id: 'r', agente: 'dev-back', etapa: null, provedor: 'claude-cli', modelo: null, status: 'ok', tokensIn: 100, tokensOut: 50, custoEstimado: 0.01, erro: null }],
  uso: { runs: 1, tokensIn: 18000, tokensOut: 400, custoEstimado: 0.042 },
  aprovacoes: [],
  etiquetas: [],
  relacoes: { saem: [], entram: [] },
  bloqueadoPor: [],
  ciclo: null,
  branch: { branch: 'owl/OWL-1', worktree: null, estado: 'ativo', base: 'main', commitsAdiante: 2, alterado: false },
});

beforeEach(() => {
  calls = [];
  pending = { p1: [gate('1'), gate('2', { tipo: 'destrutiva', motivo: 'Ação destrutiva: git worktree remove x7' })], p2: [gate('3', { tipo: 'reprovacao', motivo: 'Revisor reprovou' })] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      const m = /^\/projects\/(\w+)\/approvals$/.exec(path);
      if (m) return json({ aprovacoes: pending[m[1]!] ?? [] });
      if (path.startsWith('/tickets/')) return json(detailOf(path.slice(9)));
      if (path.endsWith('/decide')) {
        const id = path.split('/')[2]!;
        for (const k of Object.keys(pending)) pending[k] = pending[k]!.filter((a) => a.id !== id);
        return json({ aprovacao: {} });
      }
      return json({ error: { code: 'x', message: `unexpected ${method} ${path}` } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (onChanged = () => {}) => render(<ApprovalsQueue projects={projects} currentId="p1" onChanged={onChanged} pollMs={0} />);

describe('approvals queue', () => {
  it('lists the pending gates of every project with the count', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Pendentes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list).toHaveTextContent('OWL-1 · App');
    expect(list).toHaveTextContent('OWL-3 · Site');
    expect(screen.getByLabelText('3 pendentes')).toBeInTheDocument();
  });

  it('shows the selected gate with what will run and the ticket data', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Ação destrutiva.*Ticket 2/ }));
    const detail = screen.getByRole('region', { name: 'Aprovação selecionada' });
    expect(within(detail).getByText('git worktree remove x7')).toBeInTheDocument();
    expect(await within(detail).findByText('owl/OWL-1')).toBeInTheDocument();
    expect(detail).toHaveTextContent('18,4k tok · $0,042');
    expect(detail).toHaveTextContent('Diff indisponível');
    expect(detail).toHaveTextContent('compila');
    expect(detail).toHaveTextContent('alto');
  });

  it('approves, tells the shell and moves the gate to the session history', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    open(onChanged);
    await screen.findByRole('list', { name: 'Pendentes' });
    await user.click(screen.getByRole('button', { name: /Aprovar/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/1/decide')?.body).toEqual({ decisao: 'aprovado' }));
    expect(onChanged).toHaveBeenCalled();
    const history = await screen.findByRole('region', { name: 'Decididas nesta sessão' });
    expect(history).toHaveTextContent('OWL-1');
    expect(history).toHaveTextContent('aprovado');
  });

  it('rejecting needs a reason', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('list', { name: 'Pendentes' });
    await user.click(screen.getByRole('button', { name: /Reprovar com motivo/ }));
    const reject = screen.getByRole('button', { name: 'Reprovar' });
    expect(reject).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Motivo da reprovação' }), 'sem testes');
    await user.click(reject);
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/1/decide')?.body).toEqual({ decisao: 'rejeitado', comentario: 'sem testes' }));
  });

  it('keyboard: J moves down, A approves', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('list', { name: 'Pendentes' });
    await user.keyboard('j');
    expect(screen.getByRole('button', { name: /Ação destrutiva.*Ticket 2/ })).toHaveAttribute('aria-current', 'true');
    await user.keyboard('a');
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/2/decide')?.body).toEqual({ decisao: 'aprovado' }));
  });

  it('a "reprovacao" gate offers the two rework answers instead', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Reprovação.*Ticket 3/ }));
    const detail = screen.getByRole('region', { name: 'Aprovação selecionada' });
    expect(within(detail).queryByRole('button', { name: /Aprovar/ })).toBeNull();
    await user.click(within(detail).getByRole('button', { name: 'Confirmar e refazer' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/approvals/3/decide')?.body).toEqual({ decisao: 'aprovado' }));
  });

  it('says so when nothing waits for you', async () => {
    pending = { p1: [], p2: [] };
    open();
    expect(await screen.findByText('Nada esperando você')).toBeInTheDocument();
  });
});
