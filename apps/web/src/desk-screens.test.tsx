// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PairScreen } from './screens/PairScreen';
import { PipelinesScreen } from './screens/PipelinesScreen';
import { ProjectsHome } from './screens/ProjectsHome';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let createError: string | null;
let ghState: { instalado: boolean; logado: boolean; usuario: string | null };

const projects = [
  { id: 'p1', nome: 'Alfa', pasta: '/code/alfa', branchBase: 'main' },
  { id: 'p2', nome: 'Beta', pasta: '/code/beta' },
];
const ticket = (status: string) => ({ id: status, projectId: 'p1', identificador: 'ALF-1', titulo: 't', status });

beforeEach(() => {
  calls = [];
  createError = null;
  ghState = { instalado: true, logado: true, usuario: 'renato' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, ...(body ? { body } : {}) });
      if (path === '/pipelines')
        return json({
          pipelines: [
            { nome: 'refinar-executar', etapas: ['refinar', 'executar', 'revisar'], origem: 'exemplo' },
            { nome: 'rapida', etapas: ['executar'], origem: 'usuario' },
          ],
          problemas: [{ arquivo: 'pipelines/quebrada.yaml', origem: 'usuario', erro: 'etapas: vazio' }],
        });
      if (path === '/projects/p1/board') return json({ estados: [], tickets: [ticket('em_andamento'), ticket('backlog'), ticket('concluido')], aprovacoes: [{ id: 'a', status: 'pendente' }], etiquetas: [], ciclos: [] });
      if (path === '/projects/p2/board') return json({ estados: [], tickets: [], aprovacoes: [], etiquetas: [], ciclos: [] });
      if (path === '/projects/p1') return json({ project: projects[0], instrucoes: null, git: true, branchAtual: 'main', branchBase: 'main', concorrencia: {}, equipes: [] });
      if (path === '/projects/p2') return json({ project: projects[1], instrucoes: null, git: false, branchAtual: null, branchBase: null, concorrencia: {}, equipes: [] });
      if (path === '/projects' && method === 'POST') {
        if (createError) return json({ error: { code: 'folder_not_allowed', message: createError } }, 400);
        return json({ project: { id: 'p3', nome: body!.nome, pasta: body!.pasta } }, 201);
      }
      if (path.startsWith('/git/dirs')) return path.includes('alfa') ? json({ pasta: '/code/alfa', pai: '/code', pastas: [] }) : json({ pasta: '/code', pai: null, pastas: [{ nome: 'alfa', caminho: '/code/alfa' }, { nome: 'beta', caminho: '/code/beta' }] });
      if (path === '/git/gh') return json(ghState);
      if (path === '/git/repos') return json({ repositorios: [{ nomeCompleto: 'renato/gama', descricao: null, privado: true, atualizadoEm: null }] });
      if (path === '/git/clone') return json({ pasta: `/code/${body!.nome}`, nome: body!.nome }, 201);
      if (path === '/git/init') return json({ pasta: `/code/${body!.nome}`, nome: body!.nome }, 201);
      if (path === '/projects/p3/git/publish') return json({ ticket: { id: 't9', identificador: 'GAM-1', titulo: 'Publicar' }, approval: { id: 'a9' } }, 202);
      if (path === '/auth/status') return json({ required: true, authenticated: true });
      return json({ error: { code: 'x', message: `unexpected ${method} ${path}` } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pipelines screen', () => {
  it('lists the library pipelines, shows the steps of the selected one and the unreadable files', async () => {
    const user = userEvent.setup();
    render(<PipelinesScreen />);
    const list = await screen.findByRole('navigation', { name: 'Lista de pipelines' });
    expect(within(list).getByText('3 etapas · exemplo')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('pipelines/quebrada.yaml');
    const steps = screen.getByRole('list', { name: 'Etapas de refinar-executar' });
    expect(within(steps).getAllByRole('button').map((b) => b.textContent)).toEqual(['01refinar', '02executar', '03revisar']);
    await user.click(within(steps).getByRole('button', { name: /revisar/ }));
    expect(screen.getByRole('region', { name: 'Etapa revisar' })).toHaveTextContent('depois de executar');
    await user.click(within(list).getByRole('button', { name: /rapida/ }));
    expect(screen.getByRole('list', { name: 'Etapas de rapida' })).toBeInTheDocument();
  });
});

describe('projects home', () => {
  const home = (over: Partial<Parameters<typeof ProjectsHome>[0]> = {}) => render(<ProjectsHome projects={projects} currentId="p1" onOpen={() => {}} onCreated={() => {}} {...over} />);

  it('shows one card per project with real counts and opens it', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    home({ onOpen });
    const alfa = await screen.findByRole('button', { name: 'Abrir Alfa' });
    await waitFor(() => expect(alfa).toHaveTextContent('2 abertos'));
    expect(alfa).toHaveTextContent('1 em andamento');
    expect(alfa).toHaveTextContent('▲ 1 esperando você');
    expect(alfa).toHaveTextContent('Aberto');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir Beta' })).toHaveTextContent('⊘ sem git · só leitura'));
    expect(screen.getByLabelText('O que é de cada projeto')).toHaveTextContent('DA MESA');
    await user.click(alfa);
    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('creates a project from a folder in three steps', async () => {
    const onCreated = vi.fn();
    const onOpen = vi.fn();
    const user = userEvent.setup();
    home({ onCreated, onOpen });
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo projeto' });
    expect(within(dialog).getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Caminho da pasta/), '/code/gama/');
    await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('gama');
    await user.type(within(dialog).getByLabelText(/Instruções do projeto/), 'Use pnpm.');
    await user.click(within(dialog).getByRole('button', { name: 'Criar projeto' }));
    await within(dialog).findByText('gama está no OWL');
    expect(calls.find((c) => c.method === 'POST' && c.path === '/projects')!.body).toEqual({ nome: 'gama', pasta: '/code/gama/', instrucoes: 'Use pnpm.' });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'p3' }));
    await user.click(within(dialog).getByRole('button', { name: 'Abrir projeto' }));
    expect(onOpen).toHaveBeenCalledWith('p3');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clones a GitHub repository into a root and goes on with the cloned folder', async () => {
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo projeto' });
    await user.click(within(dialog).getByRole('button', { name: /GitHub/ }));
    await user.selectOptions(await within(dialog).findByLabelText('Repositório do GitHub'), 'renato/gama');
    expect(within(dialog).getByLabelText('Nome da pasta')).toHaveValue('gama');
    await waitFor(() => expect(within(dialog).getByLabelText('Pasta onde criar')).toHaveValue('/code'));
    await user.click(within(dialog).getByRole('button', { name: 'Clonar e continuar' }));
    expect(calls.find((c) => c.path === '/git/clone')!.body).toEqual({ origem: 'github', repo: 'renato/gama', pasta: '/code', nome: 'gama' });
    expect(await within(dialog).findByLabelText('Nome')).toHaveValue('gama');
    await user.click(within(dialog).getByRole('button', { name: 'Criar projeto' }));
    await within(dialog).findByText('gama está no OWL');
    expect(calls.find((c) => c.method === 'POST' && c.path === '/projects')!.body).toMatchObject({ nome: 'gama', pasta: '/code/gama' });
  });

  it('lets the person walk through the folders of a root to choose where the project goes', async () => {
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo projeto' });
    await user.click(within(dialog).getByRole('button', { name: /Começar vazio/ }));
    const list = await within(dialog).findByRole('list', { name: 'Pastas' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['alfa', 'beta']);
    expect(within(dialog).getByRole('button', { name: 'Subir uma pasta' })).toBeDisabled(); // already at the root
    await user.click(within(list).getByRole('button', { name: 'alfa' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Pasta onde criar')).toHaveValue('/code/alfa'));
    await user.click(await within(dialog).findByRole('button', { name: 'Subir uma pasta' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Pasta onde criar')).toHaveValue('/code'));
  });

  it('says how to log in when gh is not, and clones from a git URL with the folder name taken from it', async () => {
    ghState = { instalado: true, logado: false, usuario: null };
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo projeto' });
    await user.click(within(dialog).getByRole('button', { name: /GitHub/ }));
    expect(await within(dialog).findByText(/gh auth login/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Clonar e continuar' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: /URL git/ }));
    await user.type(within(dialog).getByLabelText('URL git'), 'https://gitlab.com/time/outro.git');
    expect(within(dialog).getByLabelText('Nome da pasta')).toHaveValue('outro');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Clonar e continuar' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Clonar e continuar' }));
    expect(calls.find((c) => c.path === '/git/clone')!.body).toEqual({ origem: 'url', url: 'https://gitlab.com/time/outro.git', pasta: '/code', nome: 'outro' });
  });

  it('starts an empty folder and, if asked, only requests the GitHub repository (a person approves it)', async () => {
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo projeto' });
    await user.click(within(dialog).getByRole('button', { name: /Começar vazio/ }));
    await user.type(within(dialog).getByLabelText('Nome da pasta'), 'gama');
    await user.click(await within(dialog).findByLabelText('Criar também no GitHub'));
    await user.selectOptions(within(dialog).getByLabelText('Visibilidade do repositório'), 'publico');
    await waitFor(() => expect(within(dialog).getByLabelText('Pasta onde criar')).toHaveValue('/code'));
    await user.click(within(dialog).getByRole('button', { name: 'Criar pasta e continuar' }));
    expect(calls.find((c) => c.path === '/git/init')!.body).toEqual({ pasta: '/code', nome: 'gama' });
    await user.click(await within(dialog).findByRole('button', { name: 'Criar projeto' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Pedi a sua aprovação para criar o repositório público no GitHub (GAM-1)');
    expect(calls.find((c) => c.path === '/projects/p3/git/publish')!.body).toEqual({ nome: 'gama', visibilidade: 'publico' });
  });

  it('keeps the form and shows the server reason when the folder is refused', async () => {
    createError = 'Folder is outside the allowed workspace roots';
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    await user.type(screen.getByLabelText(/Caminho da pasta/), '/etc');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Criar projeto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outside the allowed workspace roots');
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('closes the modal with Escape', async () => {
    const user = userEvent.setup();
    home();
    await user.click(await screen.findByRole('button', { name: /Novo projeto/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('pairing screen', () => {
  it('says this browser is paired', async () => {
    render(<PairScreen />);
    expect(await screen.findByRole('status')).toHaveTextContent('Pareado. Este navegador já pode aprovar portões.');
  });
});
