// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './components/Chat';
import { Markdown } from './components/Markdown';
import { RunPanel } from './components/RunPanel';
import { MemoryScreen } from './screens/MemoryScreen';
import type { StreamState } from './lib/stream';
import type { Message, Run } from './lib/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const msg = (over: Partial<Message>): Message => ({ id: 1, sessionId: 's1', runId: null, papel: 'usuario', conteudo: '', criadoEm: '', ...over });
const run = (over: Partial<Run>): Run => ({ id: 'r1', etapa: null, parentRunId: null, provedor: 'claude-cli', modelo: 'sonnet', status: 'ok', tokensIn: null, tokensOut: null, custoEstimado: null, inicio: '', fim: null, erro: null, ...over });
const stream = (over: Partial<StreamState>): StreamState => ({ phase: 'running', text: '', tools: [], ...over });
const providers = [
  { id: 'claude-cli', available: true },
  { id: 'codex-cli', available: true },
];

function chat(over: Partial<Parameters<typeof Chat>[0]> = {}) {
  const props = {
    hasSession: true,
    messages: [],
    stream: null,
    providers,
    busy: false,
    error: null,
    onSend: vi.fn(async () => {}),
    onCancel: vi.fn(),
    refiner: null,
    approvals: [],
    streamStep: null,
    onContinue: vi.fn(),
    onRetry: vi.fn(),
    onDiscard: vi.fn(),
    sessionProvider: 'claude-cli',
    onSummarize: vi.fn(async () => null),
    ...over,
  };
  render(<Chat {...props} />);
  return props;
}

describe('Chat (design)', () => {
  it('empty states are short and factual, with the quiet owl', () => {
    chat({ hasSession: false });
    expect(screen.getByText('Nenhuma conversa aberta')).toBeInTheDocument();
    expect(document.querySelector('img[src="/brand/mark.svg"]')).not.toBeNull();
  });

  it('loading state: animated owl and skeleton rows', () => {
    chat({ loading: true });
    expect(screen.getByRole('status', { name: 'Carregando a conversa' })).toBeInTheDocument();
    expect(document.querySelector('img[src="/brand/anim-sync.svg"]')).not.toBeNull();
  });

  it('top bar shows project / title / ticket chip', async () => {
    const onOpen = vi.fn();
    chat({ projectName: 'owl-orchestrator', title: 'Retry com backoff', ticket: { id: 'OWL-133', onOpen } });
    expect(screen.getByRole('heading', { name: 'Retry com backoff' })).toBeInTheDocument();
    expect(screen.getByText('owl-orchestrator')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir ticket OWL-133' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('agent replies carry the AgentTag with provider and model as data', () => {
    chat({ messages: [msg({ id: 1, conteudo: 'oi' }), msg({ id: 2, papel: 'assistente', runId: 'r1', conteudo: 'Encontrei 3 chamadas' })], runs: [run({ etapa: 'dev-front' })] });
    expect(screen.getByText('dev-front')).toBeInTheDocument();
    expect(screen.getByText('adaptador: claude-cli · sonnet')).toBeInTheDocument();
  });

  it('streaming shows the amber caret inline and the owl eyes; a failed run offers another provider', async () => {
    const { onSend } = chat({ stream: stream({ text: 'Rodando', provider: 'claude-cli' }) });
    expect(screen.getByText('▍')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parar execução' })).toBeInTheDocument();
    cleanup();
    const props = chat({ stream: stream({ phase: 'error', error: 'boom', provider: 'claude-cli' }), messages: [msg({ conteudo: 'faça X' })], sessionProvider: null });
    const alert = screen.getByRole('alert', { name: 'A run falhou' });
    expect(alert).toHaveTextContent('boom');
    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar com codex-cli' }));
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith({ texto: 'faça X', provider: 'codex-cli' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('composer: refine toggle reveals the options; send is the amber arrow', async () => {
    const props = chat();
    await userEvent.type(screen.getByLabelText('Mensagem'), 'oi{Enter}');
    expect(props.onSend).toHaveBeenCalledWith({ texto: 'oi', provider: 'claude-cli' });
    const refine = screen.getByRole('button', { name: 'Refinar prompt' });
    expect(refine).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(refine);
    expect(refine).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('switch', { name: 'Editar antes de executar' })).toBeInTheDocument();
  });
});

describe('Markdown code blocks', () => {
  it('header shows the file given on the fence (or the language) and a copiar button', () => {
    render(<Markdown>{'```ts src/adapters/retry.ts\nconst a = 1;\n```\n\n```\nb\n```'}</Markdown>);
    expect(screen.getByText('src/adapters/retry.ts')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'copiar' })).toHaveLength(2);
  });
  it('caret sits inside the last paragraph while streaming', () => {
    const { container } = render(<Markdown caret>{'primeiro\n\nsegundo'}</Markdown>);
    const last = container.querySelectorAll('p')[1]!;
    expect(last).toHaveTextContent('segundo▍');
  });
});

describe('RunPanel (design)', () => {
  it('header: status pill, metrics grid and Cancelar with its shortcut', async () => {
    const onCancel = vi.fn();
    render(
      <RunPanel
        runs={[run({ status: 'rodando', inicio: new Date(Date.now() - 72_000).toISOString(), tokensIn: 100 })]}
        stream={stream({ inputTokens: 18_400, outputTokens: 2_100, costUsd: 0.042, provider: 'claude-cli', model: 'sonnet' })}
        open
        onToggle={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('rodando');
    for (const label of ['TEMPO', 'ENTRADA', 'SAÍDA', 'CUSTO']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('18,4k')).toBeInTheDocument();
    expect(screen.getByText('2,1k')).toBeInTheDocument();
    expect(screen.getByText('$0,042')).toBeInTheDocument();
    expect(screen.getAllByText(/^01:1\d$/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('timeline: tool steps expand to show an edit as - / + lines', async () => {
    render(
      <RunPanel
        runs={[]}
        stream={stream({ tools: [{ name: 'Edit', input: { file_path: 'a.ts', old_string: 'um', new_string: 'dois' } }, { name: 'Bash', input: { command: 'pnpm test' } }] })}
        open
        onToggle={() => {}}
      />,
    );
    const steps = screen.getByRole('list', { name: 'Linha do tempo' });
    expect(within(steps).getByText('pnpm test')).toBeInTheDocument();
    await userEvent.click(within(steps).getByRole('button', { name: /Edit/ }));
    expect(within(steps).getByText('- um')).toHaveStyle({ color: 'var(--c-diff-del)' });
    expect(within(steps).getByText('+ dois')).toHaveStyle({ color: 'var(--c-diff-add)' });
  });

  it('below 1280px it is a drawer: closed at first, opens from the handle and closes with Escape', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    render(<RunPanel runs={[]} stream={null} open onToggle={() => {}} />);
    expect(screen.queryByLabelText('Histórico de execuções')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir painel de execução' }));
    expect(screen.getByRole('complementary', { name: 'Execução' })).toHaveClass('fixed');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Histórico de execuções')).toBeNull();
  });
});

describe('MemoryScreen', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  it('loads the project facts and filters them with the search box', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const path = input.replace(/^\/api/, '');
        calls.push(path);
        if (path.startsWith('/facts')) return json({ facts: [{ id: 'f1', projectId: 'p1', texto: 'Usar pnpm', fixado: true }, { id: 'f2', projectId: 'p1', texto: 'Responder em português', fixado: false }] });
        if (path === '/sessions') return json({ sessions: [] });
        if (path === '/settings') return json({ memory: { ultimasN: 8, resumirACada: 10, orcamentoTokens: 4000, resumoAutomatico: true, trechosFts: true, mcpMemoria: false, resumidor: { provider: 'claude-cli' } } });
        if (path === '/providers') return json({ providers: [{ id: 'claude-cli', available: true }] });
        return json({ error: { code: 'nf', message: 'nope' } });
      }),
    );
    render(<MemoryScreen projects={[{ id: 'p1', nome: 'Alfa', pasta: '/x' } as never]} projectId="p1" />);
    expect(await screen.findByText('Usar pnpm')).toBeInTheDocument();
    expect(calls).toContain('/facts?projectId=p1');
    expect(screen.getByRole('heading', { name: 'Memória' })).toBeInTheDocument();
    expect(screen.getByText(/PROJETO · ALFA/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fixar: Usar pnpm' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(screen.getByLabelText('Buscar na memória'), 'portugu');
    expect(screen.queryByText('Usar pnpm')).toBeNull();
    const results = screen.getByRole('region', { name: 'Resultados da busca' });
    expect(within(results).getByText('Responder em português')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Buscar na memória'));
    await userEvent.type(screen.getByLabelText('Buscar na memória'), 'zzz');
    expect(screen.getByText(/Nada encontrado para “zzz”/)).toBeInTheDocument();
  });
});
