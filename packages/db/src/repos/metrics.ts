import type { Db } from '../connection.js';

export interface MetricsFilter {
  projectId?: string;
  /** Runs that started at or after this instant (`YYYY-MM-DD HH:MM:SS`, UTC, as the database stores it). */
  desde?: string;
  /** ...and before this one. */
  ate?: string;
}

interface Usage {
  runs: number;
  ok: number;
  erro: number;
  cancelados: number;
  /** ok / (ok + erro); null while nothing finished that way (a cancelled run says nothing about quality). */
  taxaSucesso: number | null;
  tokensIn: number;
  tokensOut: number;
  /** Sum of the cost the CLIs reported; runs that did not report one count as 0. */
  custo: number;
  /** Runs of an agent on a ticket after its first: the work that came back (rejected, retried). */
  retrabalho: number;
}

export interface MetricsRow extends Usage {
  chave: string;
  rotulo: string;
}

export interface Metrics {
  totais: Usage & {
    /** What the router itself spent classifying (included in the totals: routing is only worth it if it costs less than it saves). */
    roteador: { runs: number; tokens: number };
    /** retrabalho / runs of board agents; null when there are none. */
    taxaRetrabalho: number | null;
  };
  porTicket: Array<MetricsRow & { titulo: string }>;
  porAgente: MetricsRow[];
  porModelo: MetricsRow[];
}

const SUMS = `COUNT(*) AS runs,
  COALESCE(SUM(status = 'ok'), 0) AS ok,
  COALESCE(SUM(status = 'erro'), 0) AS erro,
  COALESCE(SUM(status = 'cancelado'), 0) AS cancelados,
  COALESCE(SUM(tokens_in), 0) AS tokensIn,
  COALESCE(SUM(tokens_out), 0) AS tokensOut,
  COALESCE(SUM(custo_estimado), 0) AS custo,
  COALESCE(SUM(retrabalho), 0) AS retrabalho`;

type Raw = Omit<Usage, 'taxaSucesso'> & { chave: string | null; rotulo: string | null; titulo?: string | null };

const withRate = <T extends Raw>(r: T): Omit<T, 'chave' | 'rotulo'> & { taxaSucesso: number | null; chave: string; rotulo: string } => ({
  ...r,
  chave: r.chave ?? '',
  rotulo: r.rotulo ?? '',
  taxaSucesso: r.ok + r.erro > 0 ? r.ok / (r.ok + r.erro) : null,
});

/** Aggregates over `runs` only: nothing here is stored twice, so the numbers can not drift from the runs. */
export function metricsRepo(db: Db) {
  return {
    /** Tokens (in + out) of every run that started at or after `desde` (the daily budget reads this). */
    tokensSince(desde: string): number {
      const r = db
        .prepare('SELECT COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) AS n FROM runs WHERE inicio >= ?')
        .get(desde) as { n: number };
      return r.n;
    },
    /** Runs that have started and not finished (their tokens are not stored yet). */
    runningCount(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status = 'rodando'").get() as { n: number }).n;
    },
    metrics(f: MetricsFilter = {}): Metrics {
      const where: string[] = [];
      const params: string[] = [];
      if (f.projectId) {
        where.push('project_id = ?');
        params.push(f.projectId);
      }
      if (f.desde) {
        where.push('inicio >= ?');
        params.push(f.desde);
      }
      if (f.ate) {
        where.push('inicio < ?');
        params.push(f.ate);
      }
      // `retrabalho` = 1 for the 2nd, 3rd... run of the same agent on the same ticket. The router's own runs do not count.
      // The numbering runs over every run of the ticket and the period filter applies after it, so the same run is or is not
      // rework regardless of the range chosen.
      const base = `WITH base AS (
        SELECT * FROM (
          SELECT r.id, r.inicio, r.status, r.tokens_in, r.tokens_out, r.custo_estimado, r.etapa, r.ticket_id, r.provedor,
                 COALESCE(r.modelo, 'padrão') AS modelo, COALESCE(a.nome, CASE WHEN r.etapa = 'roteador' THEN 'roteador' ELSE '(sem agente)' END) AS agente, t.titulo AS ticket_titulo,
                 COALESCE(t.project_id, s.project_id) AS project_id,
                 CASE WHEN r.ticket_id IS NOT NULL AND r.agent_id IS NOT NULL AND r.etapa IS NOT 'roteador'
                           AND ROW_NUMBER() OVER (PARTITION BY r.ticket_id, r.agent_id ORDER BY r.inicio, r.rowid) > 1
                      THEN 1 ELSE 0 END AS retrabalho
          FROM runs r
          LEFT JOIN tickets t ON t.id = r.ticket_id
          LEFT JOIN sessions s ON s.id = r.session_id
          LEFT JOIN agents a ON a.id = r.agent_id
        ) ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      )`;
      const all = (sql: string) => db.prepare(`${base} ${sql}`).all(...params) as Raw[];

      const total = db.prepare(`${base} SELECT ${SUMS} FROM base`).get(...params) as Raw;
      const router = db
        .prepare(`${base} SELECT COUNT(*) AS runs, COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) AS tokens FROM base WHERE etapa = 'roteador'`)
        .get(...params) as { runs: number; tokens: number };
      const boardRuns = (db.prepare(`${base} SELECT COUNT(*) AS n FROM base WHERE ticket_id IS NOT NULL AND etapa IS NOT 'roteador'`).get(...params) as { n: number }).n;
      const t = withRate(total);

      return {
        totais: { ...t, roteador: router, taxaRetrabalho: boardRuns ? t.retrabalho / boardRuns : null },
        porTicket: all(`SELECT ticket_id AS chave, ticket_id AS rotulo, MAX(ticket_titulo) AS titulo, ${SUMS} FROM base WHERE ticket_id IS NOT NULL GROUP BY ticket_id ORDER BY custo DESC, tokensIn + tokensOut DESC`).map((r) => ({ ...withRate(r), titulo: r.titulo ?? '' })),
        porAgente: all(`SELECT agente AS chave, agente AS rotulo, ${SUMS} FROM base GROUP BY agente ORDER BY custo DESC, tokensIn + tokensOut DESC`).map(withRate),
        porModelo: all(`SELECT provedor || '/' || modelo AS chave, provedor || ' · ' || modelo AS rotulo, ${SUMS} FROM base GROUP BY provedor, modelo ORDER BY custo DESC, tokensIn + tokensOut DESC`).map(withRate),
      };
    },
  };
}
