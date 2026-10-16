import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalMemoria, ProviderAdapter, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { Executor } from './executor.js';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function setup(memoria?: () => LocalMemoria | undefined) {
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
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const cwd = mkdtempSync(join(tmpdir(), 'owl-ka-'));
  dirs.push(cwd);
  const executor = new Executor({ repos, resolveAdapter: () => adapter, ...(memoria ? { localMemoria: memoria } : {}) });
  const run = async (provider: string, ticketId?: string) => {
    const sessionId = repos.sessions.create().id;
    const r = executor.submit({ sessionId, texto: 'oi', provider, cwd, ...(ticketId ? { ticketId } : {}) });
    await new Promise((res) => setTimeout(res, 20));
    return r;
  };
  return { requests, run, repos };
}

describe('executor keep-alive for the local model', () => {
  it('auto: warm for a chat message, a short window for work on a ticket', async () => {
    const { requests, run, repos } = setup();
    await run('ollama');
    const project = repos.projects.create({ nome: 'p', pasta: tmpdir() });
    const ticket = repos.tickets.create({ projectId: project.id, titulo: 't' }, { nome: 'humano', tipo: 'humano' });
    await run('ollama', ticket.id);
    expect(requests.map((r) => r.keepAlive)).toEqual(['5m', '60s']);
  });

  it('rapido keeps it warm and economico unloads at once, ticket or not', async () => {
    let modo: LocalMemoria = 'rapido';
    const { requests, run } = setup(() => modo);
    await run('ollama');
    modo = 'economico';
    await run('ollama');
    expect(requests.map((r) => r.keepAlive)).toEqual(['5m', 0]);
  });

  it('a throwing setting falls back to auto and the run still happens', async () => {
    const { requests, run } = setup(() => {
      throw new Error('boom');
    });
    await run('ollama');
    expect(requests[0]?.keepAlive).toBe('5m');
  });

  it('does not send keepAlive to other providers', async () => {
    const { requests, run } = setup(() => 'economico');
    await run('claude-cli');
    expect(requests[0]).not.toHaveProperty('keepAlive');
  });
});
