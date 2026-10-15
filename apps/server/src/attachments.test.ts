import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCliAdapter } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { cleanName, parseDescription } from './attachments.js';
import { Executor } from './executor.js';

const FAKE = fileURLToPath(new URL('../../../packages/core/test/fake-cli.mjs', import.meta.url));

let dir: string;
let store: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let scenario: Record<string, string>;
let spawned: Array<{ provider: string; record: string }>;

const rec = (i: number) => JSON.parse(readFileSync(spawned[i]!.record, 'utf8')) as { argv: string[]; stdin: string };

async function setup(maxAttachmentBytes?: number) {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({
    repos,
    resolveAdapter: (id) => {
      const record = join(dir, `rec-${spawned.length}.json`);
      spawned.push({ provider: id, record });
      return createClaudeCliAdapter({
        bin: process.execPath,
        binArgs: [FAKE],
        killGraceMs: 300,
        env: { ...process.env, FAKE_SCENARIO: scenario[id] ?? 'text', FAKE_RECORD: record },
      });
    },
  });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()], attachmentsDir: store, ...(maxAttachmentBytes ? { maxAttachmentBytes } : {}) });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  await fetch(`${base}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memory: { resumidor: { provider: 'codex-cli' }, resumoAutomatico: false } }) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-att-'));
  store = join(dir, 'attachments');
  scenario = { 'codex-cli': 'describe-ok' };
  spawned = [];
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: (await r.json()) as Json };
};
const upload = async (data: Buffer, type = 'image/png', nome?: string) => {
  const r = await fetch(`${base}/attachments${nome !== undefined ? `?nome=${encodeURIComponent(nome)}` : ''}`, { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(data) });
  return { status: r.status, body: (await r.json()) as Json };
};
const png = (w = 40, h = 30, color = '#c00') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const files = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)) : []);
const session = async () => (await json('POST', '/sessions', {})).body.session.id as string;
const say = async (sid: string, body: object) => {
  const r = await json('POST', `/sessions/${sid}/messages`, body);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  await executor.idle();
  await executor.idle(); // the description run is queued by the first one
  return r.body;
};

describe('POST /attachments', () => {
  it('shrinks to WebP (longest side 1500), hashes and stores under ab/hash.webp', async () => {
    await setup();
    const r = await upload(await png(3000, 1000), 'image/png', 'print.png');
    expect(r.status).toBe(201);
    const a = r.body.attachment;
    expect(a).toMatchObject({ mime: 'image/webp', largura: 1500, altura: 500, nome: 'print.png', url: `/attachments/${a.hash}` });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const file = join(store, a.hash.slice(0, 2), `${a.hash}.webp`);
    expect(statSync(file).size).toBe(a.bytes);
    expect((await sharp(file).metadata()).format).toBe('webp');
    expect(files(store)).toEqual([file]);
  });

  it('the same image twice is one file and one blob', async () => {
    await setup();
    const data = await png();
    const a = await upload(data);
    const b = await upload(data, 'image/png', 'outro-nome.png');
    expect(a.body.attachment.hash).toBe(b.body.attachment.hash);
    expect(files(store)).toHaveLength(1);
  });

  it('accepts JPEG and WebP, strips metadata, decides by the bytes not by the Content-Type', async () => {
    await setup();
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0a0' } }).withExif({ IFD0: { Copyright: 'segredo' } }).jpeg().toBuffer();
    const r = await upload(jpeg, 'image/webp'); // wrong declared type: still a valid JPEG
    expect(r.status).toBe(201);
    const stored = readFileSync(join(store, r.body.attachment.hash.slice(0, 2), `${r.body.attachment.hash}.webp`));
    expect(stored.includes(Buffer.from('segredo'))).toBe(false);
    expect((await upload(await sharp({ create: { width: 9, height: 9, channels: 3, background: '#00f' } }).webp().toBuffer(), 'image/webp')).status).toBe(201);
  });

  it('rejects what is not a PNG/JPEG/WebP image', async () => {
    await setup();
    expect((await upload(Buffer.from('isto não é imagem'))).body.error.code).toBe('invalid_image');
    const gif = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#fff' } }).gif().toBuffer();
    expect((await upload(gif)).body.error.code).toBe('unsupported_type');
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
    const svg = await fetch(`${base}/attachments`, { method: 'POST', headers: { 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    expect(svg.status).toBe(415);
    const json_ = await fetch(`${base}/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(json_.status).toBe(415);
    expect(files(store)).toEqual([]);
  });

  it('enforces the configurable size limit', async () => {
    await setup(2000);
    const big = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#123' } }).png({ compressionLevel: 0 }).toBuffer();
    expect(big.length).toBeGreaterThan(2000);
    const r = await upload(big);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('too_large');
  });

  it('malicious file names never reach the file system', async () => {
    await setup();
    const evil = ['../../../etc/passwd', '..\\..\\windows\\win.ini', 'a\u0000b.png', '/abs/olute.png', '..', '\n\r.png'];
    for (const nome of evil) {
      const r = await upload(await png(10 + evil.indexOf(nome), 10), 'image/png', nome);
      expect(r.status, nome).toBe(201);
      expect(r.body.attachment.nome ?? '').not.toMatch(/[\\/\u0000-\u001f]|^\.\.$/);
    }
    // everything written is inside the attachments folder, named by hash only
    for (const f of files(dir)) expect(f.startsWith(store)).toBe(true);
    for (const f of files(store)) expect(f).toMatch(/\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
    expect(cleanName('../../x/y.png')).toBe('y.png');
    expect(cleanName('..')).toBeUndefined();
    expect(cleanName('a'.repeat(500))).toHaveLength(200);
  });
});

describe('GET /attachments/:hash', () => {
  it('serves the stored image with safe headers; bad hashes and traversal are 404', async () => {
    await setup();
    const { hash } = (await upload(await png())).body.attachment;
    const r = await fetch(`${base}/attachments/${hash}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/webp');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).format).toBe('webp');
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'abc', 'g'.repeat(64), '0'.repeat(64), `${hash}.webp`, '%2e%2e']) {
      expect((await fetch(`${base}/attachments/${bad}`)).status, bad).toBe(404);
    }
  });
});

describe('sending images to the model', () => {
  it('first turn: the file goes to the CLI, a cheap model describes it afterwards; later turns send TEXT only', async () => {
    await setup();
    const { hash } = (await upload(await png(), 'image/png', 'erro.png')).body.attachment;
    const sid = await session();

    await say(sid, { texto: 'o que diz o print?', anexos: [{ hash, nome: 'erro.png' }] });
    // run 0: the chat (sees the file), run 1: the describer (also sees it)
    expect(spawned.map((s) => s.provider)).toEqual(['claude-cli', 'codex-cli']);
    const first = rec(0);
    const file = join(store, hash.slice(0, 2), `${hash}.webp`);
    expect(first.argv).toContain(`--add-dir=${join(store, hash.slice(0, 2))}`);
    expect(first.stdin).toContain(file);
    expect(first.stdin.endsWith('o que diz o print?')).toBe(true);
    expect(rec(1).stdin).toContain(file);
    expect(repos.blobs.get(hash)).toMatchObject({ descricao: 'Texto vermelho sobre fundo branco', ocr: 'OWL 4242' });

    // second turn with the same image: described → text, no file, no new description run
    await say(sid, { texto: 'e agora?', anexos: [{ hash, nome: 'erro.png' }] });
    expect(spawned).toHaveLength(3);
    const second = rec(2);
    expect(second.argv.join(' ')).not.toContain('--add-dir');
    expect(second.stdin).not.toContain(file);
    expect(second.stdin).toContain('Texto vermelho sobre fundo branco');
    expect(second.stdin).toContain('OWL 4242');
  });

  it('a failed description is retried on the next use, and the description run never records a message', async () => {
    scenario = { 'codex-cli': 'summary-bad' };
    await setup();
    const { hash } = (await upload(await png())).body.attachment;
    const sid = await session();
    await say(sid, { texto: 'olhe', anexos: [{ hash }] });
    expect(repos.blobs.get(hash)!.descricao).toBeNull();
    expect(repos.messages.list(sid).map((m) => m.papel)).toEqual(['usuario', 'assistente']);
    await say(sid, { texto: 'de novo', anexos: [{ hash }] });
    expect(rec(2).stdin).toContain('enviada junto com este pedido'); // no description yet: the file again
  });

  it('stores the attachment with the message and lists it in the session', async () => {
    await setup();
    const { hash } = (await upload(await png(64, 48))).body.attachment;
    const sid = await session();
    await say(sid, { texto: 'veja', anexos: [{ hash, nome: '../../hack.png' }] });
    const s = (await json('GET', `/sessions/${sid}`)).body;
    const user = s.messages.find((m: Json) => m.papel === 'usuario');
    expect(user.anexos).toEqual([{ hash, nome: 'hack.png', largura: 64, altura: 48, url: `/attachments/${hash}` }]);
    expect(s.messages.find((m: Json) => m.papel === 'assistente').anexos).toBeUndefined();
  });

  it('an image alone is a valid message; empty text without image is not; unknown hashes are refused', async () => {
    await setup();
    const { hash } = (await upload(await png())).body.attachment;
    const sid = await session();
    await say(sid, { texto: '', anexos: [{ hash }] });
    expect(rec(0).stdin).toContain('Veja a imagem anexa.');
    expect((await json('POST', `/sessions/${sid}/messages`, { texto: '' })).status).toBe(400);
    const unknown = await json('POST', `/sessions/${sid}/messages`, { texto: 'x', anexos: [{ hash: 'a'.repeat(64) }] });
    expect(unknown.body.error.code).toBe('attachment_not_found');
    expect((await json('POST', `/sessions/${sid}/messages`, { texto: 'x', anexos: [{ hash: '../../etc/passwd' }] })).status).toBe(400);
    expect(spawned).toHaveLength(2); // chat + description of the first message only
  });

  it('a provider switch hands the model the description of images from the history', async () => {
    await setup();
    const { hash } = (await upload(await png(), 'image/png', 'erro.png')).body.attachment;
    const sid = await session();
    await say(sid, { texto: 'veja o print', anexos: [{ hash, nome: 'erro.png' }] });
    repos.sessions.setCliSession(sid, 'claude-cli', '0ebc5870-da74-48ab-88a4-2e4c4aaeb936');
    const before = spawned.length;
    await say(sid, { texto: 'continue', provider: 'codex-cli' }); // another provider: no native session to resume
    const stdin = rec(before).stdin;
    expect(stdin).toContain('Texto vermelho sobre fundo branco');
    expect(stdin).toContain('erro.png');
  });
});

describe('parseDescription', () => {
  it('accepts plain JSON, fenced JSON and JSON inside text; refuses the rest', () => {
    const ok = { descricao: 'um gato', ocr: 'miau' };
    expect(parseDescription(JSON.stringify(ok))).toEqual(ok);
    expect(parseDescription('```json\n{"descricao":"um gato"}\n```')).toEqual({ descricao: 'um gato' });
    expect(parseDescription('Aqui: {"descricao":"um gato"} pronto')).toEqual({ descricao: 'um gato' });
    for (const bad of ['', 'sem json', '{"descricao":""}', '{"descricao":1}', '[]']) expect(parseDescription(bad)).toBeNull();
  });
});
