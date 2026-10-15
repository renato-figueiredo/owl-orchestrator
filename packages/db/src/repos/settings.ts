import type { Db } from '../connection.js';

/** Application settings as JSON values under a key. Validation belongs to the caller (it knows the shape). */
export function settingsRepo(db: Db) {
  return {
    get(key: string): unknown {
      const row = db.prepare('SELECT value_json AS v FROM settings WHERE key = ?').get(key) as { v: string } | undefined;
      if (!row) return undefined;
      try {
        return JSON.parse(row.v) as unknown;
      } catch {
        return undefined; // a corrupted value reads as "not set": the caller falls back to its defaults
      }
    },
    set(key: string, value: unknown): void {
      db.prepare(
        `INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, atualizado_em = datetime('now')`,
      ).run(key, JSON.stringify(value));
    },
  };
}
