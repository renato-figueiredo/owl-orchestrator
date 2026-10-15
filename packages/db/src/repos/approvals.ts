import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export type ApprovalStatus = 'pendente' | 'aprovado' | 'rejeitado';

export interface Approval {
  id: string;
  ticketId: string | null;
  runId: string | null;
  motivo: string;
  status: ApprovalStatus;
  comentario: string | null;
  decididoEm: string | null;
}

const COLS = `id, ticket_id AS ticketId, run_id AS runId, motivo, status, comentario, decidido_em AS decididoEm`;

/** Human gates. Prompt 06 uses them to ask the user to review a refined prompt; prompt 13 adds ticket gates. */
export function approvalsRepo(db: Db) {
  const get = (id: string) => db.prepare(`SELECT ${COLS} FROM approvals WHERE id = ?`).get(id) as Approval | undefined;
  return {
    get,
    create(input: { runId?: string; ticketId?: string; motivo: string }): Approval {
      const id = randomUUID();
      db.prepare('INSERT INTO approvals (id, ticket_id, run_id, motivo) VALUES (?, ?, ?, ?)').run(
        id,
        input.ticketId ?? null,
        input.runId ?? null,
        input.motivo,
      );
      return get(id)!;
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
      return db
        .prepare(
          `SELECT a.id, a.ticket_id AS ticketId, a.run_id AS runId, a.motivo, a.status, a.comentario,
                  a.decidido_em AS decididoEm
           FROM approvals a JOIN runs r ON r.id = a.run_id
           WHERE r.session_id = ? AND a.status = 'pendente'
           ORDER BY a.rowid`,
        )
        .all(sessionId) as Approval[];
    },
    byRun(runId: string): Approval | undefined {
      return db
        .prepare(`SELECT ${COLS} FROM approvals WHERE run_id = ? ORDER BY rowid DESC LIMIT 1`)
        .get(runId) as Approval | undefined;
    },
  };
}
