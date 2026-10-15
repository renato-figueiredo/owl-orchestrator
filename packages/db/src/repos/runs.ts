import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export type RunStatus = 'rodando' | 'ok' | 'erro' | 'cancelado';

export interface Run {
  id: string;
  sessionId: string | null;
  ticketId: string | null;
  parentRunId: string | null;
  agentId: string | null;
  provedor: string;
  modelo: string | null;
  etapa: string | null;
  status: RunStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  custoEstimado: number | null;
  complexidade: string | null;
  inicio: string;
  fim: string | null;
  erro: string | null;
  /** Memory tools the model called, by name (MCP); null when none. */
  memoriaChamadas: Record<string, number> | null;
}

const COLS = `id, session_id AS sessionId, ticket_id AS ticketId, parent_run_id AS parentRunId,
  agent_id AS agentId, provedor, modelo, etapa, status, tokens_in AS tokensIn,
  tokens_out AS tokensOut, custo_estimado AS custoEstimado, complexidade, inicio, fim, erro, memoria_chamadas AS memoriaChamadas`;

type RunRow = Omit<Run, 'memoriaChamadas'> & { memoriaChamadas: string | null };

function toRun(r: RunRow): Run {
  let calls: Run['memoriaChamadas'] = null;
  if (r.memoriaChamadas) {
    try {
      calls = JSON.parse(r.memoriaChamadas) as Record<string, number>;
    } catch {
      calls = null;
    }
  }
  return { ...r, memoriaChamadas: calls };
}

export function runsRepo(db: Db) {
  const get = (id: string) => {
    const r = db.prepare(`SELECT ${COLS} FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
    return r && toRun(r);
  };
  return {
    get,
    /**
     * Marks runs still 'rodando' as failed. Call at startup, before serving: their process died with the server, and
     * a stuck run would make the conversation impossible to trash or delete.
     */
    failInterrupted(): number {
      return db
        .prepare(
          `UPDATE runs SET status = 'erro', erro = 'Servidor reiniciado durante a execução', fim = datetime('now')
           WHERE status = 'rodando'`,
        )
        .run().changes;
    },
    start(input: {
      provedor: string;
      sessionId?: string;
      ticketId?: string;
      parentRunId?: string;
      agentId?: string;
      modelo?: string;
      etapa?: string;
      /** The run neither resumes nor updates the session's CLI conversation (summarizer, refiner). */
      semEstado?: boolean;
    }): Run {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO runs (id, session_id, ticket_id, parent_run_id, agent_id, provedor, modelo, etapa, sem_estado, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rodando')`,
      ).run(
        id,
        input.sessionId ?? null,
        input.ticketId ?? null,
        input.parentRunId ?? null,
        input.agentId ?? null,
        input.provedor,
        input.modelo ?? null,
        input.etapa ?? null,
        input.semEstado ? 1 : 0,
      );
      return get(id)!;
    },
    finish(
      id: string,
      result: {
        status: Exclude<RunStatus, 'rodando'>;
        tokensIn?: number;
        tokensOut?: number;
        custoEstimado?: number;
        complexidade?: string;
        erro?: string;
      },
    ): void {
      db.prepare(
        `UPDATE runs SET status = ?, tokens_in = ?, tokens_out = ?, custo_estimado = ?,
           complexidade = ?, erro = ?, fim = datetime('now') WHERE id = ?`,
      ).run(
        result.status,
        result.tokensIn ?? null,
        result.tokensOut ?? null,
        result.custoEstimado ?? null,
        result.complexidade ?? null,
        result.erro ?? null,
        id,
      );
    },
    /**
     * When the most recent other finished run of this session that talked to the CLI conversation started. Stateless
     * runs (summaries, refiner) and failed starts do not count: the CLI did not see what happened around them.
     */
    previousStart(sessionId: string, exceptRunId: string): string | undefined {
      const row = db
        .prepare(
          `SELECT inicio FROM runs WHERE session_id = ? AND id <> ? AND status = 'ok' AND sem_estado = 0
           ORDER BY rowid DESC LIMIT 1`,
        )
        .get(sessionId, exceptRunId) as { inicio: string } | undefined;
      return row?.inicio;
    },
    listBySession(sessionId: string): Run[] {
      const rows = db
        .prepare(`SELECT ${COLS} FROM runs WHERE session_id = ? ORDER BY inicio, rowid`)
        .all(sessionId) as RunRow[];
      return rows.map(toRun);
    },
    /** Records the memory tools the model called in this run. */
    setMemoryCalls(id: string, calls: Record<string, number>): void {
      db.prepare('UPDATE runs SET memoria_chamadas = ? WHERE id = ?').run(Object.keys(calls).length ? JSON.stringify(calls) : null, id);
    },
  };
}
