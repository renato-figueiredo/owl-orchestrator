import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * Applies pending `NNNN_name.sql` files in order, each in its own transaction.
 * Idempotent: applied versions are skipped; an edited, already-applied file is an error.
 * Returns the versions applied by this call.
 */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Map(
    db
      .prepare('SELECT version, checksum FROM schema_migrations')
      .all()
      .map((r) => [(r as Row).version, (r as Row).checksum] as const),
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort();

  const done: string[] = [];
  for (const file of files) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prev = applied.get(file);
    if (prev !== undefined) {
      if (prev !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)').run(file, checksum);
    })();
    done.push(file);
  }
  return done;
}

interface Row {
  version: string;
  checksum: string;
}
