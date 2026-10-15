import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export interface Session {
  id: string;
  projectId: string | null;
  titulo: string | null;
  resumo: string | null;
  resumoAnterior: string | null;
  resumoAteMessageId: number | null;
  cliProvider: string | null;
  cliSessionId: string | null;
  deletedAt: string | null;
  criadoEm: string;
}

const COLS = `id, project_id AS projectId, titulo, resumo, resumo_anterior AS resumoAnterior,
  resumo_ate_message_id AS resumoAteMessageId, cli_provider AS cliProvider,
  cli_session_id AS cliSessionId, deleted_at AS deletedAt, criado_em AS criadoEm`;

export function sessionsRepo(db: Db) {
  const get = (id: string) =>
    db.prepare(`SELECT ${COLS} FROM sessions WHERE id = ?`).get(id) as Session | undefined;
  return {
    get,
    create(input: { projectId?: string; titulo?: string } = {}): Session {
      const id = randomUUID();
      db.prepare('INSERT INTO sessions (id, project_id, titulo) VALUES (?, ?, ?)').run(
        id,
        input.projectId ?? null,
        input.titulo ?? null,
      );
      return get(id)!;
    },
    list(opts: { projectId?: string; includeDeleted?: boolean } = {}): Session[] {
      return db
        .prepare(
          `SELECT ${COLS} FROM sessions
           WHERE (@projectId IS NULL OR project_id = @projectId)
             AND (@includeDeleted = 1 OR deleted_at IS NULL)
           ORDER BY criado_em DESC, rowid DESC`,
        )
        .all({ projectId: opts.projectId ?? null, includeDeleted: opts.includeDeleted ? 1 : 0 }) as Session[];
    },
    /** Moves to the trash (hidden, recoverable). */
    softDelete(id: string): void {
      db.prepare("UPDATE sessions SET deleted_at = datetime('now') WHERE id = ?").run(id);
    },
    restore(id: string): void {
      db.prepare('UPDATE sessions SET deleted_at = NULL WHERE id = ?').run(id);
    },
    /** Permanent delete; CASCADE removes runs, messages and attachments. Orphan blobs are collected elsewhere. */
    purge(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
    /** Sets the title only while it is still empty (auto-title from the first message). */
    setTitleIfEmpty(id: string, titulo: string): void {
      db.prepare('UPDATE sessions SET titulo = ? WHERE id = ? AND titulo IS NULL').run(titulo, id);
    },
    setCliSession(id: string, provider: string, cliSessionId: string): void {
      db.prepare('UPDATE sessions SET cli_provider = ?, cli_session_id = ? WHERE id = ?').run(
        provider,
        cliSessionId,
        id,
      );
    },
    /** Stores a new summary, keeping the previous one so it can be undone. */
    setSummary(id: string, resumo: string, ateMessageId: number): void {
      db.prepare(
        'UPDATE sessions SET resumo_anterior = resumo, resumo = ?, resumo_ate_message_id = ? WHERE id = ?',
      ).run(resumo, ateMessageId, id);
    },
  };
}
