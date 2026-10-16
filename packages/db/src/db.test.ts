import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buscarMensagens,
  createRepos,
  foreignKeysEnabled,
  migrate,
  openDb,
  toFtsQuery,
  type Db,
} from './index.js';

const open: Db[] = [];
const dirs: string[] = [];
function fresh(file?: string): Db {
  const db = openDb(file);
  open.push(db);
  return db;
}
function tmpFile(name = 'owl.db'): string {
  const dir = mkdtempSync(join(tmpdir(), 'owl-db-'));
  dirs.push(dir);
  return join(dir, name);
}
function setup() {
  const db = fresh();
  migrate(db);
  return { db, r: createRepos(db) };
}
const count = (db: Db, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('connection', () => {
  it('has foreign_keys ON on every connection', () => {
    const file = tmpFile();
    expect(foreignKeysEnabled(fresh(file))).toBe(true);
    expect(foreignKeysEnabled(fresh(file))).toBe(true);
    expect(foreignKeysEnabled(fresh())).toBe(true);
  });

  it('uses WAL and incremental auto_vacuum on a new file database', () => {
    const db = fresh(tmpFile());
    migrate(db);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2); // INCREMENTAL
  });
});

describe('migrate', () => {
  it('applies from scratch and is idempotent', () => {
    const db = fresh();
    expect(migrate(db)).toEqual(['0001_initial.sql', '0002_settings.sql', '0003_runs_sem_estado.sql', '0004_blobs_visto_em.sql', '0005_runs_memoria_chamadas.sql', '0006_facts_sessao.sql', '0007_agents_origem.sql', '0008_board.sql', '0009_projetos_equipes_worktrees.sql', '0010_roteador_metricas.sql', '0011_quadro_avancado.sql', '0012_backfill_numero.sql']);
    expect(migrate(db)).toEqual([]);
    expect(count(db, 'schema_migrations')).toBe(12);
    for (const t of ['projects', 'agents', 'teams', 'sessions', 'tickets', 'runs', 'messages', 'blobs', 'approvals']) {
      expect(count(db, t)).toBe(0);
    }
  });

  it('refuses to run when an applied migration was edited', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-mig-'));
    dirs.push(dir);
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);');
    const db = fresh();
    migrate(db, dir);
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER, y INTEGER);');
    expect(() => migrate(db, dir)).toThrow(/modified/);
  });

  it('rolls back a failing migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-mig-'));
    dirs.push(dir);
    writeFileSync(join(dir, '0001_bad.sql'), 'CREATE TABLE ok (x INTEGER); SELECT * FROM missing;');
    const db = fresh();
    expect(() => migrate(db, dir)).toThrow();
    expect(count(db, 'schema_migrations')).toBe(0);
    expect(() => count(db, 'ok')).toThrow();
  });
});

describe('FTS search', () => {
  it('finds messages, and stops finding them after delete', () => {
    const { db, r } = setup();
    const s = r.sessions.create({ titulo: 't' });
    const m = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'preciso migrar o banco para sqlite' });
    r.messages.add({ sessionId: s.id, papel: 'assistente', conteudo: 'outra coisa sem relacao' });

    expect(buscarMensagens(db, 'sqlite', { sessionId: s.id }).map((h) => h.id)).toEqual([m.id]);
    r.messages.delete(m.id);
    expect(buscarMensagens(db, 'sqlite', { sessionId: s.id })).toEqual([]);
  });

  it('keeps the index in sync on update', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const m = r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'texto antigo' });
    db.prepare('UPDATE messages SET conteudo = ? WHERE id = ?').run('texto novo', m.id);
    expect(buscarMensagens(db, 'antigo')).toEqual([]);
    expect(buscarMensagens(db, 'novo')).toHaveLength(1);
  });

  it('treats FTS operators in user input as literal text', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'erro "quoted" AND OR NEAR * (x)' });
    expect(() => buscarMensagens(db, 'AND OR " ( * NEAR')).not.toThrow();
    expect(buscarMensagens(db, '"quoted"')).toHaveLength(1);
    expect(buscarMensagens(db, '   ')).toEqual([]);
    expect(toFtsQuery('a "b')).toBe('"a" """b"');
  });

  it('scopes by project and hides trashed sessions', () => {
    const { db, r } = setup();
    db.prepare("INSERT INTO projects (id, nome, pasta) VALUES ('p1','A','/a'), ('p2','B','/b')").run();
    const s1 = r.sessions.create({ projectId: 'p1' });
    const s2 = r.sessions.create({ projectId: 'p2' });
    r.messages.add({ sessionId: s1.id, papel: 'usuario', conteudo: 'deploy do servidor' });
    r.messages.add({ sessionId: s2.id, papel: 'usuario', conteudo: 'deploy do cliente' });

    expect(buscarMensagens(db, 'deploy', { projectId: 'p1' })).toHaveLength(1);
    expect(buscarMensagens(db, 'deploy')).toHaveLength(2);
    r.sessions.softDelete(s1.id);
    expect(buscarMensagens(db, 'deploy')).toHaveLength(1);
    r.sessions.restore(s1.id);
    expect(buscarMensagens(db, 'deploy')).toHaveLength(2);
  });

  it('respects the limit and ranks best first', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    for (let i = 0; i < 4; i++) r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: `cache ${i}` });
    expect(buscarMensagens(db, 'cache', {}, 2)).toHaveLength(2);
  });
});

describe('cascade delete', () => {
  it('purging a session removes runs, messages, attachments and FTS rows; blobs become orphans', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const run = r.runs.start({ sessionId: s.id, provedor: 'fake' });
    const m = r.messages.add({ sessionId: s.id, runId: run.id, papel: 'usuario', conteudo: 'olha este print' });
    const blob = r.blobs.upsert({ hash: 'abc', caminho: 'data/attachments/abc.png', mime: 'image/png', bytes: 10 });
    r.attachments.add({ messageId: m.id, blobHash: blob.hash, nomeOriginal: 'print.png' });
    expect(r.blobs.orphans()).toEqual([]);

    r.sessions.purge(s.id);

    expect(count(db, 'runs')).toBe(0);
    expect(count(db, 'messages')).toBe(0);
    expect(count(db, 'attachments')).toBe(0);
    expect(buscarMensagens(db, 'print')).toEqual([]);
    expect(r.blobs.orphans().map((b) => b.hash)).toEqual(['abc']);
    r.blobs.delete('abc');
    expect(count(db, 'blobs')).toBe(0);
  });
});

describe('purge and facts', () => {
  it('purging a session deletes the unpinned facts it generated, keeps pinned and unrelated ones', () => {
    const { r } = setup();
    const s = r.sessions.create();
    const other = r.sessions.create();
    const run = r.runs.start({ sessionId: s.id, provedor: 'fake', etapa: 'resumo' });
    const otherRun = r.runs.start({ sessionId: other.id, provedor: 'fake' });
    r.facts.add({ texto: 'gerado', origemRunId: run.id });
    r.facts.add({ texto: 'fixado pelo usuário', origemRunId: run.id, fixado: true });
    r.facts.add({ texto: 'de outra sessão', origemRunId: otherRun.id });
    r.facts.add({ texto: 'manual' });

    r.sessions.purge(s.id);

    expect(r.facts.list().map((f) => f.texto).sort()).toEqual(['de outra sessão', 'fixado pelo usuário', 'manual']);
  });
});

describe('runs.previousStart', () => {
  it('ignores stateless runs and runs that did not finish ok', () => {
    const { db, r } = setup();
    const s = r.sessions.create();
    const at = (id: string, inicio: string) => db.prepare('UPDATE runs SET inicio = ? WHERE id = ?').run(inicio, id);
    const real = r.runs.start({ sessionId: s.id, provedor: 'fake' });
    r.runs.finish(real.id, { status: 'ok' });
    at(real.id, '2026-01-01 10:00:00');
    const summary = r.runs.start({ sessionId: s.id, provedor: 'fake', etapa: 'resumo', semEstado: true });
    r.runs.finish(summary.id, { status: 'ok' });
    at(summary.id, '2026-01-01 10:05:00');
    const failed = r.runs.start({ sessionId: s.id, provedor: 'fake' });
    r.runs.finish(failed.id, { status: 'erro', erro: 'x' });
    at(failed.id, '2026-01-01 10:06:00');
    const current = r.runs.start({ sessionId: s.id, provedor: 'fake' });

    expect(r.runs.previousStart(s.id, current.id)).toBe('2026-01-01 10:00:00');
    expect(r.runs.previousStart(s.id, real.id)).toBeUndefined();
  });
});

describe('repositories', () => {
  it('dedupes blobs by hash and caches descriptions', () => {
    const { r } = setup();
    r.blobs.upsert({ hash: 'h', caminho: 'a', mime: 'image/png', bytes: 1 });
    const again = r.blobs.upsert({ hash: 'h', caminho: 'b', mime: 'image/png', bytes: 2 });
    expect(again.caminho).toBe('a');
    r.blobs.setDescription('h', 'um gráfico', 'texto ocr');
    expect(r.blobs.get('h')).toMatchObject({ descricao: 'um gráfico', ocr: 'texto ocr' });
  });

  it('keeps the previous summary when a new one is stored', () => {
    const { r } = setup();
    const s = r.sessions.create();
    r.sessions.setSummary(s.id, 'v1', 3);
    r.sessions.setSummary(s.id, 'v2', 9);
    expect(r.sessions.get(s.id)).toMatchObject({ resumo: 'v2', resumoAnterior: 'v1', resumoAteMessageId: 9 });
  });

  it('lists the last N messages in order and pages after an id', () => {
    const { r } = setup();
    const s = r.sessions.create();
    const ids = [1, 2, 3, 4].map((i) => r.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: `m${i}` }).id);
    expect(r.messages.lastN(s.id, 2).map((m) => m.conteudo)).toEqual(['m3', 'm4']);
    expect(r.messages.list(s.id, { afterId: ids[1]! }).map((m) => m.conteudo)).toEqual(['m3', 'm4']);
  });

  it('tracks run lifecycle', () => {
    const { r } = setup();
    const s = r.sessions.create();
    const run = r.runs.start({ sessionId: s.id, provedor: 'fake', modelo: 'x' });
    expect(run.status).toBe('rodando');
    r.runs.finish(run.id, { status: 'ok', tokensIn: 10, tokensOut: 5 });
    expect(r.runs.get(run.id)).toMatchObject({ status: 'ok', tokensIn: 10, tokensOut: 5 });
    expect(r.runs.get(run.id)?.fim).not.toBeNull();
  });

  it('filters facts by project, agent and pin', () => {
    const { db, r } = setup();
    db.prepare("INSERT INTO projects (id, nome, pasta) VALUES ('p','P','/p')").run();
    r.facts.add({ texto: 'usar pnpm', projectId: 'p', fixado: true });
    r.facts.add({ texto: 'talvez', projectId: 'p' });
    expect(r.facts.list({ projectId: 'p' })).toHaveLength(2);
    expect(r.facts.list({ projectId: 'p', apenasFixados: true }).map((f) => f.texto)).toEqual(['usar pnpm']);
  });

  it('enforces foreign keys', () => {
    const { r } = setup();
    expect(() => r.messages.add({ sessionId: 'nope', papel: 'usuario', conteudo: 'x' })).toThrow(/FOREIGN KEY/);
  });
});

describe('0012_backfill_numero', () => {
  it('numbers tickets that had no number, per project, after the highest one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-mig-'));
    dirs.push(dir);
    const db = fresh();
    const real = join(__dirname, '..', 'migrations');
    for (const f of readdirSync(real).filter((f) => f < '0012')) copyFileSync(join(real, f), join(dir, f));
    migrate(db, dir);
    db.prepare("INSERT INTO projects (id, nome, pasta) VALUES ('p1','A','/a'), ('p2','B','/b')").run();
    const ins = db.prepare("INSERT INTO tickets (id, project_id, titulo, numero) VALUES (?, ?, 't', ?)");
    ins.run('t1', 'p1', 1);
    ins.run('t2', 'p1', null);
    ins.run('t3', 'p1', null);
    ins.run('t4', 'p2', null);
    expect(migrate(db)).toEqual(['0012_backfill_numero.sql']);
    const n = (id: string) => (db.prepare('SELECT numero FROM tickets WHERE id = ?').get(id) as { numero: number }).numero;
    expect([n('t1'), n('t2'), n('t3'), n('t4')]).toEqual([1, 2, 3, 1]);
  });
});
