import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export type AgentOrigin = 'usuario' | 'exemplo';

/** Index row of an agent file (the file is the source of truth). */
export interface AgentRow {
  id: string;
  nome: string;
  papel: string | null;
  descricao: string | null;
  provedor: string | null;
  modelo: string | null;
  origem: AgentOrigin;
  /** Name of the file inside the library folder, never an absolute path. */
  arquivo: string;
}

export type AgentIndexEntry = Omit<AgentRow, 'id'>;

const COLS = 'id, nome, papel, descricao, provedor, modelo, origem, arquivo';

export function agentsRepo(db: Db) {
  const byName = (nome: string) => db.prepare(`SELECT ${COLS} FROM agents WHERE nome = ?`).get(nome) as AgentRow | undefined;
  return {
    byName,
    list: () => db.prepare(`SELECT ${COLS} FROM agents ORDER BY nome`).all() as AgentRow[],
    /**
     * Makes the table match `entries`: new names are added, known ones updated in place (their id stays, so old runs
     * keep pointing at the agent) and names that no longer have a valid file are removed (runs fall back to NULL).
     */
    sync(entries: readonly AgentIndexEntry[]): void {
      const upsert = db.prepare(
        `INSERT INTO agents (id, nome, papel, descricao, provedor, modelo, origem, arquivo, atualizado_em)
         VALUES (@id, @nome, @papel, @descricao, @provedor, @modelo, @origem, @arquivo, datetime('now'))
         ON CONFLICT(nome) DO UPDATE SET papel = @papel, descricao = @descricao, provedor = @provedor, modelo = @modelo,
           origem = @origem, arquivo = @arquivo, atualizado_em = datetime('now')`,
      );
      db.transaction(() => {
        const keep = new Set<string>();
        for (const e of entries) {
          upsert.run({ id: randomUUID(), ...e });
          keep.add(e.nome);
        }
        for (const row of db.prepare('SELECT nome FROM agents').all() as Array<{ nome: string }>) {
          if (!keep.has(row.nome)) db.prepare('DELETE FROM agents WHERE nome = ?').run(row.nome);
        }
      })();
    },
  };
}
