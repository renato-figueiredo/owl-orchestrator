import type { Db } from '../connection.js';

export type MessageRole = 'usuario' | 'assistente' | 'sistema' | 'agente';

export interface Message {
  id: number;
  sessionId: string;
  runId: string | null;
  papel: MessageRole;
  conteudo: string;
  criadoEm: string;
}

export interface MessageHit extends Message {
  /** FTS5 bm25 rank: lower is more relevant. */
  rank: number;
}

const COLS = `id, session_id AS sessionId, run_id AS runId, papel, conteudo, criado_em AS criadoEm`;

/**
 * Turns free text into a safe FTS5 query: every token is quoted (so operators such as
 * AND/NEAR/"/* in user input are literal) and tokens are ANDed. Empty input yields null.
 */
export function toFtsQuery(consulta: string, modo: 'todas' | 'qualquer' = 'todas'): string | null {
  const tokens = consulta.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(modo === 'qualquer' ? ' OR ' : ' ');
}

export function messagesRepo(db: Db) {
  const get = (id: number) =>
    db.prepare(`SELECT ${COLS} FROM messages WHERE id = ?`).get(id) as Message | undefined;
  return {
    get,
    add(input: { sessionId: string; papel: MessageRole; conteudo: string; runId?: string }): Message {
      const info = db
        .prepare('INSERT INTO messages (session_id, run_id, papel, conteudo) VALUES (?, ?, ?, ?)')
        .run(input.sessionId, input.runId ?? null, input.papel, input.conteudo);
      return get(Number(info.lastInsertRowid))!;
    },
    /** Messages of a session in chronological order, optionally after a message id (for incremental summaries). */
    list(sessionId: string, opts: { afterId?: number; limit?: number } = {}): Message[] {
      return db
        .prepare(
          `SELECT ${COLS} FROM messages WHERE session_id = ? AND id > ? ORDER BY id LIMIT ?`,
        )
        .all(sessionId, opts.afterId ?? 0, opts.limit ?? -1) as Message[];
    },
    /** The last `n` messages, returned in chronological order. */
    lastN(sessionId: string, n: number): Message[] {
      const rows = db
        .prepare(`SELECT ${COLS} FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?`)
        .all(sessionId, n) as Message[];
      return rows.reverse();
    },
    delete(id: number): void {
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    },
  };
}

/**
 * Full-text search over messages (FTS5), best matches first. Scope by session or project;
 * messages from sessions in the trash are never returned.
 */
export function buscarMensagens(
  db: Db,
  consulta: string,
  escopo: { sessionId?: string; projectId?: string } = {},
  limite = 5,
  modo: 'todas' | 'qualquer' = 'todas',
): MessageHit[] {
  const match = toFtsQuery(consulta, modo);
  if (match === null) return [];
  return db
    .prepare(
      `SELECT m.id, m.session_id AS sessionId, m.run_id AS runId, m.papel, m.conteudo,
              m.criado_em AS criadoEm, bm25(messages_fts) AS rank
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       JOIN sessions s ON s.id = m.session_id
       WHERE messages_fts MATCH @match
         AND s.deleted_at IS NULL
         AND (@sessionId IS NULL OR m.session_id = @sessionId)
         AND (@projectId IS NULL OR s.project_id = @projectId)
       ORDER BY rank
       LIMIT @limite`,
    )
    .all({
      match,
      sessionId: escopo.sessionId ?? null,
      projectId: escopo.projectId ?? null,
      limite,
    }) as MessageHit[];
}
