import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSnapshot, createRepos, migrate, openDb, type Db } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { BackupService, type Tool } from './backup.js';
import { CleanupService } from './cleanup.js';
import { Executor } from './executor.js';
import { restoreBackup } from './restore.js';

let dir: string;
let store: string;
let db: Db;
let repos: ReturnType<typeof createRepos>;
let executor: Executor;
let cleanup: CleanupService;
let app: FastifyInstance;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'owl-clean-'));
  store = join(dir, 'attachments');
  db = openDb(join(dir, 'owl.sqlite'));
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({ repos });
  cleanup = new CleanupService({ db, repos, dir: store, isBusy: (id) => executor.hasActive(id) });
  app = buildApp({ repos, executor, workspaceRoots: [tmpdir()], attachmentsDir: store, cleanup });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: (await r.json()) as Json };
};
const png = (color: string) => sharp({ create: { width: 30, height: 20, channels: 3, background: color } }).png().toBuffer();
const upload = async (color: string): Promise<string> => {
  const r = await fetch(`${base}/attachments`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(await png(color)) });
  return ((await r.json()) as Json).attachment.hash;
};
const files = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)) : []);
const fileOf = (hash: string) => join(store, hash.slice(0, 2), `${hash}.webp`);
/** A conversation with one user message carrying the given images. */
function chat(...hashes: string[]): string {
  const s = repos.sessions.create({ titulo: 'x' });
  const m = repos.messages.add({ sessionId: s.id, papel: 'usuario', conteudo: 'olha' });
  for (const h of hashes) repos.attachments.add({ messageId: m.id, blobHash: h });
  return s.id;
}
const age = (days: number) => db.prepare("UPDATE sessions SET deleted_at = datetime('now', ?) WHERE deleted_at IS NOT NULL").run(`-${days} days`);

describe('trash and purge', () => {
  it('DELETE moves to the trash, the list hides it, restore brings it back', async () => {
    const id = chat();
    expect((await json('DELETE', `/sessions/${id}`)).status).toBe(200);
    expect((await json('GET', '/sessions')).body.sessions).toHaveLength(0);
    expect((await json('GET', '/sessions?trash=1')).body.sessions.map((s: Json) => s.id)).toEqual([id]);
    expect((await json('GET', `/sessions/${id}`)).status).toBe(404);
    expect((await json('POST', `/sessions/${id}/restore`)).status).toBe(200);
    expect((await json('GET', '/sessions')).body.sessions).toHaveLength(1);
    expect((await json('POST', `/sessions/${id}/restore`)).status).toBe(404); // not in the trash anymore
  });

  it('refuses to delete a conversation while a run is in progress', async () => {
    const id = chat();
    repos.runs.start({ sessionId: id, provedor: 'claude-cli' });
    expect((await json('DELETE', `/sessions/${id}`)).status).toBe(409);
    expect(repos.sessions.get(id)?.deletedAt).toBeNull();
  });

  it('after the purge no image exclusive to the conversation stays on disk', async () => {
    const own = await upload('#c00');
    const id = chat(own);
    await json('DELETE', `/sessions/${id}`);
    expect(files(store)).toHaveLength(1);
    const r = await json('DELETE', `/trash/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.result.blobsRemoved).toBe(1);
    expect(files(store)).toEqual([]);
    expect(existsSync(store) ? readdirSync(store) : []).toEqual([]); // the shard folder went too
    expect(repos.blobs.get(own)).toBeUndefined();
    expect(repos.sessions.get(id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });

  it('an image shared with another conversation is NOT deleted', async () => {
    const shared = await upload('#0a0');
    const exclusive = await upload('#00c');
    const a = chat(shared, exclusive);
    const b = chat(shared);
    await json('DELETE', `/sessions/${a}`);
    const r = await json('DELETE', `/trash/${a}`);
    expect(r.body.result.blobsRemoved).toBe(1);
    expect(existsSync(fileOf(shared))).toBe(true);
    expect(existsSync(fileOf(exclusive))).toBe(false);
    expect(repos.blobs.get(shared)).toBeDefined();
    expect(repos.attachments.blobHashesOfSession(b)).toEqual([shared]);
  });

  it('only a trashed conversation can be purged', async () => {
    const id = chat();
    expect((await json('DELETE', `/trash/${id}`)).status).toBe(409);
    expect(repos.sessions.get(id)).toBeDefined();
    expect((await json('DELETE', '/trash/nope')).status).toBe(404);
  });

  it('removes the facts the summarizer extracted but keeps the pinned ones', async () => {
    const id = chat();
    const run = repos.runs.start({ sessionId: id, provedor: 'claude-cli' });
    repos.runs.finish(run.id, { status: 'ok' });
    const auto = repos.facts.add({ texto: 'auto', origemRunId: run.id });
    const pinned = repos.facts.add({ texto: 'fixo', origemRunId: run.id, fixado: true });
    await json('DELETE', `/sessions/${id}`);
    await json('DELETE', `/trash/${id}`);
    expect(repos.facts.get(auto.id)).toBeUndefined();
    expect(repos.facts.get(pinned.id)).toBeDefined();
  });

  it('tells the interface when the CLI keeps its own transcript', async () => {
    const id = chat();
    repos.sessions.setCliSession(id, 'claude-cli', 'abc-123');
    await json('DELETE', `/sessions/${id}`);
    const r = await json('DELETE', `/trash/${id}`);
    expect(r.body.result.cliSession).toEqual({ provider: 'claude-cli', id: 'abc-123' });
  });

  it('automatic purge uses the retention setting; "empty the trash" takes everything', async () => {
    const old = chat();
    const recent = chat();
    await json('DELETE', `/sessions/${old}`);
    await json('DELETE', `/sessions/${recent}`);
    db.prepare("UPDATE sessions SET deleted_at = datetime('now', '-40 days') WHERE id = ?").run(old);
    expect(cleanup.purgeExpired()).toMatchObject({ purged: 1 });
    expect(repos.sessions.get(old)).toBeUndefined();
    expect(repos.sessions.get(recent)).toBeDefined();

    await json('PUT', '/settings', { lixeira: { diasRetencao: 1 } });
    age(2);
    expect(cleanup.purgeExpired()).toMatchObject({ purged: 1 });

    const again = chat();
    await json('DELETE', `/sessions/${again}`);
    cleanup.saveSettings({ purgaAutomatica: false, diasRetencao: 1 });
    age(5);
    expect(cleanup.purgeExpired().purged).toBe(0);
    expect((await json('DELETE', '/trash')).body.result.purged).toBe(1);
  });

  it('settings are validated and persisted', async () => {
    expect((await json('PUT', '/settings', { lixeira: { diasRetencao: 0 } })).status).toBe(400);
    const r = await json('PUT', '/settings', { lixeira: { diasRetencao: 7 } });
    expect(r.body.lixeira).toEqual({ diasRetencao: 7, purgaAutomatica: true });
    expect((await json('GET', '/settings')).body.lixeira.diasRetencao).toBe(7);
    expect((await json('GET', '/settings')).body.memory).toBeDefined();
  });
});

describe('sweep', () => {
  it('removes an orphan blob and its file, but not a fresh upload or a referenced image', async () => {
    const used = await upload('#111');
    const fresh = await upload('#222');
    const stale = await upload('#333');
    chat(used);
    db.prepare("UPDATE blobs SET visto_em = datetime('now', '-2 hours') WHERE hash = ?").run(stale);
    const report = cleanup.sweep();
    expect(report.orphanBlobs).toBe(1);
    expect(existsSync(fileOf(stale))).toBe(false);
    expect(repos.blobs.get(stale)).toBeUndefined();
    expect(existsSync(fileOf(fresh))).toBe(true); // uploaded but not sent yet
    expect(existsSync(fileOf(used))).toBe(true);
  });

  it('uploading an old orphan again protects it', async () => {
    const h = await upload('#444');
    db.prepare("UPDATE blobs SET visto_em = datetime('now', '-2 hours') WHERE hash = ?").run(h);
    expect(await upload('#444')).toBe(h);
    expect(cleanup.sweep().orphanBlobs).toBe(0);
  });

  it('removes stray files and stale temp files, never touches anything else, ignores symlinks', async () => {
    const keep = await upload('#555');
    chat(keep);
    const hash = 'ab'.repeat(32);
    const stray = join(store, 'ab', `${hash}.webp`);
    const tmp = join(store, 'ab', `${hash}.webp.123.tmp`);
    const foreign = join(store, 'ab', 'notes.txt');
    const fresh = join(store, 'ab', `${'cd'.repeat(32)}.webp`);
    mkdirSync(join(store, 'ab'), { recursive: true });
    for (const f of [stray, tmp, foreign, fresh]) writeFileSync(f, 'x');
    const old = new Date(Date.now() - 2 * 3600_000);
    for (const f of [stray, tmp, foreign]) utimesSync(f, old, old);
    const outside = join(dir, 'outside.webp');
    writeFileSync(outside, 'precious');
    const { symlinkSync } = await import('node:fs');
    symlinkSync(outside, join(store, 'ab', `${'ef'.repeat(32)}.webp`));
    const report = cleanup.sweep();
    expect(report.strayFiles).toBe(2);
    expect(existsSync(stray)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe('precious');
    expect(existsSync(fileOf(keep))).toBe(true);
  });

  it('reports rows whose file is missing instead of deleting them', async () => {
    const h = await upload('#666');
    chat(h);
    rmSync(fileOf(h));
    expect(cleanup.sweep().missingFiles).toBe(1);
    expect(repos.blobs.get(h)).toBeDefined();
  });

  it('gives free pages back (incremental vacuum)', async () => {
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
    const id = chat();
    const big = 'x'.repeat(2000);
    for (let i = 0; i < 400; i++) repos.messages.add({ sessionId: id, papel: 'usuario', conteudo: big });
    const before = db.pragma('page_count', { simple: true }) as number;
    await json('DELETE', `/sessions/${id}`);
    await json('DELETE', `/trash/${id}`);
    const after = db.pragma('page_count', { simple: true }) as number;
    expect(after).toBeLessThan(before);
    expect(db.pragma('freelist_count', { simple: true })).toBe(0);
  });

  it('POST /maintenance/sweep runs it on demand', async () => {
    const r = await json('POST', '/maintenance/sweep');
    expect(r.body.report).toMatchObject({ orphanBlobs: 0, strayFiles: 0 });
  });
});

describe('without the services', () => {
  it('answers 501 instead of failing', async () => {
    const bare = buildApp({ repos, executor, workspaceRoots: [tmpdir()] });
    const url = await bare.listen({ host: '127.0.0.1', port: 0 });
    try {
      expect((await fetch(`${url}/backups`)).status).toBe(501);
      expect((await fetch(`${url}/maintenance/sweep`, { method: 'POST' })).status).toBe(501);
    } finally {
      await bare.close();
    }
  });
});

// ---- backup ---------------------------------------------------------------------------------------------------

/** Fake `age` and `rclone`: a node script is the "binary". */
function fakeTools(): { age: Tool; rclone: Tool; remote: string } {
  const remote = join(dir, 'remote');
  mkdirSync(remote);
  const age = join(dir, 'fake-age.mjs');
  writeFileSync(
    age,
    `import { readFileSync, writeFileSync } from 'node:fs';
const a = process.argv.slice(2);
const at = (f) => a[a.indexOf(f) + 1];
if (a.includes('-d')) {
  if (!existsKey(at('-i'))) { console.error('no identity'); process.exit(1); }
  writeFileSync(at('-o'), readFileSync(a.at(-1)).subarray(7));
} else {
  if (process.env.FAKE_AGE_FAIL) { console.error('boom'); process.exit(1); }
  writeFileSync(at('-o'), Buffer.concat([Buffer.from('AGE:' + at('-r').slice(0, 3)), readFileSync(a.at(-1))]));
}
function existsKey(f) { try { readFileSync(f); return true; } catch { return false; } }
`,
  );
  const rclone = join(dir, 'fake-rclone.mjs');
  writeFileSync(
    rclone,
    `import { copyFileSync } from 'node:fs';
const [cmd, src, dst] = process.argv.slice(2);
if (cmd !== 'copyto') process.exit(2);
copyFileSync(src, dst.replace(/^fake:/, ${JSON.stringify(remote + '/')}));
`,
  );
  return { age: { bin: process.execPath, binArgs: [age] }, rclone: { bin: process.execPath, binArgs: [rclone] }, remote };
}

describe('backup', () => {
  const RECIPIENT = 'age1' + 'q'.repeat(58);
  const day = (d: string) => () => new Date(`${d}T12:00:00Z`);

  it('a snapshot opens and contains the data', async () => {
    const id = chat();
    const b = new BackupService({ db, repos, dir: join(dir, 'backups'), now: day('2026-10-15') });
    const st = await b.run();
    expect(st).toMatchObject({ ok: true, arquivo: 'owl-2026-10-15.db', criptografado: false, enviado: false });
    const file = join(dir, 'backups', 'owl-2026-10-15.db');
    expect(checkSnapshot(file)).toMatchObject({ ok: true, sessions: 1, messages: 1 });
    expect(files(join(dir, 'backups'))).toEqual([file]); // no temp file left
    expect(statSync(join(dir, 'backups')).mode & 0o077).toBe(0);
    void id;
  });

  it('keeps the newest N snapshots', async () => {
    const backups = join(dir, 'backups');
    const b = new BackupService({ db, repos, dir: backups });
    b.saveSettings({ retencao: 2 });
    for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) await new BackupService({ db, repos, dir: backups, now: day(d) }).run();
    expect(b.list().map((f) => f.nome)).toEqual(['owl-2026-10-12.db', 'owl-2026-10-11.db']);
  });

  it('is off by default: tick does nothing until enabled, then respects the interval', async () => {
    let now = new Date('2026-10-15T08:00:00Z');
    const b = new BackupService({ db, repos, dir: join(dir, 'backups'), now: () => now });
    expect(b.settings()).toEqual({ ativo: false, retencao: 14, intervaloHoras: 24 });
    expect(await b.tick()).toBeUndefined();
    expect(b.list()).toEqual([]);
    b.saveSettings({ ativo: true });
    expect((await b.tick())?.ok).toBe(true);
    now = new Date('2026-10-15T20:00:00Z');
    expect(await b.tick()).toBeUndefined(); // 12 h < 24 h
    now = new Date('2026-10-16T09:00:00Z');
    expect((await b.tick())?.arquivo).toBe('owl-2026-10-16.db');
  });

  it('encrypts with age, removes the plaintext and ships only the encrypted file', async () => {
    chat();
    const t = fakeTools();
    const backups = join(dir, 'backups');
    const b = new BackupService({ db, repos, dir: backups, recipient: RECIPIENT, remote: 'fake:bucket', age: t.age, rclone: t.rclone, now: day('2026-10-15') });
    // fake rclone maps "fake:" onto the folder; "bucket/" is part of the name
    mkdirSync(join(t.remote, 'bucket'));
    const st = await b.run();
    expect(st).toMatchObject({ ok: true, arquivo: 'owl-2026-10-15.db.age', criptografado: true, enviado: true });
    expect(readdirSync(backups)).toEqual(['owl-2026-10-15.db.age']);
    expect(readFileSync(join(backups, 'owl-2026-10-15.db.age')).subarray(0, 4).toString()).toBe('AGE:');
    expect(readdirSync(join(t.remote, 'bucket'))).toEqual(['owl-2026-10-15.db.age']);
  });

  it('a failing age leaves no plaintext behind and is reported', async () => {
    const t = fakeTools();
    process.env.FAKE_AGE_FAIL = '1';
    try {
      const b = new BackupService({ db, repos, dir: join(dir, 'backups'), recipient: RECIPIENT, age: t.age });
      const st = await b.run();
      expect(st.ok).toBe(false);
      expect(st.erro).toMatch(/age failed.*boom/);
      expect(readdirSync(join(dir, 'backups'))).toEqual([]);
      expect(b.lastStatus()?.ok).toBe(false);
    } finally {
      delete process.env.FAKE_AGE_FAIL;
    }
  });

  it('refuses to upload an unencrypted snapshot', async () => {
    const t = fakeTools();
    const b = new BackupService({ db, repos, dir: join(dir, 'backups'), remote: 'fake:bucket', rclone: t.rclone });
    const st = await b.run();
    expect(st).toMatchObject({ ok: false });
    expect(st.erro).toMatch(/unencrypted/);
    expect(readdirSync(t.remote)).toEqual([]);
  });

  it('reports a missing binary instead of crashing', async () => {
    const b = new BackupService({ db, repos, dir: join(dir, 'backups'), recipient: RECIPIENT, age: { bin: join(dir, 'no-such-age') } });
    const st = await b.run();
    expect(st.erro).toMatch(/failed to start/);
  });

  it('routes: list, run now, settings; the environment is reported as booleans only', async () => {
    const backups = join(dir, 'backups');
    const b = new BackupService({ db, repos, dir: backups, recipient: RECIPIENT, age: fakeTools().age });
    const withBackup = buildApp({ repos, executor, workspaceRoots: [tmpdir()], cleanup, backup: b });
    const url = await withBackup.listen({ host: '127.0.0.1', port: 0 });
    try {
      const get = async (p: string, init?: RequestInit) => {
        const r = await fetch(url + p, init);
        return { status: r.status, body: (await r.json()) as Json };
      };
      const post = (p: string) => get(p, { method: 'POST' });
      const list = (await get('/backups')).body;
      expect(list).toMatchObject({ settings: { ativo: false }, destinos: { criptografia: true, envio: false }, ultimo: null, arquivos: [] });
      expect(JSON.stringify(list)).not.toContain(RECIPIENT);
      expect((await post('/backups')).status).toBe(201);
      expect((await get('/backups')).body.arquivos).toHaveLength(1);
      const put = await get('/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backup: { ativo: true, retencao: 3 } }) });
      expect(put.body.backup).toEqual({ ativo: true, retencao: 3, intervaloHoras: 24 });
      expect((await get('/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backup: { retencao: 0 } }) })).status).toBe(400);
    } finally {
      await withBackup.close();
    }
  });
});

describe('restore', () => {
  it('restores a snapshot into an empty folder and the data is there', async () => {
    chat();
    chat();
    const b = new BackupService({ db, repos, dir: join(dir, 'backups') });
    await b.run();
    const target = join(dir, 'restored');
    const r = await restoreBackup({ file: join(dir, 'backups', b.list()[0]!.nome), dataDir: target });
    expect(r).toMatchObject({ sessions: 2, messages: 2 });
    const copy = openDb(join(target, 'owl.sqlite'));
    migrate(copy);
    expect(createRepos(copy).sessions.list()).toHaveLength(2);
    copy.close();
  });

  it('decrypts an age snapshot with the identity file', async () => {
    chat();
    const t = fakeTools();
    const b = new BackupService({ db, repos, dir: join(dir, 'backups'), recipient: 'age1' + 'q'.repeat(58), age: t.age });
    await b.run();
    const file = join(dir, 'backups', b.list()[0]!.nome);
    await expect(restoreBackup({ file, dataDir: join(dir, 'r1'), age: t.age })).rejects.toThrow(/--identity/);
    const key = join(dir, 'key.txt');
    writeFileSync(key, 'AGE-SECRET-KEY-fake');
    const r = await restoreBackup({ file, dataDir: join(dir, 'r1'), identity: key, age: t.age });
    expect(r.sessions).toBe(1);
    expect(readdirSync(join(dir, 'r1'))).toEqual(['owl.sqlite']); // no temp file
  });

  it('keeps the database that was there and refuses garbage without touching anything', async () => {
    const data = join(dir, 'live');
    mkdirSync(data);
    writeFileSync(join(data, 'owl.sqlite'), 'current');
    writeFileSync(join(data, 'owl.sqlite-wal'), 'wal');
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'this is not sqlite');
    await expect(restoreBackup({ file: junk, dataDir: data })).rejects.toThrow(/usable snapshot/);
    expect(readFileSync(join(data, 'owl.sqlite'), 'utf8')).toBe('current');
    expect(readdirSync(data).sort()).toEqual(['owl.sqlite', 'owl.sqlite-wal']);

    const good = new BackupService({ db, repos, dir: join(dir, 'backups'), now: () => new Date('2026-10-15T12:00:00Z') });
    await good.run();
    const r = await restoreBackup({ file: join(dir, 'backups', good.list()[0]!.nome), dataDir: data, now: () => new Date('2026-10-16T01:02:03Z') });
    expect(r.previous).toBe('owl.sqlite.before-restore-2026-10-16T01-02-03-000Z');
    expect(readFileSync(join(data, r.previous!), 'utf8')).toBe('current');
    expect(existsSync(join(data, 'owl.sqlite-wal'))).toBe(false);
    expect(checkSnapshot(join(data, 'owl.sqlite')).ok).toBe(true);
  });

  it('a missing file is a clear error', async () => {
    await expect(restoreBackup({ file: join(dir, 'nope.db'), dataDir: dir })).rejects.toThrow(/not found/i);
  });
});
