import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export const RELATION_TYPES = ['bloqueia', 'relacionado', 'duplicado'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export interface Label {
  id: string;
  projectId: string;
  nome: string;
  cor: string;
}
export interface Relation {
  id: string;
  ticketId: string;
  relatedId: string;
  tipo: RelationType;
}
export interface Cycle {
  id: string;
  projectId: string;
  numero: number;
  nome: string | null;
  inicio: string;
  fim: string;
}
export interface CycleProgress {
  tickets: number;
  concluidos: number;
  /** Points of the estimated tickets; tickets without an estimate count in `semEstimativa`. */
  pontos: number;
  pontosConcluidos: number;
  semEstimativa: number;
  porStatus: Record<string, number>;
}

const LABEL = 'id, project_id AS projectId, nome, cor';
const CYCLE = 'id, project_id AS projectId, numero, nome, inicio, fim';

/** Labels, relations and cycles of the board (prompt 16). Rules (same project, no loops) live in `LocalBoard`. */
export function quadroRepo(db: Db) {
  return {
    // --- labels
    labels: {
      list: (projectId: string): Label[] => db.prepare(`SELECT ${LABEL} FROM labels WHERE project_id = ? ORDER BY nome COLLATE NOCASE`).all(projectId) as Label[],
      get: (id: string): Label | undefined => db.prepare(`SELECT ${LABEL} FROM labels WHERE id = ?`).get(id) as Label | undefined,
      byName: (projectId: string, nome: string): Label | undefined =>
        db.prepare(`SELECT ${LABEL} FROM labels WHERE project_id = ? AND nome = ? COLLATE NOCASE`).get(projectId, nome) as Label | undefined,
      create(projectId: string, nome: string, cor: string): Label {
        const id = randomUUID();
        db.prepare('INSERT INTO labels (id, project_id, nome, cor) VALUES (?, ?, ?, ?)').run(id, projectId, nome, cor);
        return this.get(id)!;
      },
      update(id: string, ch: { nome?: string; cor?: string }): void {
        if (ch.nome !== undefined) db.prepare('UPDATE labels SET nome = ? WHERE id = ?').run(ch.nome, id);
        if (ch.cor !== undefined) db.prepare('UPDATE labels SET cor = ? WHERE id = ?').run(ch.cor, id);
      },
      delete: (id: string): void => void db.prepare('DELETE FROM labels WHERE id = ?').run(id),
      ofTicket: (ticketId: string): Label[] =>
        db
          .prepare(`SELECT l.id, l.project_id AS projectId, l.nome, l.cor FROM ticket_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.ticket_id = ? ORDER BY l.nome COLLATE NOCASE`)
          .all(ticketId) as Label[],
      /** Labels of every ticket of a project in one query (the board list). */
      ofProject(projectId: string): Map<string, Label[]> {
        const rows = db
          .prepare(
            `SELECT tl.ticket_id AS ticketId, l.id, l.project_id AS projectId, l.nome, l.cor FROM ticket_labels tl
             JOIN labels l ON l.id = tl.label_id WHERE l.project_id = ? ORDER BY l.nome COLLATE NOCASE`,
          )
          .all(projectId) as Array<Label & { ticketId: string }>;
        const m = new Map<string, Label[]>();
        for (const { ticketId, ...l } of rows) m.set(ticketId, [...(m.get(ticketId) ?? []), l]);
        return m;
      },
      attach: (ticketId: string, labelId: string): boolean =>
        db.prepare('INSERT OR IGNORE INTO ticket_labels (ticket_id, label_id) VALUES (?, ?)').run(ticketId, labelId).changes === 1,
      detach: (ticketId: string, labelId: string): boolean =>
        db.prepare('DELETE FROM ticket_labels WHERE ticket_id = ? AND label_id = ?').run(ticketId, labelId).changes === 1,
    },

    // --- relations
    relations: {
      get: (id: string): Relation | undefined =>
        db.prepare('SELECT id, ticket_id AS ticketId, related_id AS relatedId, tipo FROM ticket_relations WHERE id = ?').get(id) as Relation | undefined,
      /** Both directions: what this ticket points at (`saem`) and what points at it (`entram`). */
      ofTicket(ticketId: string): { saem: Relation[]; entram: Relation[] } {
        const q = (col: string) =>
          db.prepare(`SELECT id, ticket_id AS ticketId, related_id AS relatedId, tipo FROM ticket_relations WHERE ${col} = ? ORDER BY rowid`).all(ticketId) as Relation[];
        return { saem: q('ticket_id'), entram: q('related_id') };
      },
      /** Is there a relation of this type between the two, in either direction? (`relacionado` and `duplicado` have no direction.) */
      exists(a: string, b: string, tipo: RelationType): boolean {
        const dir = tipo === 'bloqueia' ? '(ticket_id = @a AND related_id = @b)' : '((ticket_id = @a AND related_id = @b) OR (ticket_id = @b AND related_id = @a))';
        return !!db.prepare(`SELECT 1 FROM ticket_relations WHERE tipo = @tipo AND ${dir}`).get({ a, b, tipo });
      },
      create(ticketId: string, relatedId: string, tipo: RelationType): Relation {
        const id = randomUUID();
        db.prepare('INSERT INTO ticket_relations (id, ticket_id, related_id, tipo) VALUES (?, ?, ?, ?)').run(id, ticketId, relatedId, tipo);
        return { id, ticketId, relatedId, tipo };
      },
      delete: (id: string): void => void db.prepare('DELETE FROM ticket_relations WHERE id = ?').run(id),
      /** Does `from` already (transitively) block `target`? Used to refuse a block that would close a loop. */
      blocksTransitively(from: string, target: string): boolean {
        const stmt = db.prepare("SELECT related_id AS r FROM ticket_relations WHERE tipo = 'bloqueia' AND ticket_id = ?");
        const seen = new Set<string>([from]);
        const stack = [from];
        while (stack.length) {
          for (const { r } of stmt.all(stack.pop()!) as Array<{ r: string }>) {
            if (r === target) return true;
            if (!seen.has(r)) {
              seen.add(r);
              stack.push(r);
            }
          }
        }
        return false;
      },
      /** Tickets that block `ticketId` and are not finished yet (`concluido`). */
      openBlockers(ticketId: string): Array<{ id: string; identificador: string; titulo: string; status: string }> {
        return db
          .prepare(
            `SELECT t.id, COALESCE(p.prefixo, '') AS prefixo, p.nome AS projetoNome, t.numero, t.titulo, t.status
             FROM ticket_relations r JOIN tickets t ON t.id = r.ticket_id JOIN projects p ON p.id = t.project_id
             WHERE r.tipo = 'bloqueia' AND r.related_id = ? AND t.status <> 'concluido' ORDER BY t.numero`,
          )
          .all(ticketId)
          .map((r) => {
            const x = r as { id: string; prefixo: string; projetoNome: string; numero: number; titulo: string; status: string };
            const prefix = x.prefixo || (x.projetoNome.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'TKT').padEnd(2, 'X');
            return { id: x.id, identificador: `${prefix}-${x.numero}`, titulo: x.titulo, status: x.status };
          });
      },
    },

    // --- cycles
    cycles: {
      list: (projectId: string): Cycle[] => db.prepare(`SELECT ${CYCLE} FROM cycles WHERE project_id = ? ORDER BY numero DESC`).all(projectId) as Cycle[],
      get: (id: string): Cycle | undefined => db.prepare(`SELECT ${CYCLE} FROM cycles WHERE id = ?`).get(id) as Cycle | undefined,
      create(projectId: string, input: { nome?: string; inicio: string; fim: string }): Cycle {
        const id = randomUUID();
        db.transaction(() => {
          const numero = (db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cycles WHERE project_id = ?').get(projectId) as { n: number }).n;
          db.prepare('INSERT INTO cycles (id, project_id, numero, nome, inicio, fim) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, numero, input.nome ?? null, input.inicio, input.fim);
        })();
        return this.get(id)!;
      },
      update(id: string, ch: { nome?: string | null; inicio?: string; fim?: string }): void {
        if (ch.nome !== undefined) db.prepare('UPDATE cycles SET nome = ? WHERE id = ?').run(ch.nome, id);
        if (ch.inicio !== undefined) db.prepare('UPDATE cycles SET inicio = ? WHERE id = ?').run(ch.inicio, id);
        if (ch.fim !== undefined) db.prepare('UPDATE cycles SET fim = ? WHERE id = ?').run(ch.fim, id);
      },
      delete: (id: string): void => void db.prepare('DELETE FROM cycles WHERE id = ?').run(id), // tickets keep existing: cycle_id goes to NULL
      assign: (ticketId: string, cycleId: string | null): void =>
        void db.prepare("UPDATE tickets SET cycle_id = ?, atualizado_em = datetime('now') WHERE id = ?").run(cycleId, ticketId),
      progress(cycleId: string): CycleProgress {
        const rows = db.prepare('SELECT status, estimativa FROM tickets WHERE cycle_id = ?').all(cycleId) as Array<{ status: string; estimativa: number | null }>;
        const out: CycleProgress = { tickets: rows.length, concluidos: 0, pontos: 0, pontosConcluidos: 0, semEstimativa: 0, porStatus: {} };
        for (const r of rows) {
          out.porStatus[r.status] = (out.porStatus[r.status] ?? 0) + 1;
          const done = r.status === 'concluido';
          if (done) out.concluidos++;
          if (r.estimativa == null) out.semEstimativa++;
          else {
            out.pontos += r.estimativa;
            if (done) out.pontosConcluidos += r.estimativa;
          }
        }
        return out;
      },
    },
  };
}
