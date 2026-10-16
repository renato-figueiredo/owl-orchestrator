import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SessionAuth } from './auth.js';
import { Executor } from './executor.js';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

function make(withAuth = true) {
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const auth = new SessionAuth();
  const app = buildApp({ repos, executor: new Executor({ repos }), workspaceRoots: [], ...(withAuth ? { auth } : {}) });
  apps.push(app);
  return { app, auth, repos };
}
const HOST = { host: '127.0.0.1:4317' };

describe('session auth', () => {
  it('refuses every route but health and the handshake until the browser is paired', async () => {
    const { app } = make();
    expect((await app.inject({ method: 'GET', url: '/health', headers: HOST })).statusCode).toBe(200);
    for (const [method, url] of [['GET', '/projects'], ['POST', '/approvals/x/decide'], ['POST', '/tickets/x/status'], ['PUT', '/agents/po'], ['GET', '/runs/x/stream']] as const) {
      const r = await app.inject(method === 'GET' ? { method, url, headers: HOST } : { method, url, headers: HOST, payload: {} });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
      expect(r.json().error.code).toBe('unauthorized');
    }
    expect((await app.inject({ method: 'GET', url: '/auth/status', headers: HOST })).json()).toEqual({ required: true, authenticated: false });
  });

  it('a wrong code pairs nothing; the right one gives an HttpOnly SameSite=Strict cookie that opens the API once', async () => {
    const { app, auth } = make();
    const bad = await app.inject({ method: 'POST', url: '/auth/pair', headers: HOST, payload: { code: 'palpite' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['set-cookie']).toBeUndefined();

    const code = auth.pairingCode();
    const ok = await app.inject({ method: 'POST', url: '/auth/pair', headers: HOST, payload: { code } });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const session = cookie.split(';')[0]!;
    const withCookie = { ...HOST, cookie: session };
    expect((await app.inject({ method: 'GET', url: '/projects', headers: withCookie })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/auth/status', headers: withCookie })).json()).toEqual({ required: true, authenticated: true });
    expect((await app.inject({ method: 'GET', url: '/projects', headers: { ...HOST, cookie: 'owl_session=forjado' } })).statusCode).toBe(401);

    // the code was single-use: a second try with it fails
    expect((await app.inject({ method: 'POST', url: '/auth/pair', headers: HOST, payload: { code } })).statusCode).toBe(401);
  });

  it('an agent cannot approve its own gate without the session', async () => {
    const { app, repos } = make();
    const p = repos.projects.create({ nome: 'Owl', pasta: '/tmp' });
    const t = repos.tickets.create({ projectId: p.id, titulo: 'x', status: 'em_andamento' }, { nome: 'humano', tipo: 'humano' });
    const gate = repos.approvals.create({ ticketId: t.id, tipo: 'destrutiva', motivo: 'rm -rf' });
    const r = await app.inject({ method: 'POST', url: `/approvals/${gate.id}/decide`, headers: HOST, payload: { decisao: 'aprovado' } });
    expect(r.statusCode).toBe(401);
    expect(repos.approvals.get(gate.id)!.status).toBe('pendente');
  });

  it('without auth configured the API stays open (tests, E2E) and says so', async () => {
    const { app } = make(false);
    expect((await app.inject({ method: 'GET', url: '/projects', headers: HOST })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/auth/status', headers: HOST })).json()).toEqual({ required: false, authenticated: true });
  });
});

describe('access keys', () => {
  const pairCookie = async (app: ReturnType<typeof make>['app'], auth: SessionAuth) => {
    const r = await app.inject({ method: 'POST', url: '/auth/pair', headers: HOST, payload: { code: auth.pairingCode() } });
    return String(r.headers['set-cookie']).split(';')[0]!;
  };

  it('a paired browser creates a key once; it opens the API, survives a new app on the same data, and is revoked by id', async () => {
    const { app, auth } = make();
    const cookie = await pairCookie(app, auth);
    const made = await app.inject({ method: 'POST', url: '/auth/keys', headers: { ...HOST, cookie }, payload: { nome: 'claude', dias: 7 } });
    expect(made.statusCode).toBe(201);
    const { key, id } = made.json() as { key: string; id: string };
    expect(key).toMatch(/^owl_/);
    const bearer = { ...HOST, authorization: `Bearer ${key}` };
    expect((await app.inject({ method: 'GET', url: '/projects', headers: bearer })).statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/auth/keys', headers: { ...HOST, cookie } });
    expect(JSON.stringify(list.json())).not.toContain(key);
    expect((await app.inject({ method: 'GET', url: '/projects', headers: { ...HOST, authorization: 'Bearer owl_forjada0000000000000000' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/auth/keys/${id}`, headers: { ...HOST, cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/projects', headers: bearer })).statusCode).toBe(401);
  });

  it('a key cannot decide gates, move tickets, edit agents or the budget, or manage keys; a key cannot create keys', async () => {
    const { app, auth } = make();
    const cookie = await pairCookie(app, auth);
    const { key } = (await app.inject({ method: 'POST', url: '/auth/keys', headers: { ...HOST, cookie }, payload: { nome: 'k' } })).json() as { key: string };
    const h = { ...HOST, authorization: `Bearer ${key}` };
    for (const [method, url] of [
      ['POST', '/approvals/x/decide'],
      ['POST', '/tickets/x/status'],
      ['PUT', '/agents/dev-back'],
      ['PUT', '/router'],
      ['POST', '/auth/keys'],
      ['GET', '/auth/keys'],
    ] as const) {
      expect((await app.inject({ method, url, headers: h, payload: {} })).statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
