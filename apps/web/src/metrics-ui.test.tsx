// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsPanel } from './components/MetricsPanel';
import type { Metrics } from './lib/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let dia: { limite: number | null; usado: number; percentual: number | null; aviso: boolean; estourado: boolean };

const row = (chave: string, rotulo: string, over: Record<string, unknown> = {}) => ({
  chave, rotulo, runs: 4, ok: 3, erro: 1, cancelados: 0, taxaSucesso: 0.75, tokensIn: 1000, tokensOut: 500, custo: 0.0123, retrabalho: 1, ...over,
});
const metrics: Metrics = {
  totais: { ...row('', ''), runs: 8, ok: 6, erro: 2, taxaSucesso: 0.75, tokensIn: 2000, tokensOut: 1000, retrabalho: 2, roteador: { runs: 2, tokens: 300 }, taxaRetrabalho: 0.25 },
  porTicket: [{ ...row('t1', 't1'), titulo: 'Filtro por data' }],
  porAgente: [row('analista', 'analista'), row('roteador', 'roteador', { retrabalho: 0 })],
  porModelo: [row('claude-cli/haiku', 'claude-cli · haiku')],
};
const projects = [
  { id: 'p1', nome: 'Alfa', pasta: '/a' },
  { id: 'p2', nome: 'Beta', pasta: '/b' },
];
const router = { tiers: { pequeno: { provedor: 'claude-cli', modelo: 'haiku' }, medio: { provedor: 'claude-cli', modelo: 'sonnet' }, forte: { provedor: 'claude-cli', modelo: 'opus' } }, localPequeno: { ativo: true }, limiarConfianca: 0.6, orcamentoDiaTokens: null };

beforeEach(() => {
  calls = [];
  dia = { limite: null, usado: 0, percentual: null, aviso: false, estourado: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (path.startsWith('/metrics')) return json({ metrics, dia });
      if (path === '/router' && method === 'GET') return json({ router, dia, local: { disponivel: true, modelos: ['gemma4:e2b'] } });
      if (path === '/router') return json({ router: { ...router, ...JSON.parse(String(init!.body)) }, dia });
      return json({ error: { code: 'not_found', message: path } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = () => render(<MetricsPanel projects={projects} providers={[{ id: 'claude-cli', available: true }, { id: 'codex-cli', available: false }]} initialProjectId="p1" onClose={() => {}} />);

describe('MetricsPanel', () => {
  it('shows totals and the three tables from the API, for the open project', async () => {
    open();
    await screen.findByText('Filtro por data');
    expect(calls.find((c) => c.path.startsWith('/metrics'))!.path).toBe('/metrics?projectId=p1');
    const totals = within(screen.getByLabelText('Totais'));
    expect(totals.getByText('Runs').nextElementSibling).toHaveTextContent('8');
    expect(totals.getByText('Runs').parentElement).toHaveTextContent('2 do roteador · 300 tokens');
    expect(totals.getByText('Taxa de falha').nextElementSibling).toHaveTextContent('25%'); // 2 failed of 8
    expect(totals.getByText('Taxa de falha').parentElement).toHaveTextContent('25% retrabalho');
    expect(totals.getByText('Tokens').nextElementSibling).toHaveTextContent('3k');
    expect(within(screen.getByLabelText('Por agente')).getByText('analista')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Por modelo')).getByText('claude-cli · haiku')).toBeInTheDocument();
  });

  it('filters by project and period', async () => {
    open();
    await screen.findByText('Filtro por data');
    await userEvent.selectOptions(screen.getByLabelText('Projeto'), '');
    await waitFor(() => expect(calls.at(-1)!.path).toBe('/metrics'));
    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(calls.at(-1)!.path).toMatch(/^\/metrics\?desde=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}$/));
  });

  it('shows the daily budget with its state; without a limit it says so', async () => {
    open();
    await screen.findByText('Filtro por data');
    expect(screen.getByLabelText('Orçamento do dia')).toHaveTextContent('sem limite');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    cleanup();
    dia = { limite: 10_000, usado: 8500, percentual: 0.85, aviso: true, estourado: false };
    open();
    const box = await screen.findByLabelText('Orçamento do dia');
    expect(box).toHaveTextContent('85%');
    expect(box).toHaveTextContent('acima de 80%');
    expect(within(box).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85');
    cleanup();
    dia = { limite: 10_000, usado: 12_000, percentual: 1.2, aviso: false, estourado: true };
    open();
    expect(await screen.findByLabelText('Orçamento do dia')).toHaveTextContent('estourado');
  });

  it('saves the tiers, the confidence threshold and the daily budget', async () => {
    open();
    const form = await screen.findByRole('form', { name: 'Roteador' });
    await userEvent.clear(within(form).getByLabelText('Modelo do tier Forte'));
    await userEvent.type(within(form).getByLabelText('Modelo do tier Forte'), 'opus-novo');
    await userEvent.clear(within(form).getByLabelText(/Confiança mínima/));
    await userEvent.type(within(form).getByLabelText(/Confiança mínima/), '70');
    await userEvent.type(within(form).getByLabelText(/Orçamento diário/), '50.000');
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar roteador' }));
    await screen.findByText('Roteador salvo.');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/router');
    expect(put.body).toMatchObject({ limiarConfianca: 0.7, orcamentoDiaTokens: 50_000, tiers: { forte: { provedor: 'claude-cli', modelo: 'opus-novo' }, pequeno: { modelo: 'haiku' } } });
  });

  it('shows the local model status and saves its switch and model', async () => {
    open();
    const form = await screen.findByRole('form', { name: 'Roteador' });
    expect(await within(form).findByText(/Ollama no ar com 1 modelo/)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/Modelo instalado/), 'gemma4:e2b');
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar roteador' }));
    await screen.findByText('Roteador salvo.');
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ localPequeno: { ativo: true, modelo: 'gemma4:e2b' } });
    await userEvent.click(within(form).getByLabelText(/Usar no tier pequeno/));
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar roteador' }));
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toMatchObject({ localPequeno: { ativo: false } }));
  });
});
