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
    r.save({ localPequeno: { ativo: true } });
    expect(r.target('pequeno', { semFerramentas: true })).toEqual({ provedor: 'ollama', modelo: 'gemma4:e2b' });
  });

  it('stores and returns the memory mode, and a bad stored mode falls back without losing the rest', async () => {
    const { r } = await setup();
    expect(r.save({ localPequeno: { ativo: true, memoria: 'economico' } }).localPequeno.memoria).toBe('economico');
    expect(r.settings().localPequeno).toEqual({ ativo: true, memoria: 'economico' });
    expect(() => r.save({ localPequeno: { ativo: true, memoria: 'sempre' as never } })).toThrow();
  });

  it('keeps the configured target for steps with tools, other tiers, no local server and the switch off', async () => {
    const { r, st, local } = await setup();
    r.save({ localPequeno: { ativo: true } });
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
    expect(r.settings().localPequeno).toEqual({ ativo: false });
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
    expect(body.router.localPequeno).toEqual({ ativo: false });
    const put = (b: unknown) => fetch(`${base}/router`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await put({ localPequeno: { ativo: false } })).status).toBe(200);
    expect((await put({ localPequeno: { ativo: true, modelo: '--x y' } })).status).toBe(400);
    st.up = false;
    expect(((await (await fetch(`${base}/router`)).json()) as any).local.disponivel).toBe(false);
  });
});

describe('QA: board-flow wiring of semFerramentas', () => {
  it('refreshLocal updates what target() sees without a periodic tick', async () => {
    const st = { up: false, models: ['gemma4:e2b'] };
    const local = new LocalModels(probe(st));
    const r = new RouterService({ repos: repos(), local });
    r.save({ localPequeno: { ativo: true } });
    expect(r.target('pequeno', { semFerramentas: true }).provedor).toBe('claude-cli');
    st.up = true;
    await r.refreshLocal();
    expect(r.target('pequeno', { semFerramentas: true })).toEqual({ provedor: 'ollama', modelo: 'gemma4:e2b' });
    expect(r.localStatus()).toEqual({ disponivel: true, modelos: ['gemma4:e2b'] });
  });
  it('localStatus without wiring is unavailable', () => {
    expect(new RouterService({ repos: repos() }).localStatus()).toEqual({ disponivel: false, modelos: [] });
  });
  it('never routes medio/forte locally even when allowed', async () => {
    const local = new LocalModels(probe({ up: true, models: ['a:1'] }));
    await local.refresh();
    const r = new RouterService({ repos: repos(), local });
    expect(r.target('forte', { semFerramentas: true }).provedor).toBe('claude-cli');
  });
});

describe('local model default and fallback', () => {
  it('is off by default: a tier never changes provider without being asked', async () => {
    const local = new LocalModels(probe({ up: true, models: ['a:1'] }));
    await local.refresh();
    const r = new RouterService({ repos: repos(), local });
    expect(r.settings().localPequeno.ativo).toBe(false);
    expect(r.target('pequeno', { semFerramentas: true }).provedor).toBe('claude-cli');
  });

  it('markLocalDown stops routing to it and fallbackFor names the configured target', async () => {
    const local = new LocalModels(probe({ up: true, models: ['a:1'] }));
    await local.refresh();
    const r = new RouterService({ repos: repos(), local });
    r.save({ localPequeno: { ativo: true } });
    expect(r.target('pequeno', { semFerramentas: true }).provedor).toBe('ollama');
    const fb = r.fallbackFor('pequeno');
    expect(fb).toMatchObject({ provider: 'claude-cli', model: 'haiku' });
    fb.onUsed();
    expect(r.target('pequeno', { semFerramentas: true }).provedor).toBe('claude-cli');
  });
});

describe('Executor fallback from the local model', () => {
  const run = async (script: Array<(req: any) => any[]>, fallback = true) => {
    const rp = repos();
    const seen: string[] = [];
    let used = 0;
    const adapter = (id: string, events: (req: any) => any[]) => ({
      id,
      isAvailable: async () => true,
      run: (req: any) => {
        seen.push(`${id}:${req.model ?? ''}`);
        return (async function* () {
          yield { type: 'start', runId: req.runId, provider: id };
          for (const e of events(req)) yield e;
        })();
      },
    });
    const ex = new Executor({
      repos: rp,
      resolveAdapter: (id) => adapter(id, script[id === 'ollama' ? 0 : 1]!) as any,
    });
    const s = rp.sessions.create({ titulo: 't', cwd: tmpdir() } as any);
    const run1 = ex.submit({
      sessionId: s.id,
      texto: 'oi',
      provider: 'ollama',
      model: 'a:1',
      cwd: tmpdir(),
      stateless: true,
      ...(fallback ? { fallback: { provider: 'claude-cli', model: 'haiku', onUsed: () => void used++ } } : {}),
    });
    await ex.idle();
    return { rp, run: rp.runs.get(run1.id)!, seen, used, msgs: rp.messages.list(s.id) };
  };

  it('reruns on the configured provider when the local run fails before any text', async () => {
    const r = await run([() => [{ type: 'error', message: 'ollama: could not reach http://127.0.0.1:11434: refused' }], () => [{ type: 'text', delta: 'ok' }, { type: 'end', result: 'ok' }]]);
    expect(r.run.status).toBe('ok');
    expect(r.run.provedor).toBe('claude-cli');
    expect(r.run.modelo).toBe('haiku');
    expect(r.seen).toEqual(['ollama:a:1', 'claude-cli:haiku']);
    expect(r.used).toBe(1);
    expect(r.msgs.some((m: any) => m.papel === 'sistema' && /modelo local falhou/.test(m.conteudo))).toBe(true);
  });

  it('does not rerun once text was produced, nor without a fallback', async () => {
    const partial = await run([() => [{ type: 'text', delta: 'x' }, { type: 'error', message: 'ollama: stream broke' }], () => [{ type: 'end', result: 'no' }]]);
    expect(partial.run.status).toBe('erro');
    expect(partial.seen).toEqual(['ollama:a:1']);
    const none = await run([() => [{ type: 'error', message: 'down' }], () => [{ type: 'end', result: 'no' }]], false);
    expect(none.run.status).toBe('erro');
    expect(none.seen).toEqual(['ollama:a:1']);
  });
});
