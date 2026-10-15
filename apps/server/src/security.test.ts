import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCliAdapter } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';
import { FolderError, resolveWorkspace } from './security.js';

let root: string;
beforeEach(() => void (root = realpathSync(mkdtempSync(join(tmpdir(), 'owl-sec-')))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeApp(allowedOrigins: string[] = []) {
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const executor = new Executor({ repos });
  return buildApp({ repos, executor, workspaceRoots: [root], allowedOrigins, defaultCwd: root });
}

describe('Host / Origin guard (DNS rebinding and CSRF)', () => {
  const get = (app: ReturnType<typeof makeApp>, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/projects', headers });

  it.each(['127.0.0.1:4317', 'localhost:4317', '[::1]:4317', 'LOCALHOST'])('accepts Host %s', async (host) => {
    expect((await get(makeApp(), { host })).statusCode).toBe(200);
  });

  it.each(['evil.example:4317', 'evil.example', '127.0.0.1.evil.example', 'localhost.evil.example:80'])(
    'refuses a rebound Host %s',
    async (host) => {
      const res = await get(makeApp(), { host });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('forbidden_host');
    },
  );

  it('refuses a cross-site browser POST (Origin of another site) without side effects', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { host: '127.0.0.1:4317', origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { nome: 'x', pasta: root },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden_origin');
    expect((await get(app, { host: '127.0.0.1:4317' })).json().projects).toEqual([]);
  });

  it.each(['null', 'not a url', 'http://localhost:9999', 'http://127.0.0.1:4317.evil.example'])(
    'refuses Origin %s',
    async (origin) => {
      const res = await get(makeApp(), { host: '127.0.0.1:4317', origin });
      expect(res.statusCode).toBe(403);
    },
  );

  it('accepts the server itself as Origin and a configured dev origin', async () => {
    const app = makeApp(['http://localhost:5173/']);
    expect((await get(app, { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317' })).statusCode).toBe(200);
    expect((await get(app, { host: '127.0.0.1:4317', origin: 'http://localhost:5173' })).statusCode).toBe(200);
    expect((await get(app, { host: '127.0.0.1:4317', origin: 'http://localhost:5174' })).statusCode).toBe(403);
  });

  it('also guards the SSE stream and the cancel endpoint', async () => {
    const app = makeApp();
    const bad = { host: 'evil.example' };
    expect((await app.inject({ method: 'GET', url: '/runs/x/stream', headers: bad })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/runs/x/cancel', headers: bad })).statusCode).toBe(403);
  });
});

describe('workspace roots (project folder and cwd allowlist)', () => {
  it('accepts folders inside a root and returns the canonical path', () => {
    mkdirSync(join(root, 'proj'));
    expect(resolveWorkspace(join(root, 'proj'), [root])).toBe(join(root, 'proj'));
    expect(resolveWorkspace(root, [root])).toBe(root);
  });

  it('refuses folders outside every root, including via .. and symlinks', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'owl-out-')));
    try {
      mkdirSync(join(root, 'proj'));
      symlinkSync(outside, join(root, 'proj', 'link'));
      for (const bad of [outside, join(root, 'proj', '..', '..'), join(root, 'proj', 'link')]) {
        expect(() => resolveWorkspace(bad, [root])).toThrow(FolderError);
        try { resolveWorkspace(bad, [root]); } catch (e) { expect((e as FolderError).code).toBe('folder_not_allowed'); }
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses hidden folders below a root and sibling-prefix tricks', () => {
    mkdirSync(join(root, '.ssh'));
    mkdirSync(join(root, 'a', '.config'), { recursive: true });
    mkdirSync(`${root}-evil`);
    try {
      expect(() => resolveWorkspace(join(root, '.ssh'), [root])).toThrow(FolderError);
      expect(() => resolveWorkspace(join(root, 'a', '.config'), [root])).toThrow(FolderError);
      expect(() => resolveWorkspace(`${root}-evil`, [root])).toThrow(FolderError);
    } finally {
      rmSync(`${root}-evil`, { recursive: true, force: true });
    }
  });

  it('refuses missing paths, files and NUL bytes as invalid_folder', () => {
    for (const bad of [join(root, 'nope'), `${root}\0x`]) {
      try { resolveWorkspace(bad, [root]); expect.unreachable(); } catch (e) { expect((e as FolderError).code).toBe('invalid_folder'); }
    }
  });

  it('API: 403 for a project outside the roots, 403 for a cwd outside, and the stored pasta is canonical', async () => {
    const app = makeApp();
    const h = { host: '127.0.0.1:4317', 'content-type': 'application/json' };
    const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: h, payload: payload as object });

    const out = await post('/projects', { nome: 'x', pasta: '/' });
    expect(out.statusCode).toBe(403);
    expect(out.json().error.code).toBe('folder_not_allowed');

    mkdirSync(join(root, 'p'));
    const ok = await post('/projects', { nome: 'p', pasta: join(root, 'p', '..', 'p') });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().project.pasta).toBe(join(root, 'p'));

    const sid = (await post('/sessions', {})).json().session.id as string;
    const bad = await post(`/sessions/${sid}/messages`, { texto: 'oi', cwd: '/etc' });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().error.code).toBe('folder_not_allowed');
    const notDir = await post(`/sessions/${sid}/messages`, { texto: 'oi', cwd: join(root, 'missing') });
    expect(notDir.statusCode).toBe(400);
  });
});

describe('adapter never throws for hostile input (NUL byte)', () => {
  const collect = async (systemAppend?: string, cwd = root) => {
    const adapter = createClaudeCliAdapter({ bin: process.execPath, binArgs: ['-e', '0'] });
    const events = [];
    for await (const e of adapter.run({ prompt: 'x', cwd, ...(systemAppend ? { systemAppend } : {}) }, new AbortController().signal)) events.push(e);
    return events;
  };

  it('NUL in systemAppend yields start + error', async () => {
    const events = await collect('a\0b');
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
  });

  it('NUL in cwd (spawn throws synchronously) still yields start + error', async () => {
    const events = await collect(undefined, `${root}\0x`);
    expect(events[0]?.type).toBe('start');
    expect(events.at(-1)?.type).toBe('error');
    expect(events.filter((e) => ['end', 'error', 'cancelled'].includes(e.type))).toHaveLength(1);
  });
});
