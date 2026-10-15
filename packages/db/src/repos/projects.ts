import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export interface Project {
  id: string;
  nome: string;
  /** Working folder of the project; every run of its sessions executes here. */
  pasta: string;
  /** Free-form per-project settings (instructions, linked folders...), JSON-encoded. */
  configJson: string | null;
  criadoEm: string;
}

const COLS = `id, nome, pasta, config_json AS configJson, criado_em AS criadoEm`;

export function projectsRepo(db: Db) {
  const get = (id: string) =>
    db.prepare(`SELECT ${COLS} FROM projects WHERE id = ?`).get(id) as Project | undefined;
  return {
    get,
    create(input: { nome: string; pasta: string; config?: unknown }): Project {
      const id = randomUUID();
      db.prepare('INSERT INTO projects (id, nome, pasta, config_json) VALUES (?, ?, ?, ?)').run(
        id,
        input.nome,
        input.pasta,
        input.config === undefined ? null : JSON.stringify(input.config),
      );
      return get(id)!;
    },
    list(): Project[] {
      return db.prepare(`SELECT ${COLS} FROM projects ORDER BY criado_em DESC, rowid DESC`).all() as Project[];
    },
  };
}
