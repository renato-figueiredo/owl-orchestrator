// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './components/Board';
import { ProjectScreen } from './components/ProjectScreen';
import type { BoardData, ProjectView, TicketDetail } from './lib/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let view: ProjectView;
let facts: Array<{ id: string; texto: string; fixado: boolean }>;
let detail: TicketDetail;

const projects = [
  { id: 'p1', nome: 'Alfa', pasta: '/a' },
  { id: 'p2', nome: 'Beta', pasta: '/b' },
];

beforeEach(() => {
  calls = [];
  facts = [{ id: 'f1', texto: 'Deploy às sextas', fixado: true }];
  view = {
    project: { ...projects[0]!, maxConcorrencia: null, branchBase: null },
    instrucoes: null,
    git: true,
    branchAtual: 'main',
    branchBase: 'main',
    concorrencia: { projeto: 2, padraoDoServidor: 2, global: 1, emExecucao: 0 },
    equipes: [{ id: 't1', projectId: 'p1', nome: 'Core', membros: [{ agentId: 'a1', agente: 'tech-lead', papel: 'techlead' }] }],
  };
  const ticket = { id: '2', projectId: 'p1', parentId: null, identificador: 'ALF-2', titulo: 'Função', descricao: null, criteriosAceite: null, status: 'concluido' as const, responsavel: 'dev-back', prioridade: 0, estimativa: null, prazo: null, cicloId: null, ordem: 1, orcamentoTokens: null, requerAprovacao: false, resumo: null };
  detail = {
    ticket,
    parent: null,
    children: [],
    comments: [],
    events: [],
    runs: [],
    uso: { runs: 0, tokensIn: 0, tokensOut: 0, custoEstimado: 0 },
    aprovacoes: [],
    etiquetas: [],
    relacoes: { saem: [], entram: [] },
    bloqueadoPor: [],
    ciclo: null,
    branch: { branch: 'owl/alf-2-funcao', worktree: null, estado: 'removido', base: 'main', commitsAdiante: 2, alterado: false },
  };
  const board: BoardData = { estados: [], tickets: [ticket], aprovacoes: [], etiquetas: [], ciclos: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/projects/p1') return json(view);
      if (path === '/projects/p2') return json({ ...view, project: { ...projects[1]!, maxConcorrencia: null, branchBase: null }, equipes: [] });
      if (path === '/agents')
        return json({
          agents: [
            { nome: 'tech-lead', descricao: null, papel: 'techlead', provedor: 'claude-cli', modelo: null, ferramentas: [], skills: [], podeAprovar: false, origem: 'exemplo', sobrescreve: false },
            { nome: 'dev-back', descricao: null, papel: 'dev', provedor: 'claude-cli', modelo: null, ferramentas: [], skills: [], podeAprovar: false, origem: 'exemplo', sobrescreve: false },
          ],
          problemas: [],
        });
      if (path.startsWith('/teams/') && method === 'PUT') return json({ equipe: view.equipes[0] });
      if (path.startsWith('/teams/') && method === 'DELETE') return json({ equipe: view.equipes[0] });
      if (path === '/projects/p1' && method === 'PATCH') return json({ project: view.project });
      if (path === '/projects/p1/agents/tech-lead/facts' && method === 'GET') return json({ facts });
      if (path === '/projects/p1/agents/tech-lead/facts') return json({ fact: { id: 'f2', texto: 'x', fixado: true } }, 201);
      if (path === '/projects/p1/board') return json(board);
      if (path === '/tickets/2') return json(detail);
      if (path.startsWith('/tickets/2/branch/')) return json({ ticket: {}, aprovacoes: [] }, 202);
      return json({ error: { code: 'x', message: `unexpected ${method} ${path}` } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const screenFor = (over: Partial<Parameters<typeof ProjectScreen>[0]> = {}) =>
  render(<ProjectScreen projects={projects} projectId="p1" onSwitch={() => {}} onClose={() => {}} onChanged={() => {}} onOpenBoard={() => {}} {...over} />);

describe('project screen', () => {
  it('shows the project, git state, concurrency and the teams with their roles', async () => {
    screenFor();
    const form = await screen.findByRole('form', { name: 'Configurações do projeto' });
    expect(form).toHaveTextContent('Repositório git · branch atual: main');
    expect(form).toHaveTextContent('padrão do servidor (2)');
    const team = screen.getByLabelText('Equipe Core');
    expect(within(team).getByText('tech-lead')).toBeInTheDocument();
    expect(within(team).getByRole('textbox', { name: 'Papel de tech-lead' })).toHaveValue('techlead');
  });

  it('warns when the folder is not a git repository', async () => {
    view = { ...view, git: false, branchAtual: null };
    screenFor();
    expect(await screen.findByText(/Não é um repositório git/)).toBeInTheDocument();
  });

  it('adds an agent to a team, changes its role and removes it', async () => {
    const user = userEvent.setup();
    screenFor();
    const team = await screen.findByLabelText('Equipe Core');
    await user.selectOptions(within(team).getByRole('combobox', { name: 'Adicionar agente' }), 'dev-back');
    await user.click(within(team).getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/teams/t1/members/dev-back')?.body).toEqual({ papel: null }));

    const role = within(team).getByRole('textbox', { name: 'Papel de tech-lead' });
    await user.clear(role);
    await user.type(role, 'gerente');
    await user.tab();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/teams/t1/members/tech-lead')?.body).toEqual({ papel: 'gerente' }));

    await user.click(within(team).getByRole('button', { name: 'Remover tech-lead' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/teams/t1/members/tech-lead')).toBe(true));
  });

  it('saves the settings; an empty limit means the server default', async () => {
    const user = userEvent.setup();
    screenFor();
    const form = await screen.findByRole('form', { name: 'Configurações do projeto' });
    await user.type(within(form).getByLabelText(/Execuções simultâneas/), '3');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ nome: 'Alfa', instrucoes: null, branchBase: null, maxConcorrencia: 3 }));
  });

  it('shows what an agent remembers in this project and saves a new fact there', async () => {
    const user = userEvent.setup();
    screenFor();
    const team = await screen.findByLabelText('Equipe Core');
    await user.click(within(team).getByRole('button', { name: 'Memória' }));
    const mem = await screen.findByLabelText('Memória de tech-lead');
    expect(await within(mem).findByText('Deploy às sextas')).toBeInTheDocument();
    expect(mem).toHaveTextContent('Memória de tech-lead em Alfa');
    await user.type(within(mem).getByRole('textbox', { name: 'Novo fato' }), 'Revisar em dupla');
    await user.click(within(mem).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/projects/p1/agents/tech-lead/facts')?.body).toEqual({ texto: 'Revisar em dupla', fixado: true }));
  });

  it('switches project from the selector', async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    screenFor({ onSwitch });
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Projeto' }), 'p2');
    expect(onSwitch).toHaveBeenCalledWith('p2');
  });
});

describe('board: project selector and the ticket branch', () => {
  it('offers the team screen in the header (the project selector lives in the Vigia bar)', async () => {
    const onOpenProject = vi.fn();
    const user = userEvent.setup();
    render(<Board project={projects[0]!} projects={projects} onSwitch={() => {}} onOpenProject={onOpenProject} onClose={() => {}} pollMs={0} />);
    await user.click(await screen.findByRole('button', { name: 'Equipe e configurações' }));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('shows the branch of a ticket; merging and discarding only ask for approval', async () => {
    const user = userEvent.setup();
    render(<Board project={projects[0]!} onClose={() => {}} pollMs={0} />);
    await user.click(await screen.findByRole('button', { name: /ALF-2: Função/ }));
    const panel = await screen.findByLabelText('Branch do ticket');
    expect(panel).toHaveTextContent('owl/alf-2-funcao');
    expect(panel).toHaveTextContent('2 commit(s) à frente de main');
    expect(panel).toHaveTextContent('Nada entra na sua branch sem a sua aprovação');
    await user.click(within(panel).getByRole('button', { name: 'Pedir mesclagem em main' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/tickets/2/branch/merge')).toBe(true));
    await user.click(within(panel).getByRole('button', { name: 'Descartar trabalho' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/tickets/2/branch/descartar')).toBe(true));
  });

  it('a merged branch has no actions left', async () => {
    detail.branch = { ...detail.branch!, estado: 'mesclado', commitsAdiante: null };
    const user = userEvent.setup();
    render(<Board project={projects[0]!} onClose={() => {}} pollMs={0} />);
    await user.click(await screen.findByRole('button', { name: /ALF-2: Função/ }));
    const panel = await screen.findByLabelText('Branch do ticket');
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(panel).toHaveTextContent('mesclada');
  });
});
