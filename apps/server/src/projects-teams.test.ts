/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API in a test */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';
import { WorktreeService } from './worktrees.js';

// Prompt 14: projects, teams, agent memory per project, git worktrees, tool limits, concurrency.

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

function makeRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'app.txt'), 'line one\nline two\nline three\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

let tmp: string[];
let wt: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let requests: RunRequest[];
/** What each developer run does in its folder: (request) → file edits. */
let onDev: (req: RunRequest) => Promise<void> | void;
let live: { now: number; max: number };

const ROLE: Array<[string, string]> = [
  ['product owner', 'po'],
  ['tech lead', 'tech-lead'],
  ['QA', 'qa'],
  ['desenvolvedor de back-end', 'dev-back'],
  ['desenvolvedor de interface', 'dev-front'],
  ['memória do projeto', 'memoria'],
];
const who = (req: RunRequest) => ROLE.find(([k]) => req.systemAppend?.includes(k))?.[1] ?? 'unknown';

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  run(req) {
    requests.push(req);
    return (async function* () {
      live.now++;
      live.max = Math.max(live.max, live.now);
      try {
        const agent = who(req);
        if (agent === 'dev-back' || agent === 'dev-front') await onDev(req);
        yield { type: 'usage', inputTokens: 10, outputTokens: 5 } as const;
        const reply =
          agent === 'qa' ? 'Cobre os critérios.\nVEREDITO: aprovado' : agent === 'memoria' ? '1. Resumo\nFeito.\n\n2. Fatos\n- Usa worktrees\n' : `Feito por ${agent}.`;
        yield { type: 'end', result: reply } as const;
      } finally {
        live.now--;
      }
    })();
  },
};

async function start(opts: { concurrency?: number; projectConcurrency?: number } = {}) {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({ repos, concurrency: opts.concurrency ?? 4, projectConcurrency: opts.projectConcurrency ?? 4, resolveAdapter: () => adapter });
  app = buildApp({ repos, executor, workspaceRoots: [tmpdir()], userLibraryDir: join(wt, 'lib'), worktreesDir: join(wt, 'trees') });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(() => {
  tmp = [];
  wt = mkdtempSync(join(tmpdir(), 'owl-p14-'));
  requests = [];
  live = { now: 0, max: 0 };
  onDev = () => undefined;
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  for (const d of [...tmp, wt]) rmSync(d, { recursive: true, force: true });
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const post = (path: string, body?: unknown) => call('POST', path, body ?? {});
const get = async <T = any>(path: string) => (await call('GET', path)).json() as Promise<T>;
const json = async (r: Response) => (await r.json()) as any;

async function mkProject(nome: string, dir = makeRepo('owl-p14-repo-')) {
  tmp.push(dir);
  const p = (await json(await post('/projects', { nome, pasta: dir }))).project;
  return { id: p.id as string, dir };
}
async function mkTicket(pid: string, titulo: string, responsavel = 'dev-back') {
  return (await json(await post(`/projects/${pid}/tickets`, { titulo, status: 'pronto', responsavel }))).ticket.id as string;
}
async function settle() {
  for (let i = 0; i < 40; i++) {
    await executor.idle();
    await new Promise((r) => setTimeout(r, 5));
    if (!hasRunning()) {
      await executor.idle();
      return;
    }
  }
}
const hasRunning = () => repos.projects.list().some((p) => repos.projects.runningRuns(p.id) > 0);

describe('memória de um agente por projeto', () => {
  it('um fato salvo pelo gerente no projeto A não aparece no projeto B', async () => {
    await start();
    const a = await mkProject('Alfa');
    const b = await mkProject('Beta');
    // The same manager (tech-lead) works in a team of each project.
    for (const [pid, nome] of [[a.id, 'Core A'], [b.id, 'Core B']] as const) {
      const team = (await json(await post(`/projects/${pid}/teams`, { nome }))).equipe;
      expect((await call('PUT', `/teams/${team.id}/members/tech-lead`, { papel: 'techlead' })).status).toBe(200);
    }
    expect((await get('/agents/tech-lead/projects')).projetos.map((p: any) => p.projeto).sort()).toEqual(['Alfa', 'Beta']);

    const saved = await post(`/projects/${a.id}/agents/tech-lead/facts`, { texto: 'No Alfa o deploy é às sextas', fixado: true });
    expect(saved.status).toBe(201);

    expect((await get(`/projects/${a.id}/agents/tech-lead/facts`)).facts.map((f: any) => f.texto)).toEqual(['No Alfa o deploy é às sextas']);
    expect((await get(`/projects/${b.id}/agents/tech-lead/facts`)).facts).toEqual([]);
    // It is the agent's memory, not the project's: the shared project facts of both projects stay empty.
    expect((await get(`/facts?projectId=${a.id}`)).facts).toEqual([]);
    expect((await get(`/facts?projectId=${b.id}`)).facts).toEqual([]);

    // And in the prompt: the manager's run in A sees it, the same manager's run in B does not.
    for (const p of [a, b]) {
      const t = await mkTicket(p.id, 'Planejar', 'tech-lead');
      await post(`/tickets/${t}/run`, { agente: 'tech-lead', tarefa: 'Planeje' });
      await settle();
    }
    const [inA, inB] = requests.filter((r) => who(r) === 'tech-lead');
    expect(inA!.prompt).toContain('No Alfa o deploy é às sextas');
    expect(inB!.prompt).not.toContain('No Alfa o deploy é às sextas');
  });
});

describe('equipes', () => {
  it('com equipe montada só os membros trabalham nos tickets do projeto', async () => {
    await start();
    const p = await mkProject('Alfa');
    const team = (await json(await post(`/projects/${p.id}/teams`, { nome: 'Core' }))).equipe;
    await call('PUT', `/teams/${team.id}/members/tech-lead`, { papel: 'techlead' });
    const t = await mkTicket(p.id, 'Algo');

    await post(`/tickets/${t}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests).toHaveLength(0);
    expect(repos.tickets.get(t)!.status).toBe('bloqueado');
    expect(repos.tickets.comments(t).at(-1)!.texto).toMatch(/não está em nenhuma equipe/);

    await call('PUT', `/teams/${team.id}/members/dev-back`, { papel: 'dev' });
    await post(`/tickets/${t}/status`, { status: 'pronto' });
    await post(`/tickets/${t}/run`, { agente: 'dev-back' });
    await settle();
    expect(requests.map(who)).toContain('dev-back');
  });

  it('CRUD: nome único por projeto, papel editável, remoção, projetos diferentes aceitam o mesmo nome', async () => {
    await start();
    const a = await mkProject('Alfa');
    const b = await mkProject('Beta');
    const t1 = (await json(await post(`/projects/${a.id}/teams`, { nome: 'Core' }))).equipe;
    expect((await post(`/projects/${a.id}/teams`, { nome: 'core' })).status).toBe(409);
    expect((await post(`/projects/${b.id}/teams`, { nome: 'Core' })).status).toBe(201);
    expect((await call('PATCH', `/teams/${t1.id}`, { nome: 'Plataforma' })).status).toBe(200);

    await call('PUT', `/teams/${t1.id}/members/qa`, { papel: 'qa' });
    const changed = await json(await call('PUT', `/teams/${t1.id}/members/qa`, { papel: 'revisor' }));
    expect(changed.equipe.membros.map((m: any) => [m.agente, m.papel])).toEqual([['qa', 'revisor']]);
    expect((await call('PUT', `/teams/${t1.id}/members/nao-existe`, {})).status).toBe(400);
    expect((await call('DELETE', `/teams/${t1.id}/members/qa`)).status).toBe(200);
    expect((await call('DELETE', `/teams/${t1.id}/members/qa`)).status).toBe(404);
    expect((await call('DELETE', `/teams/${t1.id}`)).status).toBe(200);
    expect((await get(`/projects/${a.id}/teams`)).equipes).toEqual([]);
  });
});

describe('worktrees', () => {
  it('no startup: prune de registros sem pasta e limpeza de pastas órfãs, sem perder trabalho pendente', async () => {
    await start();
    const p = await mkProject('Alfa');
    const svc = new WorktreeService({ repos, dir: join(wt, 'trees') });
    const project = repos.projects.get(p.id)!;
    const mk = async (titulo: string) => {
      const id = await mkTicket(p.id, titulo);
      svc.ensure(repos.tickets.get(id)!, project);
      return repos.tickets.get(id)!;
    };
    const kept = await mk('Ativo');
    const orphan = await mk('Órfão');
    const gone = await mk('Sumiu');
    const stray = join(wt, 'trees', p.id, 'desconhecida');
    writeFileSync(join(kept.worktree!, 'k.txt'), 'k');
    writeFileSync(join(orphan.worktree!, 'pendente.txt'), 'trabalho pendente\n');
    repos.tickets.setWorktree(orphan.id, { worktree: null, estado: 'removido' }); // the record lost track of the folder
    rmSync(gone.worktree!, { recursive: true, force: true }); // folder removed behind git's back
    execFileSync('git', ['worktree', 'add', '-q', '--detach', stray], { cwd: p.dir });
    writeFileSync(join(stray, 'meu.txt'), 'não é do OWL'); // unknown folder with changes

    const r = svc.reconcile();
    expect(existsSync(kept.worktree!)).toBe(true);
    expect(existsSync(join(kept.worktree!, 'k.txt'))).toBe(true);
    expect(existsSync(orphan.worktree!)).toBe(false);
    expect(git(p.dir, 'show', `${orphan.branch}:pendente.txt`)).toBe('trabalho pendente');
    expect(existsSync(join(stray, 'meu.txt'))).toBe(true);
    expect(r.removed).toHaveLength(1);
    const listed = git(p.dir, 'worktree', 'list', '--porcelain');
    expect(listed).not.toContain(gone.worktree!);
    expect(listed).not.toContain(orphan.worktree!);
    expect(listed).toContain(kept.worktree!);
  });

  it('dois tickets em paralelo trabalham em worktrees distintos sem conflitar nos arquivos', async () => {
    await start({ concurrency: 2, projectConcurrency: 2 });
    const p = await mkProject('Alfa');
    // Both developers must be inside their run at the same time, writing the SAME file name.
    let arrived = 0;
    let release!: () => void;
    const together = new Promise<void>((r) => (release = r));
    const cwds: string[] = [];
    onDev = async (req) => {
      cwds.push(req.cwd);
      writeFileSync(join(req.cwd, 'shared.txt'), `escrito em ${req.cwd}\n`);
      if (++arrived === 2) release();
      await together;
    };
    const t1 = await mkTicket(p.id, 'Primeiro');
    const t2 = await mkTicket(p.id, 'Segundo', 'dev-front');
    await Promise.all([post(`/tickets/${t1}/run`, {}), post(`/tickets/${t2}/run`, {})]);
    await settle();

    expect(new Set(cwds).size).toBe(2);
    expect(cwds.every((c) => !c.startsWith(p.dir))).toBe(true); // never in the user's own folder
    expect(existsSync(join(p.dir, 'shared.txt'))).toBe(false);
    const [a, b] = [repos.tickets.get(t1)!, repos.tickets.get(t2)!];
    expect(a.branch).not.toBe(b.branch);
    expect(git(p.dir, 'show', `${a.branch}:shared.txt`)).toContain(cwds[0]);
    expect(git(p.dir, 'show', `${b.branch}:shared.txt`)).toContain(cwds[1]);
    expect(git(p.dir, 'branch', '--show-current')).toBe('main');
  });

  it('ao concluir o worktree some e a branch guarda o trabalho; nada chega na branch base sem aprovação', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'feature.txt'), 'nova função\n');
    const t = await mkTicket(p.id, 'Função');
    await post(`/tickets/${t}/run`, {});
    await settle();

    const done = repos.tickets.get(t)!;
    expect(done.status).toBe('concluido');
    expect(done.worktree).toBeNull();
    expect(done.worktreeEstado).toBe('removido');
    expect(existsSync(join(wt, 'trees', p.id, done.identificador.toLowerCase()))).toBe(false);
    expect(git(p.dir, 'show', `${done.branch}:feature.txt`)).toBe('nova função');
    expect(existsSync(join(p.dir, 'feature.txt'))).toBe(false); // not merged

    // Asking to merge only opens a gate.
    const req = await post(`/tickets/${t}/branch/merge`);
    expect(req.status).toBe(202);
    const gate = (await json(req)).aprovacoes[0];
    expect(gate).toMatchObject({ tipo: 'destrutiva', status: 'pendente' });
    expect(existsSync(join(p.dir, 'feature.txt'))).toBe(false);
    expect(repos.tickets.get(t)!.status).toBe('concluido'); // the ticket does not move for a branch gate

    // Rejecting: still not merged and the finished ticket is NOT reopened.
    await post(`/approvals/${gate.id}/decide`, { decisao: 'rejeitado', comentario: 'ainda não' });
    expect(existsSync(join(p.dir, 'feature.txt'))).toBe(false);
    expect(repos.tickets.get(t)!.status).toBe('concluido');

    // Approving merges, with a merge commit, and drops the merged branch.
    const gate2 = (await json(await post(`/tickets/${t}/branch/merge`))).aprovacoes[0];
    await post(`/approvals/${gate2.id}/decide`, { decisao: 'aprovado' });
    expect(readFileSync(join(p.dir, 'feature.txt'), 'utf8')).toBe('nova função\n');
    expect(git(p.dir, 'log', '--merges', '--format=%s', '-1')).toContain(done.branch!);
    expect(git(p.dir, 'branch', '--list', done.branch!)).toBe('');
    expect(repos.tickets.get(t)!.worktreeEstado).toBe('mesclado');
    expect(repos.tickets.get(t)!.status).toBe('concluido');
  });

  it('pedir mesclagem abre um ticket que segura os tickets em andamento até a decisão, e fecha sozinho', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'feature.txt'), 'nova função\n');
    const t = await mkTicket(p.id, 'Função');
    await post(`/tickets/${t}/run`, {});
    await settle();
    // another ticket is mid-work on its own branch; a third is only waiting in the backlog
    const busy = await mkTicket(p.id, 'Em andamento');
    repos.tickets.setWorktree(busy, { branch: 'owl/busy', worktree: '/tmp/busy', estado: 'ativo' });
    repos.tickets.setStatus(busy, 'em_andamento');
    const waiting = await mkTicket(p.id, 'Esperando');

    const gate = (await json(await post(`/tickets/${t}/branch/merge`))).aprovacoes[0];
    const tracker = repos.tickets.list(p.id).find((x) => x.titulo.startsWith('Mesclar '))!;
    expect(tracker.status).toBe('bloqueado');
    expect(gate.retomar.acompanha).toBe(tracker.id);
    const held = (id: string) => repos.quadro.relations.openBlockers(id).map((b) => b.id);
    expect(held(busy)).toEqual([tracker.id]);
    expect(held(waiting)).toEqual([]); // not in progress: free (the monitor just does not start it meanwhile)
    expect(held(t)).toEqual([]); // the merged ticket itself is not held

    await post(`/approvals/${gate.id}/decide`, { decisao: 'rejeitado', comentario: 'ainda não' });
    expect(repos.tickets.get(tracker.id)!.status).toBe('concluido');
    expect(held(busy)).toEqual([]);
  });

  it('descartar apaga worktree e branch, só depois de aprovado', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'lixo.txt'), 'x\n');
    const t = await mkTicket(p.id, 'Experimento');
    await post(`/tickets/${t}/run`, {});
    await settle();
    const branch = repos.tickets.get(t)!.branch!;

    const gate = (await json(await post(`/tickets/${t}/branch/descartar`))).aprovacoes[0];
    expect(git(p.dir, 'branch', '--list', branch)).toContain(branch);
    await post(`/approvals/${gate.id}/decide`, { decisao: 'aprovado' });
    expect(git(p.dir, 'branch', '--list', branch)).toBe('');
    expect(repos.tickets.get(t)!.worktreeEstado).toBe('descartado');
    expect((await post(`/tickets/${t}/branch/merge`)).status).toBe(409); // nothing left to merge
  });

  it('rejeitar o descarte mantém worktree/branch e nenhuma rota mescla sem passar pelo portão', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'keep.txt'), 'x\n');
    const t = await mkTicket(p.id, 'Manter');
    await post(`/tickets/${t}/run`, {});
    await settle();
    const branch = repos.tickets.get(t)!.branch!;
    const gate = (await json(await post(`/tickets/${t}/branch/descartar`))).aprovacoes[0];
    const statusBefore = repos.tickets.get(t)!.status;
    expect((await post(`/approvals/${gate.id}/decide`, { decisao: 'rejeitado' })).status).toBe(400); // a rejection needs a comment
    expect(repos.approvals.get(gate.id)!.status).toBe('pendente');
    const rejected = await post(`/approvals/${gate.id}/decide`, { decisao: 'rejeitado', comentario: 'ainda não' });
    expect(rejected.status).toBe(200);
    expect(repos.approvals.get(gate.id)!.status).toBe('rejeitado');
    expect(git(p.dir, 'branch', '--list', branch)).toContain(branch);
    // 'removido' because the worktree was released when the ticket settled, not because of the rejection
    expect(repos.tickets.get(t)!.worktreeEstado).toBe('removido');
    expect(repos.tickets.get(t)!.status).toBe(statusBefore); // rejecting a branch action does not reopen the ticket
    expect((await call('POST', `/tickets/${t}/merge`)).status).toBe(404); // there is no direct merge route
    expect(git(p.dir, 'branch', '--merged')).not.toContain(branch);
    expect(git(p.dir, 'ls-files')).not.toContain('keep.txt');
    expect(existsSync(join(p.dir, 'keep.txt'))).toBe(false);
  });

  it('não commita quando o .git do worktree foi reescrito para outro repositório', async () => {
    await start();
    const p = await mkProject('Alfa');
    const other = makeRepo('owl-p14-other-');
    tmp.push(other);
    const before = git(other, 'rev-list', '--count', 'HEAD');
    onDev = (req) => {
      writeFileSync(join(req.cwd, 'x.txt'), 'x\n');
      writeFileSync(join(req.cwd, '.git'), `gitdir: ${join(other, '.git')}\n`);
    };
    const t = await mkTicket(p.id, 'Adulterado');
    await post(`/tickets/${t}/run`, {});
    await settle();
    expect(git(other, 'rev-list', '--count', 'HEAD')).toBe(before);
    expect(git(p.dir, 'log', '--oneline')).not.toMatch(/Adulterado/);
    expect(repos.tickets.comments(t).map((c) => c.texto).join('\n')).toMatch(/nada foi commitado/);
  });

  it('conflito na mesclagem: aborta, nada fica pela metade e o motivo vai para o ticket', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'app.txt'), `line one\nvia ${who(req)}\nline three\n`);
    const t1 = await mkTicket(p.id, 'Um');
    await post(`/tickets/${t1}/run`, {});
    await settle();
    const t2 = await mkTicket(p.id, 'Dois', 'dev-front');
    await post(`/tickets/${t2}/run`, {});
    await settle();

    for (const [t, ok] of [[t1, true], [t2, false]] as const) {
      const gate = (await json(await post(`/tickets/${t}/branch/merge`))).aprovacoes[0];
      await post(`/approvals/${gate.id}/decide`, { decisao: 'aprovado' });
      expect(repos.tickets.get(t)!.worktreeEstado).toBe(ok ? 'mesclado' : 'removido');
    }
    expect(repos.tickets.comments(t2).at(-1)!.texto).toMatch(/Conflito/);
    expect(git(p.dir, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(p.dir, 'app.txt'), 'utf8')).toContain('via dev-back');
  });

  it('recusa mesclar com a pasta do projeto suja ou fora da branch base', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'f.txt'), 'f\n');
    const t = await mkTicket(p.id, 'F');
    await post(`/tickets/${t}/run`, {});
    await settle();

    writeFileSync(join(p.dir, 'app.txt'), 'edição do usuário\n');
    let gate = (await json(await post(`/tickets/${t}/branch/merge`))).aprovacoes[0];
    await post(`/approvals/${gate.id}/decide`, { decisao: 'aprovado' });
    expect(repos.tickets.comments(t).at(-1)!.texto).toMatch(/não commitadas/);
    expect(readFileSync(join(p.dir, 'app.txt'), 'utf8')).toBe('edição do usuário\n'); // the user's edit is untouched
    git(p.dir, 'checkout', '-q', '--', 'app.txt');

    git(p.dir, 'checkout', '-q', '-b', 'outra');
    await call('PATCH', `/projects/${p.id}`, { branchBase: 'main' });
    gate = (await json(await post(`/tickets/${t}/branch/merge`))).aprovacoes.at(-1);
    await post(`/approvals/${gate.id}/decide`, { decisao: 'aprovado' });
    expect(repos.tickets.comments(t).at(-1)!.texto).toMatch(/não está na branch base "main"/);
    expect(existsSync(join(p.dir, 'f.txt'))).toBe(false);
  });

  it('agente que escreve numa pasta que não é repositório git falha com a instrução, sem escrever nada', async () => {
    await start();
    const dir = mkdtempSync(join(tmpdir(), 'owl-p14-plain-'));
    const p = await mkProject('Sem git', dir);
    const t = await mkTicket(p.id, 'Algo');
    await post(`/tickets/${t}/run`, {});
    await settle();
    expect(requests).toHaveLength(0);
    expect(repos.tickets.get(t)!.status).toBe('bloqueado');
    expect(repos.tickets.comments(t).at(-1)!.texto).toMatch(/não é um repositório git/);
  });

  it('QA lê o código onde o desenvolvedor o deixou (o worktree do ticket), não na pasta do usuário', async () => {
    await start();
    const p = await mkProject('Alfa');
    onDev = (req) => writeFileSync(join(req.cwd, 'x.txt'), 'x\n');
    const t = await mkTicket(p.id, 'X');
    await post(`/tickets/${t}/run`, {});
    await settle();
    const [dev, qa] = [requests.find((r) => who(r) === 'dev-back')!, requests.find((r) => who(r) === 'qa')!];
    expect(qa.cwd).toBe(dev.cwd);
    expect(requests.find((r) => who(r) === 'memoria')!.cwd).toBe(p.dir);
  });
});

describe('ferramentas por agente', () => {
  it('o agente de exemplo roda com --allowedTools escopado (nada de Bash solto)', async () => {
    await start();
    const p = await mkProject('Alfa');
    const t = await mkTicket(p.id, 'T');
    await post(`/tickets/${t}/run`, {});
    await settle();
    const tools = requests.find((r) => who(r) === 'dev-back')!.allowedTools!;
    expect(tools).toContain('Edit');
    expect(tools).toContain('Bash(pnpm test:*)');
    expect(tools).not.toContain('Bash');
  });

  it('a biblioteca recusa agente com Bash solto, comando destrutivo ou escrita em Codex', async () => {
    await start();
    const file = (ferramentas: string, provedor = 'claude-cli') => `---\nnome: x\nprovedor: ${provedor}\nferramentas: ${ferramentas}\n---\nVocê é x.\n`;
    const put = async (text: string) => call('PUT', '/agents/x', { texto: text });
    expect((await put(file('[Read, Edit, "Bash(pnpm test:*)"]'))).status).toBe(200);
    expect((await put(file('[Bash]'))).status).toBe(400);
    expect((await put(file('["Bash(rm -rf:*)"]'))).status).toBe(400);
    expect((await put(file('["Bash(git push:*)"]'))).status).toBe(400);
    expect((await put(file('["Bash(pnpm install:*)"]'))).status).toBe(400);
    expect((await put(file('["Bash(pnpm test:* && rm x)"]'))).status).toBe(400);
    expect((await put(file('[WebFetch]'))).status).toBe(400);
    const codex = await put(file('[Edit]', 'codex-cli'));
    expect(codex.status).toBe(400);
    expect((await json(codex)).error.message).toMatch(/Codex/);
  });
});

describe('concorrência', () => {
  it('o limite do projeto vale mesmo com o global folgado; outro projeto segue em paralelo', async () => {
    await start({ concurrency: 6, projectConcurrency: 6 });
    const a = await mkProject('Alfa');
    const b = await mkProject('Beta');
    expect((await call('PATCH', `/projects/${a.id}`, { maxConcorrencia: 1 })).status).toBe(200);
    expect((await call('PATCH', `/projects/${a.id}`, { maxConcorrencia: 0 })).status).toBe(400);

    const per: Record<string, { now: number; max: number }> = {};
    onDev = async (req) => {
      const k = req.cwd.includes(a.id) ? 'a' : 'b';
      const s = (per[k] ??= { now: 0, max: 0 });
      s.now++;
      s.max = Math.max(s.max, s.now);
      await new Promise((r) => setTimeout(r, 40));
      s.now--;
    };
    const ta = await Promise.all([mkTicket(a.id, 'A1'), mkTicket(a.id, 'A2'), mkTicket(a.id, 'A3')]);
    const tb = await Promise.all([mkTicket(b.id, 'B1'), mkTicket(b.id, 'B2')]);
    await Promise.all([...ta, ...tb].map((t) => post(`/tickets/${t}/run`, {})));
    await settle();

    expect(per.a!.max).toBe(1);
    expect(per.b!.max).toBe(2);
    expect(ta.every((t) => repos.tickets.get(t)!.status === 'concluido')).toBe(true);
  });

  it('o padrão do servidor vale para o projeto sem limite próprio, e o global limita todos', async () => {
    await start({ concurrency: 1, projectConcurrency: 3 });
    const p = await mkProject('Alfa');
    onDev = async () => {
      await new Promise((r) => setTimeout(r, 30));
    };
    const ts = await Promise.all([mkTicket(p.id, 'A'), mkTicket(p.id, 'B')]);
    await Promise.all(ts.map((t) => post(`/tickets/${t}/run`, {})));
    await settle();
    expect(live.max).toBe(1);
  });
});

describe('projetos', () => {
  it('edita nome, branch base e instruções; mostra git, equipes e concorrência', async () => {
    await start();
    const p = await mkProject('Alfa');
    const r = await json(await call('PATCH', `/projects/${p.id}`, { nome: 'Alfa 2', instrucoes: 'Responda em português', maxConcorrencia: 3 }));
    expect(r.project).toMatchObject({ nome: 'Alfa 2', maxConcorrencia: 3 });
    const view = await get(`/projects/${p.id}`);
    expect(view).toMatchObject({ git: true, branchAtual: 'main', instrucoes: 'Responda em português', concorrencia: { projeto: 3, padraoDoServidor: 2 } });
    await call('PATCH', `/projects/${p.id}`, { instrucoes: null, maxConcorrencia: null });
    expect((await get(`/projects/${p.id}`)).concorrencia.projeto).toBe(2);
    expect((await call('PATCH', `/projects/${p.id}`, { pasta: '/nao/existe' })).status).toBe(400);
    expect((await call('PATCH', `/projects/${p.id}`, { branchBase: '--evil' })).status).toBe(400);
  });

  it('apagar exige o nome, não mexe nos arquivos e recusa com worktree aberto', async () => {
    await start();
    const p = await mkProject('Alfa');
    expect((await call('DELETE', `/projects/${p.id}`, { confirmar: 'outro' })).status).toBe(400);
    // An open worktree blocks it.
    const t = await mkTicket(p.id, 'Aberto');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    onDev = () => gate;
    await post(`/tickets/${t}/run`, {});
    await new Promise((r) => setTimeout(r, 30));
    expect((await call('DELETE', `/projects/${p.id}`, { confirmar: 'Alfa' })).status).toBe(409);
    release();
    await settle();
    // The worktree is gone but the branch still holds unmerged work: deleting would orphan it.
    const blocked = await call('DELETE', `/projects/${p.id}`, { confirmar: 'Alfa' });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(await json(blocked))).toMatch(/branches_pending/);
    const discard = (await json(await post(`/tickets/${t}/branch/descartar`))).aprovacoes[0];
    await post(`/approvals/${discard.id}/decide`, { decisao: 'aprovado' });
    // Nothing pending any more: deleting is allowed, files stay.
    expect((await call('DELETE', `/projects/${p.id}`, { confirmar: 'Alfa' })).status).toBe(200);
    expect(existsSync(join(p.dir, 'app.txt'))).toBe(true);
    expect((await get('/projects')).projects).toEqual([]);
  });
});
