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

export function foreignKeysEnabled(db: Db): boolean {
  return db.pragma('foreign_keys', { simple: true }) === 1;
}
