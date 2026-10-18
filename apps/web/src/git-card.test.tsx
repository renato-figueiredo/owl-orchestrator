// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitCard } from './components/GitCard';
import { api } from './lib/api';
import type { GitStatus } from './lib/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const repo: GitStatus = { repositorio: true, branch: 'main', remoto: null, alteracoes: 2, adiante: null, atras: null, branches: ['main', 'owl/x'], ultimoCommit: 'abc1234 Commit inicial' };

describe('GitCard', () => {
  it('reads branch, remote, pending changes and branches', async () => {
    vi.spyOn(api, 'projectGit').mockResolvedValue({ ...repo, remoto: 'https://github.com/a/b.git', adiante: 1, atras: 0 });
    render(<GitCard projectId="p" pasta="/code/meu" />);
    expect(await screen.findByText('https://github.com/a/b.git')).toBeInTheDocument();
    expect(screen.getByText(/2 alteração\(ões\) sem commit · 1 à frente, 0 atrás/)).toBeInTheDocument();
    expect(screen.getByText('owl/x')).toBeInTheDocument();
    expect(screen.queryByLabelText('URL do repositório')).toBeNull(); // already linked: nothing to link or publish
  });

  it('links an existing repository without sending anything', async () => {
    vi.spyOn(api, 'projectGit').mockResolvedValue(repo);
    vi.spyOn(api, 'ghRepos').mockResolvedValue([]);
    const link = vi.spyOn(api, 'projectGitRemote').mockResolvedValue({ ...repo, remoto: 'https://github.com/a/b.git' });
    const user = userEvent.setup();
    render(<GitCard projectId="p" pasta="/code/meu" />);
    await user.type(await screen.findByLabelText('URL do repositório'), 'https://github.com/a/b.git');
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(link).toHaveBeenCalledWith('p', 'https://github.com/a/b.git');
    expect(await screen.findByText(/Nada foi enviado/)).toBeInTheDocument();
  });

  it('publishing only requests approval, naming the repository and its visibility', async () => {
    vi.spyOn(api, 'projectGit').mockResolvedValue(repo);
    vi.spyOn(api, 'ghRepos').mockResolvedValue([]);
    const publish = vi.spyOn(api, 'projectGitPublish').mockResolvedValue({ ticket: { id: 't', identificador: 'MEU-3', titulo: 'x' }, approval: { id: 'a' } });
    const user = userEvent.setup();
    render(<GitCard projectId="p" pasta="/code/meu" />);
    expect(await screen.findByLabelText('Nome do repositório')).toHaveValue('meu');
    await user.selectOptions(screen.getByLabelText('Visibilidade'), 'publico');
    await user.click(screen.getByRole('button', { name: 'Pedir criação' }));
    expect(publish).toHaveBeenCalledWith('p', { nome: 'meu', visibilidade: 'publico' });
    expect(await screen.findByRole('status')).toHaveTextContent('Pedi a sua aprovação para criar o repositório público "meu" no GitHub (MEU-3)');
  });

  it('shows the server reason when it cannot, and what to do for a folder that is not a repository', async () => {
    vi.spyOn(api, 'projectGit').mockResolvedValue({ ...repo, repositorio: false, branch: null, ultimoCommit: null, branches: [] });
    const { unmount } = render(<GitCard projectId="p" pasta="/code/meu" />);
    expect(await screen.findByText(/ainda não é um repositório git/)).toBeInTheDocument();
    unmount();
    vi.spyOn(api, 'projectGit').mockResolvedValue(repo);
    vi.spyOn(api, 'ghRepos').mockResolvedValue([]);
    vi.spyOn(api, 'projectGitRemote').mockRejectedValue(new Error('URL git inválida'));
    const user = userEvent.setup();
    render(<GitCard projectId="p" pasta="/code/meu" />);
    await user.type(await screen.findByLabelText('URL do repositório'), 'https://github.com/a/b.git');
    await user.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('URL git inválida'));
  });
});
