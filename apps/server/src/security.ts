import { realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

/** Loopback host names the API answers to. Anything else (e.g. a rebound `evil.example`) is refused. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const hostnameOf = (hostHeader: string) => hostHeader.replace(/:\d+$/, '').toLowerCase();

/**
 * Blocks DNS rebinding and cross-site requests to the local API:
 * - `Host` must be a loopback name (a rebinding attacker's page still sends its own domain as Host).
 * - If the browser sent `Origin`, it must be this server itself or one listed in `allowedOrigins`.
 *   Browsers always send `Origin` on cross-origin POSTs, so a malicious site cannot drive the API.
 * Requests with no `Origin` (curl, scripts, same-origin GETs) are allowed: they are not browser-driven cross-site.
 */
export function registerGuards(app: FastifyInstance, allowedOrigins: readonly string[] = []): void {
  const extra = new Set(allowedOrigins.map((o) => o.replace(/\/$/, '').toLowerCase()));
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    if (!host || !LOOPBACK.has(hostnameOf(host))) {
      return reply.status(403).send({ error: { code: 'forbidden_host', message: 'Host not allowed' } });
    }
    const origin = req.headers.origin;
    if (origin === undefined) return;
    let ok = extra.has(origin.replace(/\/$/, '').toLowerCase());
    if (!ok) {
      try {
        const u = new URL(origin);
        ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.host.toLowerCase() === host.toLowerCase();
      } catch {
        ok = false; // includes the literal Origin "null"
      }
    }
    if (!ok) {
      return reply.status(403).send({ error: { code: 'forbidden_origin', message: 'Origin not allowed' } });
    }
  });
}

export class FolderError extends Error {
  constructor(
    readonly code: 'invalid_folder' | 'folder_not_allowed',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolves `dir` to its real path (symlinks followed, so a link cannot smuggle a path out of the roots) and
 * checks that it is an existing directory inside one of `roots`, with no hidden folder in between.
 * Returns the canonical path.
 */
export function resolveWorkspace(dir: string, roots: readonly string[]): string {
  if (dir.includes('\0')) throw new FolderError('invalid_folder', 'Folder is not a valid path');
  let real: string;
  try {
    real = realpathSync(resolve(dir));
    if (!statSync(real).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new FolderError('invalid_folder', `Folder does not exist: ${dir}`);
  }
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = realpathSync(resolve(root));
    } catch {
      continue;
    }
    const rel = relative(realRoot, real);
    if (rel.startsWith('..') || resolve(realRoot, rel) !== real) continue; // outside this root
    if (rel.split(sep).some((part) => part.startsWith('.') && part !== '')) continue; // hidden folder
    return real;
  }
  throw new FolderError('folder_not_allowed', 'Folder is outside the allowed workspace roots (OWL_WORKSPACE_ROOTS)');
}
