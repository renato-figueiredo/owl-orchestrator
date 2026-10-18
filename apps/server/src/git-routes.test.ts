/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API in a test */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';
import { GitError, type GitManager } from './git-manager.js';

let dir: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let git: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'owl-gitroutes-'));
  git = {
    roots: vi.fn(() => [dir]),
    dirs: vi.fn((p: string) => ({ pasta: p, pai: null, pastas: [{ nome: 'x', caminho: join(p, 'x') }] })),
    gh: vi.fn(async () => ({ instalado: true, logado: true, usuario: 'renato' })),
    repos: vi.fn(async () => [{ nomeCompleto: 'renato/a', descricao: null, privado: true, atualizadoEm: null }]),
    clone: vi.fn(async () => ({ pasta: join(dir, 'a'), nome: 'a' })),
    init: vi.fn(async () => ({ pasta: join(dir, 'b'), nome: 'b' })),
    status: vi.fn(async () => ({ repositorio: true, branch: 'main', remoto: null, alteracoes: 0, adiante: null, atras: null, branches: ['main'], ultimoCommit: 'abc init' })),
    setRemote: vi.fn(async () => ({ repositorio: true, remoto: 'https://github.com/a/b.git' })),
    assertPublishable: vi.fn(async () => undefined),
    publish: vi.fn(async () => ({ url: 'https://github.com/renato/proj.git' })),
  };
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({ repos, concurrency: 1, resolveAdapter: () => { throw new Error('no runs here'); } });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [dir], userLibraryDir: join(dir, 'lib'), worktreesDir: join(dir, 'wt'), git: git as unknown as GitManager });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as any) : undefined };
};
const project = async () => (await call('POST', '/projects', { nome: 'proj', pasta: dir })).body.project.id as string;
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('git routes', () => {
  it('reads gh, the repositories to pick from and the folders new projects may be created in', async () => {
    expect((await call('GET', '/git/gh')).body).toEqual({ instalado: true, logado: true, usuario: 'renato' });
    expect((await call('GET', '/git/repos')).body.repositorios[0].nomeCompleto).toBe('renato/a');
    expect((await call('GET', '/git/roots')).body.raizes).toEqual([dir]);
    expect((await call('GET', '/git/dirs')).body.pasta).toBe(dir); // no folder given: the first root
    expect((await call('GET', `/git/dirs?pasta=${encodeURIComponent(join(dir, 'a'))}`)).body.pastas[0].nome).toBe('x');
    git.dirs!.mockImplementationOnce(() => { throw new GitError(400, 'folder_not_allowed', 'fora'); });
    expect((await call('GET', '/git/dirs?pasta=/etc')).status).toBe(400);
  });

  it('clones and starts new folders, and turns a refusal into a 4xx with its reason', async () => {
    expect((await call('POST', '/git/clone', { origem: 'github', repo: 'renato/a', pasta: dir })).status).toBe(201);
    expect(git.clone).toHaveBeenCalledWith({ origem: 'github', repo: 'renato/a' }, dir, undefined);
    expect((await call('POST', '/git/clone', { origem: 'url', url: 'https://x.com/a.git', pasta: dir, nome: 'z' })).status).toBe(201);
    expect((await call('POST', '/git/init', { pasta: dir, nome: 'b' })).status).toBe(201);
    git.init!.mockRejectedValueOnce(new GitError(409, 'folder_exists', 'Já existe'));
    const r = await call('POST', '/git/init', { pasta: dir, nome: 'b' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('folder_exists');
    expect((await call('POST', '/git/clone', { origem: 'ftp', pasta: dir })).status).toBe(400);
  });

  it("reads a project's repository and links an existing remote", async () => {
    const pid = await project();
    expect((await call('GET', `/projects/${pid}/git`)).body).toMatchObject({ branch: 'main', branches: ['main'] });
    expect((await call('POST', `/projects/${pid}/git/remote`, { url: 'https://github.com/a/b.git' })).body.remoto).toBe('https://github.com/a/b.git');
    expect(git.setRemote).toHaveBeenCalledWith(dir, 'https://github.com/a/b.git');
    expect((await call('GET', '/projects/nao-existe/git')).status).toBe(404);
  });

  it('publishing only opens a gate: nothing is created until it is approved, then the card closes with the link', async () => {
    const pid = await project();
    const r = await call('POST', `/projects/${pid}/git/publish`, { nome: 'proj', visibilidade: 'publico', descricao: 'meu projeto' });
    expect(r.status).toBe(202);
    expect(r.body.ticket.titulo).toBe('Publicar no GitHub: proj (PÚBLICO)');
    expect(r.body.approval).toMatchObject({ tipo: 'destrutiva', status: 'pendente', retomar: { acao: 'criar_repo', repo: { nome: 'proj', visibilidade: 'publico', descricao: 'meu projeto' } } });
    expect(git.publish).not.toHaveBeenCalled();
    expect((await call('POST', `/projects/${pid}/git/publish`, { nome: 'proj' })).status).toBe(409); // one request at a time

    expect((await call('POST', `/approvals/${r.body.approval.id}/decide`, { decisao: 'aprovado' })).status).toBe(200);
    await until(() => repos.tickets.get(r.body.ticket.id)!.status === 'concluido');
    expect(git.publish).toHaveBeenCalledWith(dir, { nome: 'proj', visibilidade: 'publico', descricao: 'meu projeto' });
    expect(repos.tickets.comments(r.body.ticket.id).some((c) => c.texto.includes('https://github.com/renato/proj.git'))).toBe(true);
  });

  it('refusing publishes nothing, and a failure stays on the card instead of closing it', async () => {
    const pid = await project();
    const no = await call('POST', `/projects/${pid}/git/publish`, { nome: 'a' });
    await call('POST', `/approvals/${no.body.approval.id}/decide`, { decisao: 'rejeitado', comentario: 'não quero' });
    expect(git.publish).not.toHaveBeenCalled();
    expect(repos.tickets.get(no.body.ticket.id)!.status).toBe('concluido');

    git.publish!.mockRejectedValueOnce(new GitError(502, 'publish_failed', 'name already exists on this account'));
    const bad = await call('POST', `/projects/${pid}/git/publish`, { nome: 'b' });
    await call('POST', `/approvals/${bad.body.approval.id}/decide`, { decisao: 'aprovado' });
    await until(() => repos.tickets.comments(bad.body.ticket.id).some((c) => c.texto.includes('Não consegui publicar')));
    expect(repos.tickets.comments(bad.body.ticket.id).at(-1)!.texto).toContain('already exists');
    expect(repos.tickets.get(bad.body.ticket.id)!.status).not.toBe('concluido');
  });

  it('a project that cannot be published is refused before any gate opens', async () => {
    const pid = await project();
    git.assertPublishable!.mockRejectedValueOnce(new GitError(409, 'has_remote', 'Este projeto já tem um remoto'));
    const r = await call('POST', `/projects/${pid}/git/publish`, { nome: 'x' });
    expect(r.status).toBe(409);
    expect(repos.tickets.list(pid)).toHaveLength(0);
  });
});
