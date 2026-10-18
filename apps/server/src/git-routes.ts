import { BoardError } from '@owl/board';
import type { createRepos } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BoardFlow } from './board-flow.js';
import { GitError, type GitManager } from './git-manager.js';

type Repos = ReturnType<typeof createRepos>;

const id = z.object({ id: z.string().min(1).max(100) });
const where = z.object({ pasta: z.string().min(1).max(1000), nome: z.string().min(1).max(100).optional() });
const cloneBody = z.discriminatedUnion('origem', [
  where.extend({ origem: z.literal('github'), repo: z.string().min(3).max(200) }),
  where.extend({ origem: z.literal('url'), url: z.string().min(8).max(500) }),
]);
const initBody = z.object({ pasta: z.string().min(1).max(1000), nome: z.string().min(1).max(100) });
const publishBody = z.object({ nome: z.string().min(1).max(100), visibilidade: z.enum(['privado', 'publico']).default('privado'), descricao: z.string().trim().max(300).optional() });

/**
 * The git manager's API: which GitHub account `gh` is on, the repositories to pick from, creating or cloning into a
 * workspace root (for new projects), reading and linking a project's repository, and asking to publish it (which only
 * opens the gate: nothing is created on GitHub until a person approves).
 */
export function registerGitRoutes(app: FastifyInstance, deps: { repos: Repos; flow: BoardFlow; git: GitManager }): void {
  const { repos, flow, git } = deps;
  const project = (pid: string) => {
    const p = repos.projects.get(pid);
    if (!p) throw new BoardError(404, 'project_not_found', `Project not found: ${pid}`);
    return p;
  };
  // A GitError becomes the same error body the board uses.
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof GitError) throw new BoardError(e.status === 502 ? 409 : e.status, e.code, e.message);
      throw e;
    }
  };

  app.get('/git/gh', async () => git.gh());
  app.get('/git/roots', async () => ({ raizes: git.roots() }));
  app.get('/git/dirs', async (req) => {
    const { pasta } = z.object({ pasta: z.string().min(1).max(1000).optional() }).parse(req.query);
    const start = pasta ?? git.roots()[0];
    if (!start) throw new BoardError(400, 'no_roots', 'Nenhuma raiz de trabalho existe (OWL_WORKSPACE_ROOTS)');
    return guard(async () => git.dirs(start));
  });
  app.get('/git/repos', async (req) => {
    const { owner } = z.object({ owner: z.string().max(100).optional() }).parse(req.query);
    return guard(async () => ({ repositorios: await git.repos(owner) }));
  });
  app.post('/git/clone', async (req, reply) => {
    const b = cloneBody.parse(req.body);
    const r = await guard(() => git.clone(b.origem === 'github' ? { origem: 'github', repo: b.repo } : { origem: 'url', url: b.url }, b.pasta, b.nome));
    return reply.status(201).send(r);
  });
  app.post('/git/init', async (req, reply) => {
    const b = initBody.parse(req.body);
    return reply.status(201).send(await guard(() => git.init(b.pasta, b.nome)));
  });

  app.get('/projects/:id/git', async (req) => guard(() => git.status(project(id.parse(req.params).id).pasta)));
  app.post('/projects/:id/git/remote', async (req) => {
    const { id: pid } = id.parse(req.params);
    const { url } = z.object({ url: z.string().min(8).max(500) }).parse(req.body);
    return guard(() => git.setRemote(project(pid).pasta, url));
  });
  app.post('/projects/:id/git/publish', async (req, reply) => {
    const { id: pid } = id.parse(req.params);
    const b = publishBody.parse(req.body);
    await guard(() => git.assertPublishable(project(pid).pasta));
    const r = flow.requestPublish(pid, { nome: b.nome, visibilidade: b.visibilidade, ...(b.descricao ? { descricao: b.descricao } : {}) });
    return reply.status(202).send(r);
  });
}
