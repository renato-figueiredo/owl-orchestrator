import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Opens a SQLite database with the project's required PRAGMAs on EVERY connection.
 * `auto_vacuum` must be set before the first table is created, so it comes first
 * (it is a silent no-op on databases that already have tables).
 */
export function openDb(file = ':memory:'): Db {
  const db = new Database(file);
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // without this ON DELETE CASCADE does nothing
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Read-only connection to an existing database (the memory MCP server reads through it and cannot write by mistake). */
export function openReadonly(file: string): Db {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

export function foreignKeysEnabled(db: Db): boolean {
  return db.pragma('foreign_keys', { simple: true }) === 1;
}

/**
 * Consistent copy of the live database into a NEW file (`VACUUM INTO`): safe with WAL and concurrent writers, and
 * compacted. The target must not exist.
 */
export function snapshotTo(db: Db, file: string): void {
  db.prepare('VACUUM INTO ?').run(file);
}

export interface SnapshotCheck {
  ok: boolean;
  error?: string;
  sessions?: number;
  messages?: number;
}

/** Opens a snapshot read-only (it is never modified) and checks that it is a healthy OWL database. */
export function checkSnapshot(file: string): SnapshotCheck {
  let db: Db | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, error: `integrity_check: ${String(integrity)}` };
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sessions','messages','schema_migrations')").all();
    if (has.length !== 3) return { ok: false, error: 'Not an OWL database (tables are missing)' };
    const count = (t: string) => (db!.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    return { ok: true, sessions: count('sessions'), messages: count('messages') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    db?.close();
  }
}
