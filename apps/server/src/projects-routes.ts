import { BoardError } from '@owl/board';
import { isSafeName } from '@owl/core';
import type { createRepos, Project } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorktreeService } from './worktrees.js';

type Repos = ReturnType<typeof createRepos>;

const id = z.object({ id: z.string().min(1).max(100) });
const agentName = z.string().refine(isSafeName, 'invalid agent name').max(64);
const branchName = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/, 'invalid branch name').refine((b) => !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock'), 'invalid branch name');
const teamName = z.string().trim().min(1).max(100);
const role = z.string().trim().min(1).max(50);

const patchProject = z.object({
  nome: z.string().trim().min(1).max(200).optional(),
  pasta: z.string().min(1).max(4096).optional(),
  instrucoes: z.string().max(50_000).nullable().optional(),
  maxConcorrencia: z.number().int().min(1).max(16).nullable().optional(),
  branchBase: branchName.nullable().optional(),
});
const deleteProject = z.object({ confirmar: z.string() });
const newTeam = z.object({ nome: teamName });
const member = z.object({ papel: role.nullable().optional() });
const agentFact = z.object({ texto: z.string().trim().min(1).max(500), fixado: z.boolean().default(false) });

/** Projects (settings, deletion), their teams and the agents' memory inside a project (prompt 14). */
export function registerProjectRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repos;
    worktrees: WorktreeService;
    /** Validates a folder against the allowed workspace roots; throws an HTTP error when it is not allowed. */
    folder: (dir: string) => string;
    /** Server default for runs of one project at once. */
    projectConcurrency: number;
    globalConcurrency: number;
  },
): void {
  const { repos, worktrees, folder } = deps;
  const project = (pid: string): Project => {
    const p = repos.projects.get(pid);
    if (!p) throw new BoardError(404, 'project_not_found', `Project not found: ${pid}`);
    return p;
  };
  const team = (tid: string) => {
    const t = repos.teams.get(tid);
    if (!t) throw new BoardError(404, 'team_not_found', `Team not found: ${tid}`);
    return t;
  };
  const agent = (nome: string) => {
    const a = repos.agents.byName(nome);
    if (!a) throw new BoardError(400, 'unknown_agent', `Agent not found in the library: ${nome}`);
    return a;
  };
  const instructionsOf = (p: Project): string | null => {
    try {
      const v = p.configJson ? (JSON.parse(p.configJson) as { instrucoes?: unknown }).instrucoes : undefined;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  };

  app.get('/projects/:id', async (req) => {
    const p = project(id.parse(req.params).id);
    return {
      project: p,
      instrucoes: instructionsOf(p),
      git: worktrees.isRepo(p.pasta),
      branchAtual: worktrees.currentBranch(p.pasta) ?? null,
      branchBase: worktrees.baseOf(p) ?? null,
      concorrencia: {
        projeto: p.maxConcorrencia ?? deps.projectConcurrency,
        padraoDoServidor: deps.projectConcurrency,
        global: deps.globalConcurrency,
        emExecucao: repos.projects.runningRuns(p.id),
      },
      equipes: repos.teams.byProject(p.id),
    };
  });

  app.patch('/projects/:id', async (req) => {
    const { id: pid } = id.parse(req.params);
    const body = patchProject.parse(req.body);
    const p = project(pid);
    if (body.pasta !== undefined && body.pasta !== p.pasta && repos.tickets.withWorktree(pid).length > 0) {
      throw new BoardError(409, 'worktrees_open', 'Há tickets com worktree aberto: conclua ou descarte antes de trocar a pasta do projeto');
    }
    let config: unknown;
    if (body.instrucoes !== undefined) {
      let current: Record<string, unknown> = {};
      try {
        if (p.configJson) current = JSON.parse(p.configJson) as Record<string, unknown>;
      } catch {
        /* a corrupted config is replaced by the new instructions instead of failing the request */
      }
      if (body.instrucoes === null || !body.instrucoes.trim()) delete current.instrucoes;
      else current.instrucoes = body.instrucoes;
      config = Object.keys(current).length ? current : null;
    }
    const updated = repos.projects.update(pid, {
      ...(body.nome !== undefined ? { nome: body.nome } : {}),
      ...(body.pasta !== undefined ? { pasta: folder(body.pasta) } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(body.maxConcorrencia !== undefined ? { maxConcorrencia: body.maxConcorrencia } : {}),
      ...(body.branchBase !== undefined ? { branchBase: body.branchBase } : {}),
    });
    return { project: updated };
  });

  /**
   * Removes the project from OWL (conversations, tickets, teams, memory). Files on disk are never touched. The person
   * confirms by typing the project's name; it is refused while anything is running or a worktree is still open.
   */
  app.delete('/projects/:id', async (req) => {
    const { id: pid } = id.parse(req.params);
    const body = deleteProject.parse(req.body ?? {});
    const p = project(pid);
    if (body.confirmar !== p.nome) throw new BoardError(400, 'confirmation_mismatch', 'Digite o nome do projeto para confirmar');
    if (repos.projects.runningRuns(pid) > 0) throw new BoardError(409, 'project_busy', 'O projeto tem execuções em andamento: cancele antes');
    if (repos.tickets.withWorktree(pid).length > 0) throw new BoardError(409, 'worktrees_open', 'O projeto tem worktrees abertos: conclua ou descarte os tickets antes');
    const pending = repos.tickets.list(pid).filter((t) => t.worktreeEstado === 'removido' && t.branch);
    if (pending.length > 0) {
      throw new BoardError(409, 'branches_pending', `Há ${pending.length} branch(es) owl/* com trabalho ainda não mesclado nem descartado (${pending.map((t) => t.identificador).join(', ')}): mescle ou descarte antes`);
    }
    repos.projects.delete(pid);
    return { status: 'deleted' };
  });

  // ---- teams ----------------------------------------------------------------------------------------------------

  app.get('/projects/:id/teams', async (req) => {
    const p = project(id.parse(req.params).id);
    return { equipes: repos.teams.byProject(p.id) };
  });

  app.post('/projects/:id/teams', async (req, reply) => {
    const p = project(id.parse(req.params).id);
    const body = newTeam.parse(req.body);
    if (repos.teams.byProject(p.id).some((t) => t.nome.toLowerCase() === body.nome.toLowerCase())) {
      throw new BoardError(409, 'team_exists', `Já existe uma equipe "${body.nome}" neste projeto`);
    }
    return reply.status(201).send({ equipe: { ...repos.teams.create({ projectId: p.id, nome: body.nome }), membros: [] } });
  });

  app.patch('/teams/:id', async (req) => {
    const t = team(id.parse(req.params).id);
    const body = newTeam.parse(req.body);
    if (repos.teams.byProject(t.projectId).some((x) => x.id !== t.id && x.nome.toLowerCase() === body.nome.toLowerCase())) {
      throw new BoardError(409, 'team_exists', `Já existe uma equipe "${body.nome}" neste projeto`);
    }
    return { equipe: repos.teams.rename(t.id, body.nome) };
  });

  app.delete('/teams/:id', async (req) => {
    const t = team(id.parse(req.params).id);
    repos.teams.delete(t.id);
    return { status: 'deleted' };
  });

  /** Adds an agent to the team, or changes its role there. The same agent can be on teams of several projects. */
  app.put('/teams/:id/members/:agente', async (req) => {
    const params = z.object({ id: z.string().min(1), agente: agentName }).parse(req.params);
    const body = member.parse(req.body ?? {});
    const t = team(params.id);
    repos.teams.setMember({ teamId: t.id, agentId: agent(params.agente).id, papel: body.papel ?? null });
    return { equipe: repos.teams.byProject(t.projectId).find((x) => x.id === t.id) };
  });

  app.delete('/teams/:id/members/:agente', async (req) => {
    const params = z.object({ id: z.string().min(1), agente: agentName }).parse(req.params);
    const t = team(params.id);
    if (!repos.teams.removeMember(t.id, agent(params.agente).id)) throw new BoardError(404, 'member_not_found', 'O agente não está nesta equipe');
    return { equipe: repos.teams.byProject(t.projectId).find((x) => x.id === t.id) };
  });

  /** Where an agent works: its teams and roles, project by project. */
  app.get('/agents/:nome/projects', async (req) => {
    const { nome } = z.object({ nome: agentName }).parse(req.params);
    return { projetos: repos.teams.projectsOfAgent(agent(nome).id) };
  });

  // ---- memory of an agent inside a project ------------------------------------------------------------------------

  app.get('/projects/:id/agents/:agente/facts', async (req) => {
    const params = z.object({ id: z.string().min(1), agente: agentName }).parse(req.params);
    const p = project(params.id);
    return { facts: repos.facts.listAgent({ projectId: p.id, agentId: agent(params.agente).id }) };
  });

  app.post('/projects/:id/agents/:agente/facts', async (req, reply) => {
    const params = z.object({ id: z.string().min(1), agente: agentName }).parse(req.params);
    const body = agentFact.parse(req.body);
    const p = project(params.id);
    const a = agent(params.agente);
    return reply.status(201).send({ fact: repos.facts.add({ texto: body.texto, fixado: body.fixado, projectId: p.id, agentId: a.id }) });
  });
}
