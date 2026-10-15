import { agentActor, BoardError, HUMAN, TICKET_STATUSES, type LocalBoard } from '@owl/board';
import { isSafeName } from '@owl/core';
import type { createRepos } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BoardFlow } from './board-flow.js';
import type { Library } from './library.js';

type Repos = ReturnType<typeof createRepos>;

const id = z.object({ id: z.string().min(1).max(100) });
const agentName = z.string().refine(isSafeName, 'invalid agent name').max(64);
const status = z.enum(TICKET_STATUSES);
/** Present only when an agent (not the person at the keyboard) makes the call: the agent's rules then apply. */
const asAgent = { agente: agentName.optional() };

const newTicket = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(50_000).optional(),
  criteriosAceite: z.string().trim().max(20_000).optional(),
  parentId: z.string().min(1).optional(),
  status: status.optional(),
  prioridade: z.number().int().min(0).max(4).optional(),
  orcamentoTokens: z.number().int().min(1).max(100_000_000).optional(),
  requerAprovacao: z.boolean().optional(),
  responsavel: agentName.optional(),
  ...asAgent,
});
const patchTicket = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  descricao: z.string().trim().max(50_000).nullable().optional(),
  criteriosAceite: z.string().trim().max(20_000).nullable().optional(),
  prioridade: z.number().int().min(0).max(4).optional(),
  orcamentoTokens: z.number().int().min(1).max(100_000_000).nullable().optional(),
  requerAprovacao: z.boolean().optional(),
});
const setStatus = z.object({
  status,
  /** Position inside the column (float between its neighbours, like Linear's sortOrder). */
  ordem: z.number().finite().optional(),
  comentario: z.string().trim().max(20_000).optional(),
  ...asAgent,
});
const comment = z.object({ texto: z.string().trim().min(1).max(50_000), ...asAgent });
const assign = z.object({ agente: agentName.nullable() });
const action = z.object({ acao: z.string().trim().min(1).max(2000), ...asAgent });
const runBody = z.object({
  agente: agentName.optional(),
  tarefa: z.string().trim().min(1).max(5000).default('Trabalhe neste ticket conforme a descrição e os critérios de aceite.'),
});
const goal = z.object({ objetivo: z.string().trim().min(1).max(20_000) });
const decide = z.object({ decisao: z.enum(['aprovado', 'rejeitado']), comentario: z.string().trim().max(20_000).optional() });

/** Routes of the local board (prompt 13). Everything is scoped by project; the board is the agents' message bus. */
export function registerBoardRoutes(
  app: FastifyInstance,
  deps: { repos: Repos; board: LocalBoard; flow: BoardFlow; library: Library },
): void {
  const { repos, board, flow, library } = deps;
  const actor = (agente: string | undefined) => (agente ? agentActor(agente) : HUMAN);
  const project = (pid: string) => {
    const p = repos.projects.get(pid);
    if (!p) throw new BoardError(404, 'project_not_found', `Project not found: ${pid}`);
    return p;
  };
  const ticket = (tid: string) => {
    const t = repos.tickets.get(tid);
    if (!t) throw new BoardError(404, 'ticket_not_found', `Ticket not found: ${tid}`);
    return t;
  };
  const agentRow = (nome: string) => {
    const a = repos.agents.byName(nome);
    if (!a) throw new BoardError(400, 'unknown_agent', `Agent not found in the library: ${nome}`);
    return a;
  };

  app.get('/projects/:id/board', async (req) => {
    const { id: pid } = id.parse(req.params);
    project(pid);
    const tickets = board.listTickets(pid).map((t) => ({ ...t, uso: repos.tickets.usage(t.id) }));
    return { estados: TICKET_STATUSES, tickets, aprovacoes: repos.approvals.pendingByProject(pid) };
  });

  app.get('/projects/:id/approvals', async (req) => {
    const { id: pid } = id.parse(req.params);
    project(pid);
    return { aprovacoes: repos.approvals.pendingByProject(pid) };
  });

  app.post('/projects/:id/tickets', async (req, reply) => {
    const { id: pid } = id.parse(req.params);
    const body = newTicket.parse(req.body);
    project(pid);
    const created = board.createTicket(
      {
        projectId: pid,
        titulo: body.titulo,
        ...(body.descricao ? { descricao: body.descricao } : {}),
        ...(body.criteriosAceite ? { criteriosAceite: body.criteriosAceite } : {}),
        ...(body.parentId ? { parentId: body.parentId } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.prioridade !== undefined ? { prioridade: body.prioridade } : {}),
        ...(body.orcamentoTokens ? { orcamentoTokens: body.orcamentoTokens } : {}),
        ...(body.requerAprovacao !== undefined ? { requerAprovacao: body.requerAprovacao } : {}),
        ...(body.responsavel ? { responsavelAgentId: agentRow(body.responsavel).id } : {}),
      },
      actor(body.agente),
    );
    return reply.status(201).send({ ticket: created });
  });

  app.post('/projects/:id/board/goals', async (req, reply) => {
    const { id: pid } = id.parse(req.params);
    const body = goal.parse(req.body);
    const started = flow.startGoal(project(pid), body.objetivo);
    return reply.status(202).send({ ticket: repos.tickets.get(started.ticket.id), runId: started.run?.id ?? null });
  });

  app.get('/tickets/:id', async (req) => board.detail(id.parse(req.params).id));

  app.patch('/tickets/:id', async (req) => {
    const { id: tid } = id.parse(req.params);
    const body = patchTicket.parse(req.body);
    ticket(tid);
    repos.tickets.update(tid, {
      ...(body.titulo !== undefined ? { titulo: body.titulo } : {}),
      ...(body.descricao !== undefined ? { descricao: body.descricao } : {}),
      ...(body.criteriosAceite !== undefined ? { criteriosAceite: body.criteriosAceite } : {}),
      ...(body.prioridade !== undefined ? { prioridade: body.prioridade } : {}),
      ...(body.orcamentoTokens !== undefined ? { orcamentoTokens: body.orcamentoTokens } : {}),
      ...(body.requerAprovacao !== undefined ? { requerAprovacao: body.requerAprovacao } : {}),
    });
    return { ticket: repos.tickets.get(tid) };
  });

  app.post('/tickets/:id/status', async (req) => {
    const { id: tid } = id.parse(req.params);
    const body = setStatus.parse(req.body);
    const updated = board.updateStatus(tid, body.status, actor(body.agente), {
      ...(body.ordem !== undefined ? { ordem: body.ordem } : {}),
      ...(body.comentario ? { comentario: body.comentario } : {}),
    });
    return { ticket: updated, aprovacoes: repos.approvals.pendingByTicket(tid) };
  });

  app.post('/tickets/:id/comments', async (req, reply) => {
    const { id: tid } = id.parse(req.params);
    const body = comment.parse(req.body);
    return reply.status(201).send({ comment: board.comment(tid, actor(body.agente), body.texto) });
  });

  app.post('/tickets/:id/assign', async (req) => {
    const { id: tid } = id.parse(req.params);
    const body = assign.parse(req.body);
    return { ticket: board.assign(tid, body.agente ? agentRow(body.agente).id : null, HUMAN) };
  });

  /** An agent announcing what it is about to do: a destructive action always opens a gate. */
  app.post('/tickets/:id/actions', async (req, reply) => {
    const { id: tid } = id.parse(req.params);
    const body = action.parse(req.body);
    const r = board.proposeAction(tid, body.acao, actor(body.agente));
    return reply.status(r.allowed ? 200 : 202).send({ permitido: r.allowed, ...(r.approval ? { aprovacao: r.approval } : {}) });
  });

  app.post('/tickets/:id/run', async (req, reply) => {
    const { id: tid } = id.parse(req.params);
    const body = runBody.parse(req.body ?? {});
    const t = ticket(tid);
    const nome = body.agente ?? t.responsavel;
    if (!nome) throw new BoardError(400, 'no_agent', 'Choose an agent: the ticket has no assignee');
    try {
      library.agent(nome);
    } catch (e) {
      throw new BoardError(400, 'unknown_agent', e instanceof Error ? e.message : String(e));
    }
    if (repos.tickets.runs(tid).some((r) => r.status === 'rodando')) {
      throw new BoardError(409, 'ticket_busy', 'An agent is already working on this ticket');
    }
    if (repos.approvals.pendingByTicket(tid).length > 0) {
      throw new BoardError(409, 'waiting_approval', 'The ticket is waiting for a decision');
    }
    const run = flow.run(tid, nome, body.tarefa);
    return reply.status(202).send({ runId: run?.id ?? null, ticket: repos.tickets.get(tid), aprovacoes: repos.approvals.pendingByTicket(tid) });
  });

  app.post('/approvals/:id/decide', async (req) => {
    const { id: aid } = id.parse(req.params);
    const body = decide.parse(req.body);
    const decision = board.decide(aid, body.decisao, body.comentario, HUMAN);
    const run = flow.onDecision(decision, body.decisao);
    return { aprovacao: decision.approval, ticket: repos.tickets.get(decision.ticket.id), runId: run?.id ?? null };
  });
}
