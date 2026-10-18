import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveWorkspace } from './security.js';

export interface GitShell {
  /** Runs a program with an args array (never a shell string). Resolves with the exit code and both outputs. */
  run(file: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<{ code: number; out: string; err: string }>;
}

const realShell: GitShell = {
  run: (file, args, opts = {}) =>
    new Promise((resolve) => {
      const child = execFile(
        file,
        args,
        // Never ask for a password on a terminal that is not there: fail and say so.
        { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 8 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } },
        (err, stdout, stderr) => {
          const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
          resolve({ code, out: stdout.toString(), err: stderr.toString() });
        },
      );
      child.stdin?.end();
    }),
};

export class GitError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The same fixed identity and no hooks OWL uses for its commits on ticket branches. */
const COMMIT_FLAGS = ['-c', 'user.name=OWL', '-c', 'user.email=owl@localhost', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false'];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const OWNER = /^[\w.-]+$/;
/** What a clone/remote may point at: https, ssh or scp-style, never a local path, `ext::` helpers or an option-looking string. */
const REMOTE_URL = /^(https:\/\/[^\s/@]+(?::\d+)?\/[^\s]+|ssh:\/\/[^\s@]+@[^\s]+|git@[\w.-]+:[^\s]+)$/;

export interface GhState {
  instalado: boolean;
  logado: boolean;
  usuario: string | null;
}
export interface GhRepo {
  nomeCompleto: string;
  descricao: string | null;
  privado: boolean;
  atualizadoEm: string | null;
}
export interface GitStatus {
  repositorio: boolean;
  branch: string | null;
  /** `origin` without any credentials in it. */
  remoto: string | null;
  alteracoes: number;
  adiante: number | null;
  atras: number | null;
  branches: string[];
  ultimoCommit: string | null;
}

/** Strips `user:token@` from any URL in a text before it is shown or stored. */
export const withoutCredentials = (text: string): string => text.replace(/(https?:\/\/)[^/@\s]+@/g, '$1');

/**
 * Creating, cloning and reading git repositories for projects. Every call is a `git` or `gh` process with an argument
 * array; the `gh` already logged in on this machine is used as it is (OWL never reads its token). Folders are only
 * made inside the allowed workspace roots and never on top of something that exists. Anything that leaves the machine
 * (creating the GitHub repository, push) is NOT done here on a request: it runs only once a person approves its gate.
 */
export class GitManager {
  private readonly shell: GitShell;
  private readonly gitBin: string;
  private readonly ghBin: string;

  constructor(private readonly deps: { roots: string[]; shell?: GitShell; gitBin?: string; ghBin?: string }) {
    this.shell = deps.shell ?? realShell;
    this.gitBin = deps.gitBin ?? 'git';
    this.ghBin = deps.ghBin ?? 'gh';
  }

  roots(): string[] {
    return this.deps.roots.filter((r) => existsSync(r));
  }

  /**
   * The folders a new project can be created in: `pasta` (inside a workspace root) and its visible subfolders, with the
   * way up while it stays inside a root. Reads names only; hidden folders and `node_modules` are left out.
   */
  dirs(pasta: string): { pasta: string; pai: string | null; pastas: Array<{ nome: string; caminho: string }> } {
    let real: string;
    try {
      real = resolveWorkspace(pasta, this.deps.roots);
    } catch (e) {
      throw new GitError(400, 'folder_not_allowed', e instanceof Error ? e.message : 'Pasta fora das raízes permitidas');
    }
    const inside = (dir: string) => {
      try {
        resolveWorkspace(dir, this.deps.roots);
        return true;
      } catch {
        return false;
      }
    };
    const pastas = readdirSync(real, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => ({ nome: d.name, caminho: join(real, d.name) }))
      .filter((d) => inside(d.caminho)) // a link that leaves the roots is not offered
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .slice(0, 300);
    const up = dirname(real);
    return { pasta: real, pai: up !== real && inside(up) ? up : null, pastas };
  }

  private git(cwd: string, args: string[], timeoutMs?: number) {
    return this.shell.run(this.gitBin, args, { cwd, ...(timeoutMs ? { timeoutMs } : {}) });
  }

  /** Is `gh` there and logged in (and as whom)? Reads only what `gh auth status` prints, never the token. */
  async gh(): Promise<GhState> {
    const r = await this.shell.run(this.ghBin, ['auth', 'status'], { timeoutMs: 10_000 });
    const text = `${r.out}\n${r.err}`;
    if (r.code === 1 && /ENOENT|not found/i.test(text) && !/Logged in|not logged/i.test(text)) return { instalado: false, logado: false, usuario: null };
    const user = /Logged in to \S+ account (\S+)/.exec(text)?.[1] ?? null;
    return { instalado: true, logado: r.code === 0 && user !== null, usuario: user };
  }

  async repos(owner?: string): Promise<GhRepo[]> {
    if (owner !== undefined && !OWNER.test(owner)) throw new GitError(400, 'invalid_owner', 'Dono do repositório inválido');
    const r = await this.shell.run(this.ghBin, ['repo', 'list', ...(owner ? [owner] : []), '--limit', '100', '--json', 'nameWithOwner,description,isPrivate,updatedAt'], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new GitError(502, 'gh_failed', r.err.trim().slice(0, 300) || 'O gh não conseguiu listar os repositórios (você está logado? `gh auth login`)');
    try {
      return (JSON.parse(r.out) as Array<{ nameWithOwner: string; description: string | null; isPrivate: boolean; updatedAt: string | null }>).map((x) => ({
        nomeCompleto: x.nameWithOwner,
        descricao: x.description || null,
        privado: x.isPrivate,
        atualizadoEm: x.updatedAt,
      }));
    } catch {
      throw new GitError(502, 'gh_failed', 'O gh devolveu uma resposta que não entendi');
    }
  }

  /** `parent` must be inside a workspace root; the folder is `<parent>/<nome>` and must not exist yet. */
  private destination(parent: string, nome: string): string {
    if (!NAME.test(nome)) throw new GitError(400, 'invalid_name', 'Nome da pasta: letras, números, ponto, hífen e sublinhado (até 100), sem espaços');
    let base: string;
    try {
      base = resolveWorkspace(parent, this.deps.roots);
    } catch (e) {
      throw new GitError(400, 'folder_not_allowed', e instanceof Error ? e.message : 'Pasta fora das raízes permitidas');
    }
    const dest = join(base, nome);
    if (existsSync(dest)) throw new GitError(409, 'folder_exists', `Já existe ${dest}: escolha outro nome`);
    return dest;
  }

  async clone(input: { origem: 'github'; repo: string } | { origem: 'url'; url: string }, parent: string, nome?: string): Promise<{ pasta: string; nome: string }> {
    const source = input.origem === 'github' ? input.repo : input.url;
    if (input.origem === 'github' ? !REPO.test(input.repo) : !REMOTE_URL.test(input.url)) {
      throw new GitError(400, 'invalid_source', input.origem === 'github' ? 'Repositório no formato dono/nome' : 'URL git inválida (use https://, ssh:// ou git@host:caminho)');
    }
    const name = nome ?? basename(source).replace(/\.git$/, '');
    const dest = this.destination(parent, name);
    const r =
      input.origem === 'github'
        ? await this.shell.run(this.ghBin, ['repo', 'clone', input.repo, dest, '--', '--no-recurse-submodules'], { timeoutMs: 300_000 })
        : await this.shell.run(this.gitBin, ['clone', '--no-recurse-submodules', '--', input.url, dest], { timeoutMs: 300_000 });
    if (r.code !== 0) throw new GitError(502, 'clone_failed', withoutCredentials(r.err.trim()).slice(0, 400) || 'O clone falhou');
    return { pasta: dest, nome: name };
  }

  /** A new folder with `git init` (branch `main`), a README and a first commit: nothing leaves the machine. */
  async init(parent: string, nome: string): Promise<{ pasta: string; nome: string }> {
    const dest = this.destination(parent, nome);
    mkdirSync(dest);
    const steps: string[][] = [['init', '-q', '-b', 'main'], ['add', '-A'], [...COMMIT_FLAGS, 'commit', '-q', '-m', 'Commit inicial']];
    writeFileSync(join(dest, 'README.md'), `# ${nome}\n`);
    for (const args of steps) {
      const r = await this.git(dest, args);
      if (r.code !== 0) throw new GitError(502, 'init_failed', `git ${args.find((a) => !a.startsWith('-') && a !== 'user.name=OWL') ?? ''} falhou: ${r.err.trim().slice(0, 300)}`);
    }
    return { pasta: dest, nome };
  }

  async status(pasta: string): Promise<GitStatus> {
    const root = await this.git(pasta, ['rev-parse', '--show-toplevel']);
    if (root.code !== 0) return { repositorio: false, branch: null, remoto: null, alteracoes: 0, adiante: null, atras: null, branches: [], ultimoCommit: null };
    const [branch, remote, dirty, counts, branches, last] = await Promise.all([
      this.git(pasta, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.git(pasta, ['remote', 'get-url', 'origin']),
      this.git(pasta, ['status', '--porcelain']),
      this.git(pasta, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
      this.git(pasta, ['branch', '--format=%(refname:short)']),
      this.git(pasta, ['log', '-1', '--format=%h %s']),
    ]);
    const [atras, adiante] = counts.code === 0 ? counts.out.trim().split(/\s+/).map(Number) : [null, null];
    return {
      repositorio: true,
      branch: branch.code === 0 ? branch.out.trim() : null,
      remoto: remote.code === 0 ? withoutCredentials(remote.out.trim()) : null,
      alteracoes: dirty.out.split('\n').filter(Boolean).length,
      adiante: adiante ?? null,
      atras: atras ?? null,
      branches: branches.out.split('\n').map((b) => b.trim()).filter(Boolean),
      ultimoCommit: last.code === 0 ? last.out.trim() || null : null,
    };
  }

  /** Points `origin` at a repository that already exists (a local setting only: nothing is sent). */
  async setRemote(pasta: string, url: string): Promise<GitStatus> {
    if (!REMOTE_URL.test(url)) throw new GitError(400, 'invalid_source', 'URL git inválida (use https://, ssh:// ou git@host:caminho)');
    const has = (await this.git(pasta, ['remote', 'get-url', 'origin'])).code === 0;
    const r = await this.git(pasta, ['remote', has ? 'set-url' : 'add', 'origin', url]);
    if (r.code !== 0) throw new GitError(502, 'remote_failed', r.err.trim().slice(0, 300) || 'git remote falhou');
    return this.status(pasta);
  }

  /** Can this folder be published? A repository with a commit and no `origin` yet. Throws why not. */
  async assertPublishable(pasta: string): Promise<void> {
    const s = await this.status(pasta);
    if (!s.repositorio) throw new GitError(409, 'not_a_repo', 'A pasta do projeto não é um repositório git');
    if (s.remoto) throw new GitError(409, 'has_remote', `Este projeto já tem um remoto: ${s.remoto}`);
    if (!s.ultimoCommit) throw new GitError(409, 'no_commits', 'O repositório ainda não tem nenhum commit para enviar');
  }

  /** Creates the repository on GitHub (as the account `gh` is logged in with) and pushes. Only call it after approval. */
  async publish(pasta: string, repo: { nome: string; visibilidade: 'privado' | 'publico'; descricao?: string }): Promise<{ url: string }> {
    if (!NAME.test(repo.nome)) throw new GitError(400, 'invalid_name', 'Nome de repositório inválido');
    await this.assertPublishable(pasta);
    const args = ['repo', 'create', repo.nome, repo.visibilidade === 'publico' ? '--public' : '--private', '--source', '.', '--remote', 'origin', '--push', ...(repo.descricao ? ['--description', repo.descricao.slice(0, 300)] : [])];
    const r = await this.shell.run(this.ghBin, args, { cwd: pasta, timeoutMs: 120_000 });
    if (r.code !== 0) throw new GitError(502, 'publish_failed', r.err.trim().slice(0, 400) || 'O gh não conseguiu criar o repositório');
    const url = (await this.status(pasta)).remoto ?? r.out.trim().split('\n').at(-1) ?? '';
    return { url };
  }
}
