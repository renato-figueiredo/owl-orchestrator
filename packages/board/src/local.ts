import type { Actor, Approval, createRepos, GateKind, NewTicket, ResumeInfo, Ticket, TicketComment, TicketEvent, TicketStatus } from '@owl/db';
import { canAgentMove, GATE_LABEL, isDestructive } from './rules.js';

type Repos = ReturnType<typeof createRepos>;

export const HUMAN: Actor = { nome: 'humano', tipo: 'humano' };
export const SYSTEM: Actor = { nome: 'sistema', tipo: 'sistema' };
export const agentActor = (nome: string): Actor => ({ nome, tipo: 'agente' });

type Maybe<T> = T | Promise<T>;

/**
 * What every board backend offers (docs/04-agents-and-board/agents-teams-board.md). The local one is the source of
 * truth; the Linear provider (prompt 16) mirrors it, so it can be asynchronous.
 */
export interface BoardProvider {
  listTickets(projectId: string, filtro?: { status?: TicketStatus; parentId?: string | null; responsavelAgentId?: string }): Maybe<Ticket[]>;
  getTicket(id: string): Maybe<Ticket | undefined>;
  createTicket(t: NewTicket, ator: Actor): Maybe<Ticket>;
  updateStatus(id: string, status: TicketStatus, ator: Actor, opts?: { ordem?: number; comentario?: string }): Maybe<Ticket>;
  comment(id: string, autor: Actor, texto: string, runId?: string): Maybe<TicketComment>;
}

export class BoardError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Decision {
  approval: Approval;
  ticket: Ticket;
  /** True when the decision approves something an agent was waiting on: the caller resumes it. */
  retomar: ResumeInfo | null;
}

export interface GateInput {
  tipo: GateKind;
  motivo: string;
  runId?: string;
  retomar?: ResumeInfo;
}

/** The local board: tickets in SQLite, the state rules and the human gates. No agent is run here. */
export class LocalBoard implements BoardProvider {
  constructor(private readonly repos: Repos) {}

  private need(id: string): Ticket {
    const t = this.repos.tickets.get(id);
    if (!t) throw new BoardError(404, 'ticket_not_found', `Ticket not found: ${id}`);
    return t;
  }

  listTickets(projectId: string, filtro: Parameters<BoardProvider['listTickets']>[1] = {}): Ticket[] {
    return this.repos.tickets.list(projectId, filtro);
  }

  getTicket(id: string): Ticket | undefined {
    return this.repos.tickets.get(id);
  }

  createTicket(t: NewTicket, ator: Actor = HUMAN): Ticket {
    if (!this.repos.projects.get(t.projectId)) throw new BoardError(404, 'project_not_found', `Project not found: ${t.projectId}`);
    if (t.parentId) {
      const parent = this.need(t.parentId);
      if (parent.projectId !== t.projectId) throw new BoardError(400, 'parent_other_project', 'The parent ticket belongs to another project');
    }
    return this.repos.tickets.create(t, ator);
  }

  comment(id: string, autor: Actor, texto: string, runId?: string): TicketComment {
    this.need(id);
    return this.repos.tickets.addComment({ ticketId: id, ator: autor, texto, ...(runId ? { runId } : {}) });
  }

  assign(id: string, agentId: string | null, ator: Actor): Ticket {
    const t = this.need(id);
    this.repos.tickets.setAssignee(id, agentId);
    const nome = agentId ? (this.repos.agents.byId(agentId)?.nome ?? agentId) : null;
    this.repos.tickets.addEvent({ ticketId: id, ator, tipo: 'atribuido', de: t.responsavel, para: nome });
    return this.need(id);
  }

  /**
   * Moves a ticket. An agent follows `AGENT_TRANSITIONS` and cannot close a ticket that needs approval (it gets the
   * delivery gate instead). A human may move anywhere; entering `aguardando_aprovacao` by hand opens the delivery
   * gate, and leaving it closes the open gates (the human already decided by moving the card).
   */
  updateStatus(id: string, status: TicketStatus, ator: Actor, opts: { ordem?: number; comentario?: string } = {}): Ticket {
    const t = this.need(id);
    if (t.status === status) {
      if (opts.ordem !== undefined) this.repos.tickets.setOrder(id, opts.ordem);
      return this.need(id);
    }
    if (ator.tipo === 'agente') {
      if (!canAgentMove(t.status, status)) {
        throw new BoardError(409, 'transition_not_allowed', `An agent cannot move a ticket from ${t.status} to ${status}`);
      }
      if (status === 'aguardando_aprovacao') return this.requestGate(id, { tipo: 'entrega', motivo: GATE_LABEL.entrega }, ator);
      if (status === 'concluido' && t.requerAprovacao) return this.requestGate(id, { tipo: 'entrega', motivo: GATE_LABEL.entrega }, ator);
    }
    if (ator.tipo === 'humano' && t.status === 'aguardando_aprovacao') this.closeOpenGates(id, 'movido manualmente');
    this.move(t, status, ator, opts.ordem);
    if (opts.comentario?.trim()) this.comment(id, ator, opts.comentario.trim());
    if (status === 'aguardando_aprovacao' && this.repos.approvals.pendingByTicket(id).filter((g) => !g.retomar?.acao).length === 0) {
      this.repos.approvals.create({ ticketId: id, tipo: 'entrega', motivo: GATE_LABEL.entrega, retomar: { statusAnterior: t.status } });
    }
    if (status === 'concluido') this.closeParentIfDone(id);
    return this.need(id);
  }

  /** Puts the ticket in `aguardando_aprovacao` with a pending gate. Execution of the waiting step stays paused. */
  requestGate(id: string, gate: GateInput, ator: Actor): Ticket {
    const t = this.need(id);
    if (this.repos.approvals.pendingByTicket(id).some((a) => a.tipo === gate.tipo && a.motivo === gate.motivo)) return t; // same gate twice: one
    this.repos.approvals.create({
      ticketId: id,
      tipo: gate.tipo,
      motivo: gate.motivo,
      ...(gate.runId ? { runId: gate.runId } : {}),
      // Already waiting on another gate: go back to where that one would, never to "waiting".
      retomar: {
        ...gate.retomar,
        statusAnterior:
          t.status === 'aguardando_aprovacao'
            ? (this.repos.approvals.pendingByTicket(id).find((g) => !g.retomar?.acao)?.retomar?.statusAnterior ?? 'em_andamento')
            : (gate.retomar?.statusAnterior ?? t.status),
      },
    });
    this.repos.tickets.addEvent({ ticketId: id, ator, tipo: 'aprovacao', para: 'pendente', detalhe: `${gate.tipo}: ${gate.motivo}`, runId: gate.runId ?? null });
    // A gate that releases a server action (merge, discard) concerns the branch, not the ticket's progress: it stays where it is.
    if (t.status !== 'aguardando_aprovacao' && !gate.retomar?.acao) this.move(t, 'aguardando_aprovacao', ator);
    return this.need(id);
  }

  /**
   * An action an agent wants to take. A destructive one (deleting files, push, deploy, merge...) ALWAYS opens a gate
   * and nothing proceeds until it is approved; anything else is only recorded.
   */
  proposeAction(id: string, acao: string, ator: Actor, runId?: string): { allowed: boolean; approval?: Approval } {
    this.need(id);
    if (!isDestructive(acao)) {
      this.repos.tickets.addEvent({ ticketId: id, ator, tipo: 'execucao', detalhe: acao.slice(0, 500), runId: runId ?? null });
      return { allowed: true };
    }
    this.requestGate(id, { tipo: 'destrutiva', motivo: `${GATE_LABEL.destrutiva}: ${acao.slice(0, 300)}`, ...(runId ? { runId } : {}) }, ator);
    return { allowed: false, approval: this.repos.approvals.pendingByTicket(id).find((a) => a.tipo === 'destrutiva' && !a.retomar?.acao)! };
  }

  /**
   * Decides a gate. Rejecting ALWAYS sends the ticket back to `em_andamento` and puts the comment on the ticket where
   * the agent reads it. Approving closes a delivery (`concluido`); any other kind returns the ticket to where it was.
   */
  decide(approvalId: string, decisao: 'aprovado' | 'rejeitado', comentario: string | undefined, ator: Actor = HUMAN): Decision {
    const a = this.repos.approvals.get(approvalId);
    if (!a || !a.ticketId) throw new BoardError(404, 'approval_not_found', `Approval not found: ${approvalId}`);
    const note = comentario?.trim();
    if (decisao === 'rejeitado' && !note) throw new BoardError(400, 'comment_required', 'Explain the rejection: the agent reads this comment');
    if (!this.repos.approvals.decide(approvalId, decisao, note)) throw new BoardError(409, 'already_decided', 'This decision was already made');
    const t = this.need(a.ticketId);
    this.repos.tickets.addEvent({ ticketId: t.id, ator, tipo: 'aprovacao', de: 'pendente', para: decisao, detalhe: a.motivo, runId: a.runId });
    if (note) this.comment(t.id, ator, decisao === 'rejeitado' ? `Rejeitado: ${note}` : `Aprovado: ${note}`);
    // Merge / discard of the ticket branch: the decision only releases (or cancels) that action. The ticket does not move
    // (rejecting a merge must not reopen a finished ticket) and other gates are none of its business.
    if (a.retomar?.acao) return { approval: this.repos.approvals.get(approvalId)!, ticket: t, retomar: decisao === 'aprovado' ? a.retomar : null };
    let next: TicketStatus;
    if (decisao === 'rejeitado') next = 'em_andamento';
    else if (a.tipo === 'entrega') next = 'concluido';
    else next = (a.retomar?.statusAnterior as TicketStatus | undefined) ?? 'em_andamento';
    // Another gate may still be open on this ticket: it stays waiting.
    const open = this.repos.approvals.pendingByTicket(t.id).filter((g) => !g.retomar?.acao);
    const stillWaiting = open.length > 0;
    // A delivery approved while another gate is open must not be lost: the last gate decided closes the ticket.
    if (stillWaiting && decisao === 'aprovado' && a.tipo === 'entrega') {
      for (const g of open) this.repos.approvals.setRetomar(g.id, { ...g.retomar, statusAnterior: 'concluido' });
    }
    if (!stillWaiting || decisao === 'rejeitado') {
      if (decisao === 'rejeitado') this.closeOpenGates(t.id, 'ticket devolvido');
      if (t.status !== next) this.move(t, next, ator);
      if (next === 'concluido') this.closeParentIfDone(t.id);
    }
    return { approval: this.repos.approvals.get(approvalId)!, ticket: this.need(t.id), retomar: decisao === 'aprovado' && !stillWaiting && next !== 'concluido' ? a.retomar : null };
  }

  /**
   * Startup recovery: a run cannot outlive the server, so a ticket still `em_andamento` has lost its run. Block it with
   * a note; a person can run it again. Call after the interrupted runs were failed.
   */
  recoverInterrupted(): number {
    const lost = this.repos.tickets.byStatus('em_andamento');
    for (const t of lost) {
      this.move(t, 'bloqueado', SYSTEM);
      this.comment(t.id, SYSTEM, 'O servidor reiniciou durante a execução. Rode de novo quando quiser.');
    }
    return lost.length;
  }

  /** Sum of tokens already spent plus an estimate for the next run, against the ticket's ceiling. */
  overBudget(id: string, estimatedTokens: number): boolean {
    const t = this.need(id);
    if (t.orcamentoTokens == null) return false;
    const u = this.repos.tickets.usage(id);
    return u.tokensIn + u.tokensOut + estimatedTokens > t.orcamentoTokens;
  }

  detail(id: string): {
    ticket: Ticket;
    parent: Ticket | null;
    children: Ticket[];
    comments: TicketComment[];
    events: TicketEvent[];
    runs: ReturnType<Repos['tickets']['runs']>;
    uso: ReturnType<Repos['tickets']['usage']>;
    aprovacoes: Approval[];
  } {
    const ticket = this.need(id);
    return {
      ticket,
      parent: ticket.parentId ? (this.repos.tickets.get(ticket.parentId) ?? null) : null,
      children: this.repos.tickets.children(id),
      comments: this.repos.tickets.comments(id),
      events: this.repos.tickets.events(id),
      runs: this.repos.tickets.runs(id),
      uso: this.repos.tickets.usage(id),
      aprovacoes: this.repos.approvals.byTicket(id),
    };
  }

  private move(t: Ticket, to: TicketStatus, ator: Actor, ordem?: number): void {
    this.repos.tickets.setStatus(t.id, to, ordem);
    this.repos.tickets.addEvent({ ticketId: t.id, ator, tipo: 'status', de: t.status, para: to });
  }

  private closeOpenGates(ticketId: string, why: string): void {
    for (const g of this.repos.approvals.pendingByTicket(ticketId)) if (!g.retomar?.acao) this.repos.approvals.decide(g.id, 'rejeitado', why);
  }

  /** When the last sub-task closes, the parent closes with it (the goal is met; no approval of its own). */
  private closeParentIfDone(id: string): void {
    const t = this.need(id);
    if (!t.parentId) return;
    const siblings = this.repos.tickets.children(t.parentId);
    if (siblings.length === 0 || siblings.some((s) => s.status !== 'concluido')) return;
    const parent = this.need(t.parentId);
    if (parent.status === 'concluido') return;
    this.move(parent, 'concluido', SYSTEM);
    this.comment(parent.id, SYSTEM, 'Todas as subtarefas foram concluídas.');
    this.closeParentIfDone(parent.id);
  }
}
