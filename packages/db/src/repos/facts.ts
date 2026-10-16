import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export interface Fact {
  id: string;
  projectId: string | null;
  agentId: string | null;
  sessionId: string | null;
  texto: string;
  fixado: boolean;
  origemRunId: string | null;
  criadoEm: string;
}

const COLS = `id, project_id AS projectId, agent_id AS agentId, session_id AS sessionId, texto, fixado = 1 AS fixado,
  origem_run_id AS origemRunId, criado_em AS criadoEm`;

interface FactRow extends Omit<Fact, 'fixado'> {
  fixado: number;
}
const toFact = (r: FactRow): Fact => ({ ...r, fixado: r.fixado === 1 });

export function factsRepo(db: Db) {
  const get = (id: string) => {
    const r = db.prepare(`SELECT ${COLS} FROM facts WHERE id = ?`).get(id) as FactRow | undefined;
    return r && toFact(r);
  };
  return {
    get,
    add(input: {
      texto: string;
      projectId?: string;
      /** Only for a fact of a conversation with no project. */
      sessionId?: string;
      agentId?: string;
      fixado?: boolean;
      origemRunId?: string;
    }): Fact {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO facts (id, project_id, agent_id, session_id, texto, fixado, origem_run_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        input.projectId ?? null,
        input.agentId ?? null,
        input.projectId ? null : (input.sessionId ?? null),
        input.texto,
        input.fixado ? 1 : 0,
        input.origemRunId ?? null,
      );
      return get(id)!;
    },
    list(opts: { projectId?: string; agentId?: string; apenasFixados?: boolean } = {}): Fact[] {
      const rows = db
        .prepare(
          `SELECT ${COLS} FROM facts
           WHERE (@projectId IS NULL OR project_id = @projectId)
             AND (@agentId IS NULL OR agent_id = @agentId)
             AND (@apenasFixados = 0 OR fixado = 1)
           ORDER BY criado_em, rowid`,
        )
        .all({
          projectId: opts.projectId ?? null,
          agentId: opts.agentId ?? null,
          apenasFixados: opts.apenasFixados ? 1 : 0,
        }) as FactRow[];
      return rows.map(toFact);
    },
    /**
     * Facts of exactly one scope: a project, or one conversation with no project (`projectId: null` plus its
     * `sessionId`). Unlike `list`, `projectId: null` means "no project", never "all", and without a `sessionId` it
     * matches nothing but legacy facts that belong to no conversation. `desde` keeps only facts created or last pinned/edited STRICTLY after that time
     * (timestamps have one-second resolution: a fact made in the very second a run started counts as already seen).
     */
    listScope(scope: { projectId: string | null; sessionId?: string | null; apenasFixados?: boolean; desde?: string }): Fact[] {
      const rows = db
        .prepare(
          `SELECT ${COLS} FROM facts
           WHERE agent_id IS NULL
             AND ((@projectId IS NULL AND project_id IS NULL AND session_id IS @sessionId) OR project_id = @projectId)
             AND (@apenasFixados = 0 OR fixado = 1)
             AND (@desde IS NULL OR COALESCE(atualizado_em, criado_em) > @desde)
           ORDER BY criado_em, rowid`,
        )
        .all({
          projectId: scope.projectId,
          sessionId: scope.projectId ? null : (scope.sessionId ?? null),
          apenasFixados: scope.apenasFixados ? 1 : 0,
          desde: scope.desde ?? null,
        }) as FactRow[];
      return rows.map(toFact);
    },
    /**
     * What one agent remembers inside one project (`facts.agent_id` + `project_id`). Never mixes with the project's own
     * facts (`listScope`, agent_id NULL) nor with the same agent's memory in another project.
     */
    listAgent(scope: { projectId: string; agentId: string; apenasFixados?: boolean }): Fact[] {
      const rows = db
        .prepare(
          `SELECT ${COLS} FROM facts
           WHERE project_id = @projectId AND agent_id = @agentId AND (@apenasFixados = 0 OR fixado = 1)
           ORDER BY criado_em, rowid`,
        )
        .all({ projectId: scope.projectId, agentId: scope.agentId, apenasFixados: scope.apenasFixados ? 1 : 0 }) as FactRow[];
      return rows.map(toFact);
    },
    update(id: string, changes: { texto?: string; fixado?: boolean }): Fact | undefined {
      if (changes.texto !== undefined) db.prepare("UPDATE facts SET texto = ?, atualizado_em = datetime('now') WHERE id = ?").run(changes.texto, id);
      if (changes.fixado !== undefined) db.prepare("UPDATE facts SET fixado = ?, atualizado_em = datetime('now') WHERE id = ?").run(changes.fixado ? 1 : 0, id);
      return get(id);
    },
    setPinned(id: string, fixado: boolean): void {
      db.prepare("UPDATE facts SET fixado = ?, atualizado_em = datetime('now') WHERE id = ?").run(fixado ? 1 : 0, id);
    },
    delete(id: string): void {
      db.prepare('DELETE FROM facts WHERE id = ?').run(id);
    },
  };
}
