import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const COOKIE = 'owl_session';
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
export function registerAuth(app: FastifyInstance, auth: SessionAuth): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (OPEN.has(path) || auth.valid(req.headers.cookie)) return;
    return reply.status(401).send({ error: { code: 'unauthorized', message: 'Pair this browser with the server first' } });
  });

  app.get('/auth/status', async (req) => ({ required: true, authenticated: auth.valid(req.headers.cookie) }));

  app.post('/auth/pair', async (req, reply) => {
    const { code } = z.object({ code: z.string().min(1).max(200) }).parse(req.body);
    const id = auth.pair(code.trim());
    if (!id) return reply.status(401).send({ error: { code: 'invalid_code', message: 'Wrong or already used pairing code' } });
    reply.header('set-cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict`);
    return { authenticated: true };
  });
}
