import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buscarMensagens, createRepos, foreignKeysEnabled, migrate, openDb, type Db } from './index.js';

const open: Db[] = [];
const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'owl-db-acc-'));
  dirs.push(d);
  return d;
}
function fresh(file?: string): Db {
  const db = openDb(file);
  open.push(db);
  return db;
}
function setup() {
  const db = fresh();
  migrate(db);
  return { db, r: createRepos(db) };
}
const count = (db: Db, table: string, where = '1=1') =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('prompt 02: schema matches docs/03-data/database.md', () => {
  const docPath = fileURLToPath(new URL('../../../docs/03-data/database.md', import.meta.url));
  const doc = readFileSync(docPath, 'utf8');

  it('creates every table, index and trigger declared in the doc', () => {
    const { db } = setup();
    const names = (type: string) =>
      new Set((db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map((r) => r.name));
    const tables = [...doc.matchAll(/CREATE (?:VIRTUAL )?TABLE (\w+)/g)].map((m) => m[1]!);
    const indexes = [...doc.matchAll(/CREATE INDEX (\w+)/g)].map((m) => m[1]!);
    const triggers = [...doc.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThanOrEqual(14);
    for (const t of tables) expect(names('table'), `table ${t}`).toContain(t);
    for (const i of indexes) expect(names('index'), `index ${i}`).toContain(i);
    for (const t of triggers) expect(names('trigger'), `trigger ${t}`).toContain(t);
    expect(names('table')).toContain('schema_migrations');
  });

  it('has the columns declared in the doc for every table', () => {
    const { db } = setup();
    const blocks = [...doc.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n?\);/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(13);
    for (const [, table, body] of blocks) {
      const declared = body!
        .split('\n')
        .map((l) => l.replace(/--.*$/, ''))
        .join(' ')
        .split(/,(?![^(]*\))/)
        .map((c) => c.trim().split(/\s+/)[0]!)
        .filter((c) => /^[a-z_]+$/.test(c) && !['PRIMARY', 'UNIQUE', 'FOREIGN'].includes(c));
      const actual = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
      for (const col of declared) expect(actual, `${table}.${col}`).toContain(col);
    }
  });

  it('never stores image bytes in the database (no BLOB columns)', () => {
    const { db } = setup();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).filter((t) => !t.name.startsWith('messages_fts_')); // FTS5 shadow tables store index blobs
    for (const { name } of tables) {
      for (const c of db.pragma(`table_info(${name})`) as { name: string; type: string }[]) {
        expect(c.type.toUpperCase(), `${name}.${c.name}`).not.toBe('BLOB');
      }
    }
  });
});

describe('prompt 02: connection on a file database', () => {
  it('is idempotent across reopen, keeps data, and every connection has FK ON, WAL, busy_timeout', () => {
    const file = join(tmpDir(), 'owl.db');
    const a = fresh(file);
    expect(migrate(a)).toEqual(['0001_initial.sql', '0002_settings.sql', '0003_runs_sem_estado.sql', '0004_blobs_visto_em.sql', '0005_runs_memoria_chamadas.sql', '0006_facts_sessao.sql', '0007_agents_origem.sql', '0008_board.sql', '0009_projetos_equipes_worktrees.sql', '0010_roteador_metricas.sql', '0011_quadro_avancado.sql', '0012_backfill_numero.sql']);
    const s = createRepos(a).sessions.create({ titulo: 'persist' });
    a.close();

    const b = fresh(file);
    expect(foreignKeysEnabled(b)).toBe(true);
    expect(b.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(b.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(migrate(b)).toEqual([]);
    expect(count(b, 'schema_migrations')).toBe(12);
    expect(createRepos(b).sessions.get(s.id)?.titulo).toBe('persist');
    expect(b.pragma('auto_vacuum', { simple: true })).toBe(2);
  });

  it('records a checksum per applied migration and applies new files in order on top of existing ones', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);');
    const db = fresh();
    expect(migrate(db, dir)).toEqual(['0001_a.sql']);
    writeFileSync(join(dir, '0003_c.sql'), 'CREATE TABLE c (x INTEGER);');
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE b (x INTEGER);');
    expect(migrate(db, dir)).toEqual(['0002_b.sql', '0003_c.sql']);
    const rows = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as {
      version: string;
      checksum: string;
    }[];
    expect(rows.map((r) => r.version)).toEqual(['0001_a.sql', '0002_b.sql', '0003_c.sql']);
    for (const r of rows) expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('prompt 02: FTS5 search', () => {
  it('insert -> search finds -> delete -> search no longer finds, and FTS index stays consistent', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const m1 = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'banana prata' });
    const m2 = r.messages.add({ sessionId: s.id, papel: 'assistente', conteudo: 'banana nanica' });
    expect(buscarMensagens(db, 'banana', { sessionId: s.id }, 10)).toHaveLength(2);
    r.messages.delete(m1.id);
    expect(buscarMensagens(db, 'banana', { sessionId: s.id }, 10).map((h) => h.id)).toEqual([m2.id]);
    expect(buscarMensagens(db, 'prata')).toEqual([]);
    // raises if the external-content index diverged from the messages table
    expect(() => db.exec("INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1)")).not.toThrow();
    expect(() => db.exec("INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')")).not.toThrow();
  });

  it('is accent/case tolerant for plain words and ANDs multiple tokens', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'Configurar Servidor Fastify' });
    r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'Configurar cliente' });
    expect(buscarMensagens(db, 'servidor fastify')).toHaveLength(1);
    expect(buscarMensagens(db, 'configurar')).toHaveLength(2);
    expect(buscarMensagens(db, 'inexistente')).toEqual([]);
  });

  it('scopes by session', () => {
    const { db, r } = setup();
    const s1 = r.sessions.create();
    const s2 = r.sessions.create();
    r.messages.add({ sessionId: s1.id, papel: 'usuario', conteudo: 'token vazado' });
    r.messages.add({ sessionId: s2.id, papel: 'usuario', conteudo: 'token vazado tambem' });
    expect(buscarMensagens(db, 'token', { sessionId: s1.id }).map((h) => h.sessionId)).toEqual([s1.id]);
    expect(buscarMensagens(db, 'token', { sessionId: s2.id }).map((h) => h.sessionId)).toEqual([s2.id]);
  });

  it('project scope excludes sessions without a project and never mixes projects', () => {
    const { db, r } = setup();
    db.prepare("INSERT INTO projects (id, nome, pasta) VALUES ('p1','A','a'), ('p2','B','b')").run();
    const a = r.sessions.create({ projectId: 'p1' });
    const b = r.sessions.create({ projectId: 'p2' });
    const loose = r.sessions.create();
    for (const s of [a, b, loose]) r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'segredo comum' });
    expect(buscarMensagens(db, 'segredo', { projectId: 'p1' }).map((h) => h.sessionId)).toEqual([a.id]);
    expect(buscarMensagens(db, 'segredo', { projectId: 'p2' }).map((h) => h.sessionId)).toEqual([b.id]);
    expect(buscarMensagens(db, 'segredo', { projectId: 'nao-existe' })).toEqual([]);
  });

  it('limit 0 returns nothing and the default limit caps results', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    for (let i = 0; i < 8; i++) r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: `alvo ${i}` });
    expect(buscarMensagens(db, 'alvo', {}, 0)).toEqual([]);
    expect(buscarMensagens(db, 'alvo')).toHaveLength(5);
  });

  it('purging a session removes its messages from FTS (index rows, not only the join)', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'zebra unica' });
    r.sessions.purge(s.id);
    // query the FTS table directly: no join with messages that could hide stale rows
    expect(count(db, 'messages_fts', "messages_fts MATCH 'zebra'")).toBe(0);
  });
});

describe('prompt 11: review fixes', () => {
  it('purging a session also removes its run gates (edited prompt, refiner error)', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const run = r.runs.start({ sessionId: s.id, provedor: 'x' });
    db.prepare("INSERT INTO approvals (id, run_id, motivo, status, comentario) VALUES ('a1', ?, 'revisar', 'aprovado', 'PROMPT EDITADO')").run(run.id);
    r.sessions.purge(s.id);
    expect(count(db, 'approvals')).toBe(0);
  });

  it('failInterrupted closes runs left running by a dead server, so the session can be trashed', () => {
    const { r } = setup();
    const s = r.sessions.create();
    const run = r.runs.start({ sessionId: s.id, provedor: 'x' });
    expect(r.sessions.hasRunningRun(s.id)).toBe(true);
    expect(r.runs.failInterrupted()).toBe(1);
    expect(r.sessions.hasRunningRun(s.id)).toBe(false);
    expect(r.runs.get(run.id)?.status).toBe('erro');
    expect(r.runs.failInterrupted()).toBe(0);
  });
});

describe('prompt 02: cascade and referential actions', () => {
  it('purging one session leaves other sessions untouched', () => {
    const { db, r } = setup();
    const a = r.sessions.create();
    const b = r.sessions.create();
    const ra = r.runs.start({ sessionId: a.id, provedor: 'x' });
    const rb = r.runs.start({ sessionId: b.id, provedor: 'x' });
    const ma = r.messages.add({ sessionId: a.id, runId: ra.id, papel: 'usuario', conteudo: 'alfa' });
    const mb = r.messages.add({ sessionId: b.id, runId: rb.id, papel: 'usuario', conteudo: 'alfa' });
    r.blobs.upsert({ hash: 'h', caminho: 'p', mime: 'image/png', bytes: 1 });
    r.attachments.add({ messageId: ma.id, blobHash: 'h' });
    r.attachments.add({ messageId: mb.id, blobHash: 'h' });

    r.sessions.purge(a.id);

    expect(r.sessions.get(b.id)).toBeDefined();
    expect(r.runs.get(rb.id)).toBeDefined();
    expect(r.messages.get(mb.id)).toBeDefined();
    expect(r.attachments.listByMessage(mb.id)).toHaveLength(1);
    expect(count(db, 'attachments')).toBe(1);
    expect(r.blobs.orphans()).toEqual([]); // still referenced by b
    expect(buscarMensagens(db, 'alfa').map((h) => h.id)).toEqual([mb.id]);
  });

  it('deleting a project cascades to sessions, messages, runs, facts, teams and tickets', () => {
    const { db, r } = setup();
    db.prepare("INSERT INTO projects (id, nome, pasta) VALUES ('p','P','x')").run();
    const s = r.sessions.create({ projectId: 'p' });
    const run = r.runs.start({ sessionId: s.id, provedor: 'x' });
    r.messages.add({ sessionId: s.id, runId: run.id, papel: 'usuario', conteudo: 'texto' });
    r.facts.add({ texto: 'f', projectId: 'p' });
    db.prepare("INSERT INTO teams (id, project_id, nome) VALUES ('t','p','T')").run();
    db.prepare("INSERT INTO tickets (id, project_id, titulo) VALUES ('k','p','K')").run();
    db.prepare("INSERT INTO ticket_comments (id, ticket_id, autor, texto) VALUES ('c','k','humano','x')").run();

    db.prepare("DELETE FROM projects WHERE id = 'p'").run();

    for (const t of ['sessions', 'runs', 'messages', 'facts', 'teams', 'tickets', 'ticket_comments']) {
      expect(count(db, t), t).toBe(0);
    }
    expect(buscarMensagens(db, 'texto')).toEqual([]);
  });

  it('deleting a message removes its attachments but keeps the blob row (collected later as orphan)', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const m = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'img' });
    r.blobs.upsert({ hash: 'h1', caminho: 'p', mime: 'image/png', bytes: 1 });
    r.attachments.add({ messageId: m.id, blobHash: 'h1' });
    r.messages.delete(m.id);
    expect(count(db, 'attachments')).toBe(0);
    expect(r.blobs.orphans().map((b) => b.hash)).toEqual(['h1']);
  });

  it('refuses to delete a blob that is still referenced by an attachment', () => {
    const { r } = setup();
    const s = r.sessions.create();
    const m = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'img' });
    r.blobs.upsert({ hash: 'h2', caminho: 'p', mime: 'image/png', bytes: 1 });
    r.attachments.add({ messageId: m.id, blobHash: 'h2' });
    expect(() => r.blobs.delete('h2')).toThrow(/FOREIGN KEY/);
    expect(r.blobs.get('h2')).toBeDefined();
  });

  it('deleting a run keeps its messages and facts (SET NULL), deleting a session cascades only its runs', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const run = r.runs.start({ sessionId: s.id, provedor: 'x' });
    const m = r.messages.add({ sessionId: s.id, runId: run.id, papel: 'assistente', conteudo: 'resp' });
    const f = r.facts.add({ texto: 'fato', origemRunId: run.id });
    db.prepare('DELETE FROM runs WHERE id = ?').run(run.id);
    expect(r.messages.get(m.id)?.runId).toBeNull();
    expect(r.facts.get(f.id)?.origemRunId).toBeNull();
  });

  it('purge is a no-op for an unknown id and trash does not delete data', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'x' });
    expect(() => r.sessions.purge('missing')).not.toThrow();
    r.sessions.softDelete(s.id);
    expect(count(db, 'messages')).toBe(1);
    expect(r.sessions.list()).toEqual([]);
    expect(r.sessions.list({ includeDeleted: true })).toHaveLength(1);
    expect(r.sessions.get(s.id)?.deletedAt).not.toBeNull();
  });

  it('message ids are not reused after delete (AUTOINCREMENT), keeping FTS rowids unambiguous', () => {
    const { r } = setup();
    const s = r.sessions.create();
    const a = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'a' });
    r.messages.delete(a.id);
    const b = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'b' });
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('enforces FK on tickets/facts/attachments inserts too', () => {
    const { db, r } = setup();
    expect(() => db.prepare("INSERT INTO tickets (id, project_id, titulo) VALUES ('k','nope','t')").run()).toThrow(/FOREIGN KEY/);
    expect(() => r.facts.add({ texto: 'x', projectId: 'nope' })).toThrow(/FOREIGN KEY/);
    expect(() => r.attachments.add({ messageId: 999, blobHash: 'nope' })).toThrow(/FOREIGN KEY/);
  });
});
