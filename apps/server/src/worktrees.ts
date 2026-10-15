import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { childEnv } from '@owl/core';
import type { createRepos, Project, Ticket } from '@owl/db';

type Repos = ReturnType<typeof createRepos>;

export class WorktreeError extends Error {
  constructor(
    readonly status: 400 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

/**
 * Commits made by OWL on a ticket branch: a fixed identity (the user's git config is neither read for writing nor
 * changed) and no hooks, so the project's own hook scripts do not run on our behalf.
 */
const COMMIT_FLAGS = ['-c', 'user.name=OWL', '-c', 'user.email=owl@localhost', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false'];
const GIT_TIMEOUT_MS = 120_000;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

export interface BranchInfo {
  branch: string | null;
  worktree: string | null;
  estado: Ticket['worktreeEstado'];
  /** Base branch the work started from and would merge into. */
  base: string | null;
  /** Commits on the ticket branch that the base does not have. */
  commitsAdiante: number | null;
  /** The worktree has uncommitted changes. */
  alterado: boolean;
}

/**
 * One git worktree and branch per development ticket (docs/04-agents-and-board/agents-teams-board.md, "Isolamento").
 * Every git call is a `git` process with an argument array (golden rule 4). The work of a ticket never reaches the
 * project's own branch by itself: merging and discarding are separate steps that the board only runs after a person
 * approved the gate (golden rule 5). Calls are synchronous on purpose: they are short local operations and the flow
 * that needs them is synchronous too.
 */
export class WorktreeService {
  constructor(
    private readonly deps: {
      repos: Repos;
      /** Folder that holds every worktree (one subfolder per project). Created on demand. */
      dir: string;
      gitBin?: string;
      env?: NodeJS.ProcessEnv;
    },
  ) {}

  private git(cwd: string, args: string[], opts: { commit?: boolean } = {}): GitResult {
    const r = spawnSync(this.deps.gitBin ?? 'git', [...(opts.commit ? COMMIT_FLAGS : []), ...args], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...childEnv(this.deps.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' },
    });
    return { ok: r.status === 0 && !r.error, out: (r.stdout ?? '').trim(), err: (r.stderr ?? r.error?.message ?? '').trim() };
  }

  /** Top-level folder of the repository that contains `pasta`, or undefined when it is not inside one. */
  repoRoot(pasta: string): string | undefined {
    const r = this.git(pasta, ['rev-parse', '--show-toplevel']);
    return r.ok && r.out ? r.out : undefined;
  }

  isRepo(pasta: string): boolean {
    return this.repoRoot(pasta) !== undefined;
  }

  /** The branch checked out in the project folder, undefined when detached or not a repository. */
  currentBranch(pasta: string): string | undefined {
    const r = this.git(pasta, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return r.ok && r.out ? r.out : undefined;
  }

  /** Branch the ticket branches start from and merge into. */
  baseOf(project: Project): string | undefined {
    return project.branchBase ?? this.currentBranch(project.pasta);
  }

  private branchExists(root: string, branch: string): boolean {
    return this.git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  }

  private folderOf(ticket: Ticket): string {
    return join(this.deps.dir, ticket.projectId, slug(ticket.identificador) || ticket.id);
  }

  /** The folder a run of `ticket` should use inside its worktree: the project's own sub-folder, when the project is one. */
  private cwdIn(path: string, root: string, project: Project): string {
    let pasta = project.pasta;
    try {
      pasta = realpathSync(pasta); // `root` comes from git with symlinks resolved
    } catch {
      /* folder gone: fall back to the stored path */
    }
    const sub = relative(root, pasta);
    const outside = sub === '..' || sub.startsWith(`..${sep}`) || isAbsolute(sub);
    return sub && !outside ? join(path, sub) : path;
  }

  /**
   * The ticket's worktree, created (or re-created from its branch) when needed. Returns the folder agents must run in.
   * Throws `WorktreeError` with a message that says what to fix (not a repository, no base branch...).
   */
  ensure(ticket: Ticket, project: Project): string {
    const root = this.repoRoot(project.pasta);
    if (!root) {
      throw new WorktreeError(409, 'not_a_repository', 'A pasta do projeto não é um repositório git: agentes que escrevem só trabalham em um worktree. Rode "git init" (e faça um commit) na pasta.');
    }
    const path = this.folderOf(ticket);
    const current = this.repos.tickets.get(ticket.id) ?? ticket;
    const active = this.activePath(current);
    if (active) return this.cwdIn(active, root, project);

    const base = this.baseOf(project);
    if (!base) throw new WorktreeError(409, 'no_base_branch', 'O repositório está em HEAD solto: escolha a branch base do projeto.');
    if (!this.git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) {
      throw new WorktreeError(409, 'no_base_commit', `A branch base "${base}" não tem nenhum commit ainda: faça o primeiro commit.`);
    }
    if (existsSync(path)) {
      throw new WorktreeError(409, 'worktree_path_taken', `O caminho do worktree já existe e não é deste ticket: ${path}`);
    }
    this.prepareDir(ticket.projectId);

    let branch = current.branch;
    let added: GitResult;
    if (branch && this.branchExists(root, branch)) {
      added = this.git(root, ['worktree', 'add', path, branch]); // work done earlier on this ticket continues
    } else {
      branch = this.newBranchName(root, ticket);
      added = this.git(root, ['worktree', 'add', '-b', branch, path, base]);
    }
    if (!added.ok) throw new WorktreeError(409, 'worktree_failed', `Não foi possível criar o worktree: ${added.err.split('\n')[0] ?? 'erro do git'}`);
    this.repos.tickets.setWorktree(ticket.id, { branch, worktree: path, estado: 'ativo' });
    this.repos.tickets.addEvent({ ticketId: ticket.id, ator: { nome: 'sistema', tipo: 'sistema' }, tipo: 'execucao', detalhe: `Worktree criado na branch ${branch} (base: ${base})` });
    return this.cwdIn(path, root, project);
  }

  /** Creates `dir/<project>` privately; refuses a base folder that is a symlink or belongs to someone else. */
  private prepareDir(projectId: string): void {
    mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(this.deps.dir);
    if (st.isSymbolicLink() || !st.isDirectory() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
      throw new WorktreeError(409, 'worktrees_dir_unsafe', `A pasta de worktrees não é segura (symlink ou de outro usuário): ${this.deps.dir}`);
    }
    mkdirSync(join(this.deps.dir, projectId), { recursive: true, mode: 0o700 });
  }

  /**
   * True when `path` is still the worktree of `branch` of this repository: its `.git` file sits inside the area the
   * agent can edit, so before OWL commits there it checks the repository and the branch are the ones it created.
   */
  private isOurWorktree(path: string, root: string, branch: string | null): boolean {
    if (!branch?.startsWith('owl/')) return false;
    const head = this.git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!head.ok || head.out !== branch) return false;
    const common = this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const own = this.git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return common.ok && own.ok && realpathSync(common.out) === realpathSync(own.out);
  }

  private get repos(): Repos {
    return this.deps.repos;
  }

  private newBranchName(root: string, ticket: Ticket): string {
    const stem = `owl/${slug(ticket.identificador)}${slug(ticket.titulo) ? `-${slug(ticket.titulo)}` : ''}`;
    let name = stem;
    for (let n = 2; this.branchExists(root, name) || this.repos.tickets.list(ticket.projectId).some((t) => t.id !== ticket.id && t.branch === name); n++) {
      name = `${stem}-${n}`;
    }
    return name;
  }

  /** The worktree folder of a ticket if it is on disk and inside our folder (never a path someone wrote in the database). */
  private activePath(ticket: Ticket): string | undefined {
    if (!ticket.worktree || ticket.worktreeEstado !== 'ativo' || !existsSync(ticket.worktree)) return undefined;
    const real = realpathSync(ticket.worktree);
    const base = existsSync(this.deps.dir) ? realpathSync(this.deps.dir) : resolve(this.deps.dir);
    return real.startsWith(base + sep) ? real : undefined;
  }

  /** Where a read-only agent (QA, reviewer) should look: the ticket's worktree when it has one, else undefined. */
  existingCwd(ticket: Ticket, project: Project): string | undefined {
    const path = this.activePath(ticket);
    const root = path && this.repoRoot(project.pasta);
    return path && root ? this.cwdIn(path, root, project) : undefined;
  }

  /** Commits whatever the agent left in the worktree onto the ticket branch. Returns true when a commit was made. */
  commitAll(ticket: Ticket, message: string, project: Project): boolean {
    const path = this.activePath(ticket);
    if (!path) return false;
    const root = this.repoRoot(project.pasta);
    if (!root || !this.isOurWorktree(path, root, ticket.branch)) {
      throw new WorktreeError(409, 'worktree_tampered', `O worktree de ${ticket.identificador} não aponta mais para a branch ${ticket.branch ?? ''} deste repositório: nada foi commitado.`);
    }
    const add = this.git(path, ['add', '-A'], { commit: true });
    if (!add.ok) throw new WorktreeError(409, 'git_add_failed', `git add falhou: ${add.err.split('\n')[0] ?? ''}`);
    if (this.git(path, ['diff', '--cached', '--quiet']).ok) return false; // nothing staged
    const c = this.git(path, ['commit', '--no-verify', '-m', message.slice(0, 200)], { commit: true });
    if (!c.ok) throw new WorktreeError(409, 'git_commit_failed', `git commit falhou: ${c.err.split('\n')[0] ?? ''}`);
    return true;
  }

  /**
   * Work finished: commit what is pending and remove the folder. The branch STAYS (it holds the work) until a person
   * approves merging or discarding it.
   */
  release(ticket: Ticket, project: Project): void {
    const t = this.repos.tickets.get(ticket.id) ?? ticket;
    const path = this.activePath(t);
    if (!path) return;
    this.commitAll(t, `${t.identificador}: ${t.titulo}`, project);
    const root = this.repoRoot(project.pasta);
    if (!root) return;
    const rm = this.git(root, ['worktree', 'remove', '--force', path]);
    if (!rm.ok) throw new WorktreeError(409, 'worktree_remove_failed', `Não foi possível remover o worktree: ${rm.err.split('\n')[0] ?? ''}`);
    this.repos.tickets.setWorktree(t.id, { worktree: null, estado: 'removido' });
    this.repos.tickets.addEvent({ ticketId: t.id, ator: { nome: 'sistema', tipo: 'sistema' }, tipo: 'execucao', detalhe: `Worktree removido; a branch ${t.branch} guarda o trabalho` });
  }

  info(ticket: Ticket, project: Project): BranchInfo {
    const t = this.repos.tickets.get(ticket.id) ?? ticket;
    const root = this.repoRoot(project.pasta);
    const base = this.baseOf(project) ?? null;
    let commitsAdiante: number | null = null;
    if (root && t.branch && base && this.branchExists(root, t.branch)) {
      const r = this.git(root, ['rev-list', '--count', `${base}..${t.branch}`]);
      if (r.ok) commitsAdiante = Number(r.out);
    }
    const path = this.activePath(t);
    const status = path ? this.git(path, ['status', '--porcelain']) : undefined;
    const alterado = status ? !status.ok || status.out.length > 0 : false;
    return { branch: t.branch, worktree: path ?? null, estado: t.worktreeEstado, base, commitsAdiante, alterado };
  }

  /**
   * Merges the ticket branch into the base branch of the project, with a merge commit. Only called after a person
   * approved the gate. It refuses (and changes nothing) when the project folder is not on the base branch or has
   * uncommitted changes; on a conflict it aborts the merge and says so.
   */
  merge(ticket: Ticket, project: Project): { ok: true; resumo: string } | { ok: false; erro: string } {
    const t = this.repos.tickets.get(ticket.id) ?? ticket;
    const root = this.repoRoot(project.pasta);
    if (!root) return { ok: false, erro: 'A pasta do projeto não é um repositório git.' };
    if (!t.branch?.startsWith('owl/') || !this.branchExists(root, t.branch)) return { ok: false, erro: 'O ticket não tem branch para mesclar.' };
    const base = this.baseOf(project);
    if (!base) return { ok: false, erro: 'HEAD solto: defina a branch base do projeto.' };
    if (this.currentBranch(project.pasta) !== base) return { ok: false, erro: `A pasta do projeto não está na branch base "${base}"; troque de branch e aprove de novo.` };
    if (this.git(root, ['status', '--porcelain', '--untracked-files=no']).out) {
      return { ok: false, erro: 'A pasta do projeto tem alterações não commitadas; commit ou guarde antes de mesclar.' };
    }
    this.release(t, project); // pending work goes onto the branch first
    const m = this.git(root, ['merge', '--no-ff', '--no-edit', '-m', `Merge ${t.branch} (${t.identificador}: ${t.titulo})`.slice(0, 200), t.branch], { commit: true });
    if (!m.ok) {
      this.git(root, ['merge', '--abort']);
      const conflict = /conflict/i.test(m.out + m.err);
      return { ok: false, erro: conflict ? `Conflito ao mesclar ${t.branch} em ${base}; nada foi alterado. Resolva na branch e peça de novo.` : `git merge falhou: ${(m.err || m.out).split('\n')[0] ?? ''}` };
    }
    this.git(root, ['branch', '-d', t.branch]); // safe delete: refuses if it were not merged
    this.repos.tickets.setWorktree(t.id, { worktree: null, estado: 'mesclado' });
    return { ok: true, resumo: `${t.branch} mesclada em ${base}` };
  }

  /** Throws the worktree and the branch away (cancelling the ticket's work). Only called after a person approved. */
  discard(ticket: Ticket, project: Project): { ok: true; resumo: string } | { ok: false; erro: string } {
    const t = this.repos.tickets.get(ticket.id) ?? ticket;
    const root = this.repoRoot(project.pasta);
    if (!root) return { ok: false, erro: 'A pasta do projeto não é um repositório git.' };
    const path = this.activePath(t);
    if (path) {
      const rm = this.git(root, ['worktree', 'remove', '--force', path]);
      if (!rm.ok) return { ok: false, erro: `Não foi possível remover o worktree: ${rm.err.split('\n')[0] ?? ''}` };
    }
    this.git(root, ['worktree', 'prune']);
    if (t.branch && !t.branch.startsWith('owl/')) return { ok: false, erro: `Recusado: "${t.branch}" não é uma branch criada pelo OWL.` };
    if (t.branch && this.branchExists(root, t.branch)) {
      const del = this.git(root, ['branch', '-D', t.branch]);
      if (!del.ok) return { ok: false, erro: `Não foi possível apagar a branch: ${del.err.split('\n')[0] ?? ''}` };
    }
    this.repos.tickets.setWorktree(t.id, { worktree: null, estado: 'descartado' });
    return { ok: true, resumo: `Worktree e branch ${t.branch ?? ''} descartados` };
  }
}
