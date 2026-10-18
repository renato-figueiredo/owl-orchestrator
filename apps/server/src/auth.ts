import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { createRepos } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

type Repos = ReturnType<typeof createRepos>;

const COOKIE = 'owl_session';
const KEYS = 'api_keys';
const KEY_PREFIX = 'owl_';
const MAX_KEYS = 20;
/**
 * What an access key cannot do, whatever its owner: decide gates, widen what agents or the budget may do, move a ticket by
 * hand (which closes its gates) or manage keys. The person at a paired browser keeps all of these.
 */
const KEY_DENIED: Array<[RegExp, string[]]> = [
  [/^\/approvals\/[^/]+\/decide$/, ['POST']],
  [/^\/tickets\/[^/]+\/status$/, ['POST']],
  [/^\/auth\/keys/, ['POST', 'PUT', 'DELETE', 'GET']],
  [/^\/agents(\/|$)/, ['PUT', 'POST', 'DELETE']],
  [/^\/router$/, ['PUT']],
  [/^\/router\/ollama\/start$/, ['POST']],
  [/^\/git\/(clone|init)$/, ['POST']],
  [/^\/projects\/[^/]+\/git\/(remote|publish)$/, ['POST']],
];

interface StoredKey {
  id: string;
  nome: string;
  hash: string;
  criadoEm: string;
  expiraEm: string;
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/** Long-lived access keys for programs a person chose to trust (an agent session, a script). Only their hash is stored. */
export class AccessKeys {
  constructor(private readonly repos: Repos) {}

  private all(): StoredKey[] {
    const v = this.repos.settings.get(KEYS);
    return Array.isArray(v) ? (v as StoredKey[]) : [];
  }

  list(): Array<Omit<StoredKey, 'hash'>> {
    return this.all().map((k) => ({ id: k.id, nome: k.nome, criadoEm: k.criadoEm, expiraEm: k.expiraEm }));
  }

  /** The secret is returned here and nowhere else. */
  create(nome: string, dias: number, now = new Date()): { key: string; id: string; expiraEm: string } {
    const live = this.all().filter((k) => Date.parse(k.expiraEm) > now.getTime());
    if (live.length >= MAX_KEYS) throw new Error(`At most ${MAX_KEYS} active keys; revoke one first`);
    const key = KEY_PREFIX + token();
    const expiraEm = new Date(now.getTime() + dias * 86_400_000).toISOString();
    const id = randomUUID();
    this.repos.settings.set(KEYS, [...live, { id, nome, hash: sha(key), criadoEm: now.toISOString(), expiraEm }]);
    return { key, id, expiraEm };
  }

  revoke(id: string): boolean {
    const all = this.all();
    const rest = all.filter((k) => k.id !== id);
    if (rest.length === all.length) return false;
    this.repos.settings.set(KEYS, rest);
    return true;
  }

  /** True when `Authorization: Bearer owl_…` is a known, unexpired key. */
  valid(header: string | undefined, now = new Date()): boolean {
    const m = /^Bearer (owl_[A-Za-z0-9_-]{20,100})$/.exec(header ?? '');
    if (!m) return false;
    const h = sha(m[1]!);
    const hit = this.all().find((k) => equal(k.hash, h));
    if (!hit || Date.parse(hit.expiraEm) <= now.getTime()) return false;
    return true;
  }
}
/** Reachable without a session: liveness and the pairing handshake itself. */
const OPEN = new Set(['/health', '/auth/status', '/auth/pair']);

const token = () => randomBytes(32).toString('base64url');

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Proves that a request comes from the person at the browser, not from a program on the same machine (an agent with
 * a shell can `curl 127.0.0.1` too, and would otherwise approve its own gates). The server prints a one-time pairing
 * code in ITS console, which agents never see; the browser trades it for an HttpOnly, SameSite=Strict cookie.
 * Sessions live in memory: restarting the server asks to pair again.
 */
export class SessionAuth {
  private code = token();
  private readonly sessions = new Set<string>();

  /** The code to hand to the person (printed at startup). Valid until used. */
  pairingCode(): string {
    return this.code;
  }

  /** Trades the code for a session id, or undefined when the code is wrong. A used code is replaced. */
  pair(code: string): string | undefined {
    if (!equal(code, this.code)) return undefined;
    this.code = token();
    const id = token();
    this.sessions.add(id);
    return id;
  }

  valid(cookieHeader: string | undefined): boolean {
    for (const part of (cookieHeader ?? '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === COOKIE && this.sessions.has(rest.join('='))) return true;
    }
    return false;
  }
}

/** Refuses every route but `OPEN` without a paired session, and serves the pairing handshake. */
export function registerAuth(app: FastifyInstance, auth: SessionAuth, keys?: AccessKeys): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (OPEN.has(path) || auth.valid(req.headers.cookie)) return;
    if (keys?.valid(req.headers.authorization)) {
      if (!KEY_DENIED.some(([re, methods]) => re.test(path) && methods.includes(req.method))) return;
      return reply.status(403).send({ error: { code: 'key_not_allowed', message: 'An access key cannot do this; a paired browser must' } });
    }
    return reply.status(401).send({ error: { code: 'unauthorized', message: 'Pair this browser with the server first' } });
  });

  if (keys) {
    const create = z.object({ nome: z.string().trim().min(1).max(80), dias: z.number().int().min(1).max(365).default(30) });
    app.get('/auth/keys', async () => ({ chaves: keys.list() }));
    app.post('/auth/keys', async (req, reply) => {
      const body = create.parse(req.body);
      try {
        return reply.status(201).send(keys.create(body.nome, body.dias));
      } catch (e) {
        return reply.status(409).send({ error: { code: 'too_many_keys', message: e instanceof Error ? e.message : String(e) } });
      }
    });
    app.delete('/auth/keys/:id', async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
      return keys.revoke(id) ? reply.status(204).send() : reply.status(404).send({ error: { code: 'not_found', message: 'No such key' } });
    });
  }

  app.get('/auth/status', async (req) => ({ required: true, authenticated: auth.valid(req.headers.cookie) }));

  app.post('/auth/pair', async (req, reply) => {
    const { code } = z.object({ code: z.string().min(1).max(200) }).parse(req.body);
    const id = auth.pair(code.trim());
    if (!id) return reply.status(401).send({ error: { code: 'invalid_code', message: 'Wrong or already used pairing code' } });
    reply.header('set-cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict`);
    return { authenticated: true };
  });
}
