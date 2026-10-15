// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetricsPanel } from './components/MetricsPanel';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const row = { chave: '', rotulo: '', runs: 0, ok: 0, erro: 0, cancelados: 0, taxaSucesso: null, tokensIn: 0, tokensOut: 0, custo: 0, retrabalho: 0 };
const metrics = { totais: { ...row, roteador: { runs: 0, tokens: 0 }, taxaRetrabalho: null }, porTicket: [], porAgente: [], porModelo: [] };
const dia = { limite: null, usado: 0, percentual: null, aviso: false, estourado: false };
const tier = (m: string) => ({ provedor: 'claude-cli', modelo: m });
const router = { tiers: { pequeno: tier('haiku'), medio: tier('sonnet'), forte: tier('opus') }, localPequeno: { ativo: true, modelo: 'gemma4:e2b' }, limiarConfianca: 0.6, orcamentoDiaTokens: null };

function stub(local: unknown, puts: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      if (path.startsWith('/metrics')) return json({ metrics, dia });
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return json({ router, dia, ...(local !== undefined ? { local } : {}) });
      }
      return json({ router, dia, ...(local !== undefined ? { local } : {}) });
    }),
  );
}
const open = () => render(<MetricsPanel projects={[{ id: 'p1', nome: 'A', pasta: '/a' }]} providers={[{ id: 'claude-cli', available: true }]} initialProjectId="p1" onClose={() => {}} />);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MetricsPanel local model (QA)', () => {
  it('tells the user Ollama is down and the fallback applies', async () => {
    stub({ disponivel: false, modelos: [] });
    open();
    const form = await screen.findByRole('form', { name: 'Roteador' });
    expect(await within(form).findByText(/Ollama fora do ar/)).toBeInTheDocument();
  });
  it('still renders (as down) when the server omits `local`', async () => {
    stub(undefined);
    open();
    const form = await screen.findByRole('form', { name: 'Roteador' });
    expect(await within(form).findByText(/Ollama fora do ar/)).toBeInTheDocument();
  });
  it('lists installed models as suggestions and keeps the saved model in the field', async () => {
    stub({ disponivel: true, modelos: ['a:1', 'b:2'] });
    const { container } = open();
    const form = await screen.findByRole('form', { name: 'Roteador' });
    await within(form).findByText(/Ollama no ar com 2 modelo/);
    expect(Array.from(container.querySelectorAll('#modelos-locais option')).map((o) => (o as HTMLOptionElement).value)).toEqual(['a:1', 'b:2']);
    expect(within(form).getByLabelText(/Modelo instalado/)).toHaveValue('gemma4:e2b');
  });
  it('omits `modelo` when the field is cleared', async () => {
    const puts: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    stub({ disponivel: true, modelos: ['a:1'] }, puts);
    open();
    const form = await screen.findByRole('form', { name: 'Roteador' });
    await userEvent.clear(within(form).getByLabelText(/Modelo instalado/));
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar roteador' }));
    await screen.findByText('Roteador salvo.');
    expect(puts[0]!.localPequeno).toEqual({ ativo: true });
  });
});
