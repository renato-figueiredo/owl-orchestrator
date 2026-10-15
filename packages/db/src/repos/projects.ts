import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export interface Project {
  id: string;
  nome: string;
  /** Working folder of the project; every run of its sessions executes here. */
  pasta: string;
  /** Free-form per-project settings (instructions, linked folders...), JSON-encoded. */
  configJson: string | null;
  /** Most runs of this project executing at once; null = the server default. */
  maxConcorrencia: number | null;
  /** Branch that ticket branches start from and merge into; null = the branch checked out in the folder. */
  branchBase: string | null;
  criadoEm: string;
}

const COLS = `id, nome, pasta, config_json AS configJson, max_concorrencia AS maxConcorrencia, branch_base AS branchBase,
  criado_em AS criadoEm`;

export function projectsRepo(db: Db) {
  const get = (id: string) =>
    db.prepare(`SELECT ${COLS} FROM projects WHERE id = ?`).get(id) as Project | undefined;
  return {
    get,
    create(input: { nome: string; pasta: string; config?: unknown; maxConcorrencia?: number; branchBase?: string }): Project {
      const id = randomUUID();
      db.prepare('INSERT INTO projects (id, nome, pasta, config_json, max_concorrencia, branch_base) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        input.nome,
        input.pasta,
        input.config === undefined ? null : JSON.stringify(input.config),
        input.maxConcorrencia ?? null,
        input.branchBase ?? null,
      );
      return get(id)!;
    },
    list(): Project[] {
      return db.prepare(`SELECT ${COLS} FROM projects ORDER BY criado_em DESC, rowid DESC`).all() as Project[];
    },
    /** Edits the given fields (`null` clears the nullable ones). The folder is already validated by the caller. */
    update(
      id: string,
      changes: { nome?: string; pasta?: string; config?: unknown; maxConcorrencia?: number | null; branchBase?: string | null },
    ): Project | undefined {
      const sets: string[] = [];
      const values: unknown[] = [];
      const put = (col: string, v: unknown) => {
        sets.push(`${col} = ?`);
        values.push(v);
      };
      if (changes.nome !== undefined) put('nome', changes.nome);
      if (changes.pasta !== undefined) put('pasta', changes.pasta);
      if (changes.config !== undefined) put('config_json', changes.config === null ? null : JSON.stringify(changes.config));
      if (changes.maxConcorrencia !== undefined) put('max_concorrencia', changes.maxConcorrencia);
      if (changes.branchBase !== undefined) put('branch_base', changes.branchBase);
      if (sets.length) db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      return get(id);
    },
    /** Removes the project and, by cascade, its conversations, tickets, teams and facts. Files on disk are never touched. */
    delete(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    },
    /** Runs of the project that are executing right now (for the concurrency limit and the delete guard). */
    runningRuns(id: string): number {
      return (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM runs r LEFT JOIN sessions s ON s.id = r.session_id
             WHERE r.status = 'rodando' AND s.project_id = ?`,
          )
          .get(id) as { n: number }
      ).n;
    },
  };
}
