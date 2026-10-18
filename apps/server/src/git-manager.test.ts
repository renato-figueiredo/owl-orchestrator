import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError, GitManager, withoutCredentials, type GitShell } from './git-manager.js';

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'owl-gitmgr-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const fake = (reply: (file: string, args: string[]) => { code?: number; out?: string; err?: string }) => {
  const run = vi.fn(async (file: string, args: string[]) => ({ code: 0, out: '', err: '', ...reply(file, args) }));
  return { run, shell: { run } as GitShell };
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof GitError ? e.code : 'other';
  }
};

describe('GitManager (real git)', () => {
  it('starts a project: folder, git init on main, README and a first commit, inside a root only', async () => {
    const git = new GitManager({ roots: [root] });
    const r = await git.init(root, 'novo-projeto');
    expect(r.pasta).toBe(join(root, 'novo-projeto'));
    expect(readFileSync(join(r.pasta, 'README.md'), 'utf8')).toBe('# novo-projeto\n');
    const s = await git.status(r.pasta);
    expect(s).toMatchObject({ repositorio: true, branch: 'main', remoto: null, alteracoes: 0, branches: ['main'] });
    expect(s.ultimoCommit).toContain('Commit inicial');
    expect(execFileSync('git', ['log', '-1', '--format=%an'], { cwd: r.pasta }).toString().trim()).toBe('OWL');
    expect(await code(git.init(root, 'novo-projeto'))).toBe('folder_exists'); // never on top of something
    expect(await code(git.init(root, '../fora'))).toBe('invalid_name');
    expect(await code(git.init(root, 'com espaço'))).toBe('invalid_name');
    expect(await code(git.init(tmpdir(), 'x'))).toBe('folder_not_allowed'); // outside the roots
  });

  it('links an existing repository as origin, never keeps credentials in what it shows, and refuses odd URLs', async () => {
    const git = new GitManager({ roots: [root] });
    const { pasta } = await git.init(root, 'p');
    const s = await git.setRemote(pasta, 'https://github.com/a/b.git');
    expect(s.remoto).toBe('https://github.com/a/b.git');
    expect((await git.setRemote(pasta, 'git@github.com:a/c.git')).remoto).toBe('git@github.com:a/c.git'); // replaces origin
    for (const bad of ['/etc/passwd', 'file:///tmp/x', '--upload-pack=evil', 'ext::sh -c id', 'http://insecure/x.git', 'https://a b/c']) expect(await code(git.setRemote(pasta, bad))).toBe('invalid_source');
    expect(withoutCredentials('https://user:tok@github.com/a/b.git')).toBe('https://github.com/a/b.git');
  });

  it('reads a folder that is not a repository without failing', async () => {
    const git = new GitManager({ roots: [root] });
    expect((await git.status(root)).repositorio).toBe(false);
  });

  it('a project is publishable only with a commit and no origin yet', async () => {
    const git = new GitManager({ roots: [root] });
    const { pasta } = await git.init(root, 'p');
    await expect(git.assertPublishable(pasta)).resolves.toBeUndefined();
    await git.setRemote(pasta, 'https://github.com/a/b.git');
    expect(await code(git.assertPublishable(pasta))).toBe('has_remote');
    expect(await code(git.assertPublishable(root))).toBe('not_a_repo');
  });
});

describe('GitManager folders', () => {
  it('lists visible subfolders inside a root with the way up, and nothing outside', () => {
    const git = new GitManager({ roots: [root] });
    for (const d of ['beta', 'alfa', '.oculta', 'node_modules', 'alfa/interna']) mkdirSync(join(root, d), { recursive: true });
    symlinkSync(tmpdir(), join(root, 'escapa')); // a link out of the root
    const top = git.dirs(root);
    expect(top.pastas.map((p) => p.nome)).toEqual(['alfa', 'beta']);
    expect(top.pai).toBeNull(); // the root's parent is outside
    const inner = git.dirs(join(root, 'alfa'));
    expect(inner.pastas.map((p) => p.nome)).toEqual(['interna']);
    expect(inner.pai).toBe(root);
    expect(() => git.dirs(tmpdir())).toThrow(GitError);
    expect(() => git.dirs(join(root, 'nao-existe'))).toThrow(GitError);
  });
});

describe('GitManager (gh and clone, with a fake shell)', () => {
  it('reads who gh is logged in as, and lists repositories', async () => {
    const { shell, run } = fake((_f, a) =>
      a[0] === 'auth' ? { err: '✓ Logged in to github.com account renato-figueiredo (keyring)\n  - Token: gho_secret' } : { out: JSON.stringify([{ nameWithOwner: 'a/b', description: '', isPrivate: true, updatedAt: '2026-10-01' }]) },
    );
    const git = new GitManager({ roots: [root], shell });
    expect(await git.gh()).toEqual({ instalado: true, logado: true, usuario: 'renato-figueiredo' });
    expect(await git.repos()).toEqual([{ nomeCompleto: 'a/b', descricao: null, privado: true, atualizadoEm: '2026-10-01' }]);
    expect(run).toHaveBeenCalledWith('gh', ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate,updatedAt'], expect.anything());
    expect(await code(git.repos('a b; rm'))).toBe('invalid_owner');
  });

  it('clones with gh or git into <root>/<name>, with an args array and the safe flags', async () => {
    const { shell, run } = fake(() => ({}));
    const git = new GitManager({ roots: [root], shell });
    expect(await git.clone({ origem: 'github', repo: 'a/meu-repo' }, root)).toEqual({ pasta: join(root, 'meu-repo'), nome: 'meu-repo' });
    expect(run).toHaveBeenLastCalledWith('gh', ['repo', 'clone', 'a/meu-repo', join(root, 'meu-repo'), '--', '--no-recurse-submodules'], expect.anything());
    await git.clone({ origem: 'url', url: 'https://gitlab.com/x/y.git' }, root, 'outro');
    expect(run).toHaveBeenLastCalledWith('git', ['clone', '--no-recurse-submodules', '--', 'https://gitlab.com/x/y.git', join(root, 'outro')], expect.anything());
  });

  it('refuses sources that are not remote repositories, and reports a failed clone without credentials', async () => {
    const { shell } = fake(() => ({ code: 128, err: "fatal: could not read from 'https://u:secret@host/x.git'" }));
    const git = new GitManager({ roots: [root], shell });
    for (const url of ['/home/renato/segredo', '-oProxyCommand=x', 'ext::sh -c id', 'file:///etc']) expect(await code(git.clone({ origem: 'url', url }, root))).toBe('invalid_source');
    expect(await code(git.clone({ origem: 'github', repo: 'sem-barra' }, root))).toBe('invalid_source');
    await expect(git.clone({ origem: 'url', url: 'https://host/x.git' }, root)).rejects.toThrow(/could not read from 'https:\/\/host\/x.git'/);
  });

  it('publishes only through gh with a fixed command line, and returns the remote', async () => {
    const real = new GitManager({ roots: [root] });
    const { pasta } = await real.init(root, 'p');
    const calls: string[][] = [];
    // git runs for real; gh is the fake, and "creating" the repository adds the origin it would have added
    const shell: GitShell = {
      async run(file, args, opts) {
        if (file === 'gh') {
          calls.push(args);
          execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/renato/p.git'], { cwd: opts?.cwd });
          return { code: 0, out: 'https://github.com/renato/p\n', err: '' };
        }
        try {
          return { code: 0, out: execFileSync(file, args, { cwd: opts?.cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString(), err: '' };
        } catch (e) {
          return { code: (e as { status?: number }).status ?? 1, out: '', err: '' };
        }
      },
    };
    const git = new GitManager({ roots: [root], shell });
    const r = await git.publish(pasta, { nome: 'p', visibilidade: 'privado', descricao: 'teste' });
    expect(r.url).toBe('https://github.com/renato/p.git');
    expect(calls[0]).toEqual(['repo', 'create', 'p', '--private', '--source', '.', '--remote', 'origin', '--push', '--description', 'teste']);
    expect(await code(git.publish(pasta, { nome: 'p', visibilidade: 'privado' }))).toBe('has_remote'); // it already has an origin now
    expect(existsSync(pasta)).toBe(true);
  });
});
