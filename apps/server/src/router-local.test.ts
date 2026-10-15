/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API in a test */
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';
import { LocalModels, type LocalProbe } from './local-models.js';
import { RouterService } from './router.js';

const probe = (state: { up: boolean; models: string[] }): LocalProbe => ({
  isAvailable: async () => state.up,
  listModels: async () => state.models.map((name) => ({ name })),
});
const repos = () => {
  const db = openDb();
  migrate(db);
  return createRepos(db);
};

describe('LocalModels', () => {
  it('is unavailable until the first check, and again when the server goes away', async () => {
    const st = { up: true, models: ['a:1', 'b:2'] };
    const l = new LocalModels(probe(st));
    expect(l.pick()).toBeUndefined();
    await l.refresh();
    expect(l.snapshot()).toEqual({ disponivel: true, modelos: ['a:1', 'b:2'] });
    st.up = false;
    await l.refresh();
    expect(l.snapshot()).toEqual({ disponivel: false, modelos: [] });
    expect(l.pick()).toBeUndefined();
  });

  it('treats a probe that throws as unavailable', async () => {
    const l = new LocalModels({ isAvailable: async () => Promise.reject(new Error('x')), listModels: async () => [] });
    expect((await l.refresh()).disponivel).toBe(false);
  });

  it('picks the wanted model, else the environment one, else the first installed', async () => {
    const l = new LocalModels(probe({ up: true, models: ['a:1', 'b:2', 'c:3'] }), 'c:3');
    await l.refresh();
    expect(l.pick('b:2')).toBe('b:2');
    expect(l.pick('ausente')).toBe('c:3');
    expect(new LocalModels(probe({ up: true, models: ['a:1'] }), 'zzz').pick()).toBeUndefined(); // before any check
    const l2 = new LocalModels(probe({ up: true, models: ['a:1'] }), 'zzz');
    await l2.refresh();
    expect(l2.pick()).toBe('a:1');
  });

  it('is unavailable with a server that has no model installed', async () => {
    const l = new LocalModels(probe({ up: true, models: [] }));
    await l.refresh();
    expect(l.pick()).toBeUndefined();
  });
});

describe('RouterService.target with a local model', () => {
  const setup = async (st = { up: true, models: ['gemma4:e2b'] }) => {
    const local = new LocalModels(probe(st));
    await local.refresh();
    return { r: new RouterService({ repos: repos(), local }), st, local };
  };

  it('sends `pequeno` steps without tools to Ollama when it is available', async () => {
    const { r } = await setup();
    expect(r.target('pequeno', { semFerramentas: true })).toEqual({ provedor: 'ollama', modelo: 'gemma4:e2b' });
  });

  it('keeps the configured target for steps with tools, other tiers, no local server and the switch off', async () => {
    const { r, st, local } = await setup();
    expect(r.target('pequeno')).toEqual({ provedor: 'claude-cli', modelo: 'haiku' });
    expect(r.target('pequeno', { semFerramentas: false })).toEqual({ provedor: 'claude-cli', modelo: 'haiku' });
    expect(r.target('medio', { semFerramentas: true })).toEqual({ provedor: 'claude-cli', modelo: 'sonnet' });
    r.save({ localPequeno: { ativo: false } });
    expect(r.target('pequeno', { semFerramentas: true }).provedor).toBe('claude-cli');
    r.save({ localPequeno: { ativo: true } });
    st.up = false;
    await local.refresh();
    expect(r.target('pequeno', { semFerramentas: true }).provedor).toBe('claude-cli');
  });

  it('works without any local-model wiring (tests, other front ends)', () => {
    expect(new RouterService({ repos: repos() }).target('pequeno', { semFerramentas: true }).provedor).toBe('claude-cli');
  });

  it('uses the model chosen in the settings when it is installed', async () => {
    const { r } = await setup({ up: true, models: ['a:1', 'b:2'] });
    r.save({ localPequeno: { ativo: true, modelo: 'b:2' } });
    expect(r.target('pequeno', { semFerramentas: true }).modelo).toBe('b:2');
  });

  it('a damaged localPequeno setting falls back to the default and keeps the rest', async () => {
    const { r } = await setup();
    r.save({ orcamentoDiaTokens: 5000 });
    (r as any).deps.repos.settings.set('router', { ...r.settings(), localPequeno: 'lixo' });
    expect(r.settings().localPequeno).toEqual({ ativo: true });
    expect(r.settings().orcamentoDiaTokens).toBe(5000);
  });
});

describe('GET/PUT /router with a local model', () => {
  let app: FastifyInstance;
  afterEach(async () => app.close());

  it('reports the local state and validates the model name', async () => {
    const st = { up: true, models: ['gemma4:e2b'] };
    const r = repos();
    app = buildApp({ repos: r, executor: new Executor({ repos: r }), workspaceRoots: [tmpdir()], localModels: new LocalModels(probe(st)) });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const body = (await (await fetch(`${base}/router`)).json()) as any;
    expect(body.local).toEqual({ disponivel: true, modelos: ['gemma4:e2b'] });
    expect(body.router.localPequeno).toEqual({ ativo: true });
    const put = (b: unknown) => fetch(`${base}/router`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await put({ localPequeno: { ativo: false } })).status).toBe(200);
    expect((await put({ localPequeno: { ativo: true, modelo: '--x y' } })).status).toBe(400);
    st.up = false;
    expect(((await (await fetch(`${base}/router`)).json()) as any).local.disponivel).toBe(false);
  });
});
