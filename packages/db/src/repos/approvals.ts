import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export type ApprovalStatus = 'pendente' | 'aprovado' | 'rejeitado';

/** Why a ticket waits for a human (docs/04-agents-and-board/agents-teams-board.md). Pipeline pauses have no kind. */
export type GateKind = 'entrega' | 'custo' | 'destrutiva' | 'reprovacao' | 'confianca';

/** What to do once a gate is approved: the agent step to resume and the status the ticket had. */
export interface ResumeInfo {
  agente?: string;
  /** The instruction the paused agent step was given, so it can be resumed as it was. */
  tarefa?: string;
  statusAnterior?: string;
}

export interface Approval {
  id: string;
  ticketId: string | null;
  runId: string | null;
  motivo: string;
  status: ApprovalStatus;
  comentario: string | null;
  decididoEm: string | null;
  tipo: GateKind | null;
  retomar: ResumeInfo | null;
  criadoEm: string | null;
}

type Row = Omit<Approval, 'retomar'> & { retomar: string | null };

const COLS = `id, ticket_id AS ticketId, run_id AS runId, motivo, status, comentario, decidido_em AS decididoEm,
  tipo, retomar_json AS retomar, criado_em AS criadoEm`;

function toApproval(r: Row): Approval {
  let retomar: ResumeInfo | null = null;
  if (r.retomar) {
    try {
      retomar = JSON.parse(r.retomar) as ResumeInfo;
    } catch {
      retomar = null;
    }
  }
  return { ...r, retomar };
}

/** Human gates. Prompt 06 uses them to ask the user to review a refined prompt; prompt 13 adds ticket gates. */
export function approvalsRepo(db: Db) {
  const get = (id: string) => {
    const r = db.prepare(`SELECT ${COLS} FROM approvals WHERE id = ?`).get(id) as Row | undefined;
    return r && toApproval(r);
  };
  return {
    get,
    create(input: { runId?: string; ticketId?: string; motivo: string; tipo?: GateKind; retomar?: ResumeInfo }): Approval {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO approvals (id, ticket_id, run_id, motivo, tipo, retomar_json, criado_em) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      ).run(
        id,
        input.ticketId ?? null,
        input.runId ?? null,
        input.motivo,
        input.tipo ?? null,
        input.retomar ? JSON.stringify(input.retomar) : null,
      );
      return get(id)!;
    },
    /** Rewrites what a (pending) gate will do once decided, e.g. when a delivery was approved before it. */
    setRetomar(id: string, retomar: ResumeInfo): void {
      db.prepare('UPDATE approvals SET retomar_json = ? WHERE id = ?').run(JSON.stringify(retomar), id);
    },
    /** Pending ticket gates of a project, oldest first (the approvals queue). */
    pendingByProject(projectId: string): Array<Approval & { ticketIdentificador: string; ticketTitulo: string }> {
      const rows = db
        .prepare(
          `SELECT a.id, a.ticket_id AS ticketId, a.run_id AS runId, a.motivo, a.status, a.comentario,
                  a.decidido_em AS decididoEm, a.tipo, a.retomar_json AS retomar, a.criado_em AS criadoEm,
                  COALESCE(p.prefixo, '') AS prefixo, p.nome AS projetoNome, t.numero AS numero, t.titulo AS ticketTitulo
           FROM approvals a JOIN tickets t ON t.id = a.ticket_id JOIN projects p ON p.id = t.project_id
           WHERE t.project_id = ? AND a.status = 'pendente' ORDER BY a.rowid`,
        )
        .all(projectId) as Array<Row & { prefixo: string; projetoNome: string; numero: number; ticketTitulo: string }>;
      return rows.map(({ prefixo, projetoNome, numero, ticketTitulo, ...r }) => ({
        ...toApproval(r),
        ticketIdentificador: `${prefixo || projetoNome.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3).padEnd(2, 'X') || 'TKT'}-${numero}`,
        ticketTitulo,
      }));
    },
    /** Approvals (any status) of one ticket, oldest first. */
    byTicket(ticketId: string): Approval[] {
      return (db.prepare(`SELECT ${COLS} FROM approvals WHERE ticket_id = ? ORDER BY rowid`).all(ticketId) as Row[]).map(toApproval);
    },
    pendingByTicket(ticketId: string): Approval[] {
      return (db.prepare(`SELECT ${COLS} FROM approvals WHERE ticket_id = ? AND status = 'pendente' ORDER BY rowid`).all(ticketId) as Row[]).map(toApproval);
    },
    /** Decides a pending approval. Returns false when it was already decided (so a double click is harmless). */
    decide(id: string, status: Exclude<ApprovalStatus, 'pendente'>, comentario?: string): boolean {
      const info = db
        .prepare(
          `UPDATE approvals SET status = ?, comentario = ?, decidido_em = datetime('now')
           WHERE id = ? AND status = 'pendente'`,
        )
        .run(status, comentario ?? null, id);
      return info.changes === 1;
    },
    /** Pending approvals attached to runs of a session, oldest first. */
    pendingBySession(sessionId: string): Approval[] {
      return (db
        .prepare(
          `SELECT a.id, a.ticket_id AS ticketId, a.run_id AS runId, a.motivo, a.status, a.comentario,
                  a.decidido_em AS decididoEm, a.tipo, a.retomar_json AS retomar, a.criado_em AS criadoEm
           FROM approvals a JOIN runs r ON r.id = a.run_id
           WHERE r.session_id = ? AND a.status = 'pendente' AND a.ticket_id IS NULL
           ORDER BY a.rowid`,
        )
        .all(sessionId) as Row[]).map(toApproval);
    },
    /**
     * Closes every pending approval that is not tied to a ticket. Call at startup: those are pipeline pauses held in
     * memory, which no longer exist after a restart (ticket gates, prompt 13, are persistent and are left alone).
     */
    expirePendingRunGates(): number {
      return db
        .prepare(
          `UPDATE approvals SET status = 'rejeitado', comentario = 'expirado', decidido_em = datetime('now')
           WHERE status = 'pendente' AND ticket_id IS NULL`,
        )
        .run().changes;
    },
    byRun(runId: string): Approval | undefined {
      const r = db.prepare(`SELECT ${COLS} FROM approvals WHERE run_id = ? AND ticket_id IS NULL ORDER BY rowid DESC LIMIT 1`).get(runId) as Row | undefined;
      return r && toApproval(r);
    },
  };
}
