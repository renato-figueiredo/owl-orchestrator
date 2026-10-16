/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API in a test */
import { tmpdir } from 'node:os';
import type { ProviderAdapter, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';
import { RouterService } from './router.js';

const mkRepos = () => {
  const db = openDb();
  migrate(db);
  return createRepos(db);
};

describe('QA keep-alive: executor fallback', () => {
  it('the request reused for the fallback provider is still valid for it (keepAlive is only a hint, the model is replaced)', async () => {
    const rp = mkRepos();
    const seen: Array<{ id: string; req: RunRequest }> = [];
    const mk = (id: string, fail: boolean): ProviderAdapter => ({
      id,
      isAvailable: async () => true,
      run: (req) => {
        seen.push({ id, req });
        return (async function* () {
          yield { type: 'start', runId: req.runId ?? '', provider: id } as const;
          if (fail) yield { type: 'error', message: 'ollama: down' } as const;
          else yield { type: 'end', result: 'ok' } as const;
        })();
      },
    });
    const ex = new Executor({ repos: rp, resolveAdapter: (id) => mk(id, id === 'ollama'), localMemoria: () => 'economico' });
    const s = rp.sessions.create({ titulo: 't', cwd: tmpdir() } as any);
    ex.submit({ sessionId: s.id, texto: 'oi', provider: 'ollama', model: 'a:1', cwd: tmpdir(), stateless: true, fallback: { provider: 'claude-cli', model: 'haiku' } });
    await ex.idle();
    expect(seen.map((x) => x.id)).toEqual(['ollama', 'claude-cli']);
    expect(seen[0]!.req.keepAlive).toBe(0);
    expect(seen[1]!.req.model).toBe('haiku');
    expect(seen[1]!.req).not.toHaveProperty('keepAlive');
  });
});

describe('QA keep-alive: setting wiring (buildApp)', () => {
  let app: FastifyInstance;
  afterEach(async () => app.close());

  const boot = async () => {
    const rp = mkRepos();
    const requests: RunRequest[] = [];
    const adapter: ProviderAdapter = {
      id: 'ollama',
      isAvailable: async () => true,
      run: (req) =>
        (async function* () {
          requests.push(req);
          yield { type: 'start', runId: req.runId ?? '', provider: 'ollama' } as const;
          yield { type: 'end', result: 'ok' } as const;
        })(),
    };
    const executor = new Executor({ repos: rp, resolveAdapter: () => adapter });
    app = buildApp({ repos: rp, executor, workspaceRoots: [tmpdir()] });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const put = (b: unknown) => fetch(`${base}/router`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const chat = async () => {
      const s = rp.sessions.create({ titulo: 't', cwd: tmpdir() } as any);
      executor.submit({ sessionId: s.id, texto: 'oi', provider: 'ollama', cwd: tmpdir(), stateless: true });
      await executor.idle();
    };
    return { rp, requests, put, chat, base };
  };

  it('a mode saved through PUT /router is read by the next run, with no restart', async () => {
    const { requests, put, chat } = await boot();
    await chat(); // nothing saved: auto
    expect((await put({ localPequeno: { ativo: false, memoria: 'economico' } })).status).toBe(200);
    await chat();
    expect((await put({ localPequeno: { ativo: false, memoria: 'rapido' } })).status).toBe(200);
    await chat();
    expect(requests.map((r) => r.keepAlive)).toEqual(['5m', 0, '5m']);
  });

  it('PUT /router rejects an invalid memoria and keeps what was saved', async () => {
    const { put, base } = await boot();
    await put({ localPequeno: { ativo: true, memoria: 'economico' } });
    for (const bad of ['sempre', '', 0, null, 5, ['auto'], 'AUTO']) {
      expect((await put({ localPequeno: { ativo: true, memoria: bad } })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await put({ localPequeno: { ativo: true, memoria: 'auto', extra: 1 } })).status).toBe(400);
    const got = (await (await fetch(`${base}/router`)).json()) as any;
    expect(got.router.localPequeno).toEqual({ ativo: true, memoria: 'economico' });
  });

  it('config stored before this field existed (no memoria) loads as is and runs as auto', async () => {
    const { rp, requests, chat, base } = await boot();
    rp.settings.set('router', { tiers: { pequeno: { provedor: 'claude-cli', modelo: 'haiku' }, medio: { provedor: 'claude-cli', modelo: 'sonnet' }, forte: { provedor: 'claude-cli', modelo: 'opus' } }, localPequeno: { ativo: true, modelo: 'gemma4:e2b' }, limiarConfianca: 0.6, orcamentoDiaTokens: null });
    const got = (await (await fetch(`${base}/router`)).json()) as any;
    expect(got.router.localPequeno).toEqual({ ativo: true, modelo: 'gemma4:e2b' });
    await chat();
    expect(requests[0]?.keepAlive).toBe('5m');
  });

  it('a stored invalid memoria only loses itself (ativo and modelo stay) and runs as auto', async () => {
    const { rp, requests, chat } = await boot();
    const router = new RouterService({ repos: rp });
    rp.settings.set('router', { ...router.settings(), localPequeno: { ativo: true, modelo: 'x:1', memoria: 'lixo' } });
    expect(router.settings().localPequeno).toEqual({ ativo: true, modelo: 'x:1' });
    await chat();
    expect(requests[0]?.keepAlive).toBe('5m');
  });
});
