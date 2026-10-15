import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunEvent, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Executor } from './executor.js';
import { MemoryService } from './memory.js';

let dir: string;
let seen: Array<{ req: RunRequest; configAtStart: unknown }>;
let events: RunEvent[];

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  async *run(req) {
    seen.push({ req, configAtStart: req.mcpConfigPath && existsSync(req.mcpConfigPath) ? JSON.parse(readFileSync(req.mcpConfigPath, 'utf8')) : undefined });
    yield { type: 'start', runId: req.runId ?? 'r', provider: 'claude-cli' };
    for (const e of events) yield e;
    yield { type: 'end', result: 'feito' };
  },
};

function setup(withLaunch = true) {
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const executor = new Executor({ repos, resolveAdapter: () => adapter });
  const memory = new MemoryService({ repos, executor, ...(withLaunch ? { mcp: { dbFile: '/data/owl.sqlite', dir: join(dir, 'mcp'), command: 'node', args: ['bin.ts'] } } : {}) });
  const project = repos.projects.create({ nome: 'P', pasta: dir });
  const session = repos.sessions.create({ projectId: project.id });
  return { repos, executor, memory, project, session };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-mcpsrv-'));
  seen = [];
  events = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('memory tools in a run', () => {
  it('are off by default: no config, no extra permission', async () => {
    const { executor, session } = setup();
    executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(seen[0]!.req.mcpConfigPath).toBeUndefined();
    expect(seen[0]!.req.allowedTools).toBeUndefined();
  });

  it('when on: hand the CLI a scoped config and pre-approve only the memory server, then delete the file', async () => {
    const { executor, memory, session, project } = setup();
    memory.save({ mcpMemoria: true });
    const run = executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir, allowedTools: ['Read'] });
    await executor.idle();
    const { req, configAtStart } = seen[0]!;
    expect(req.allowedTools).toEqual(['Read', 'mcp__owl-memory']);
    expect(req.mcpConfigPath).toBe(join(dir, 'mcp', `${run.id}.json`));
    expect(configAtStart).toMatchObject({
      mcpServers: { 'owl-memory': { command: 'node', args: ['bin.ts'], env: { OWL_DB: '/data/owl.sqlite', OWL_MEMORY_SESSION: session.id, OWL_MEMORY_PROJECT: project.id, OWL_MEMORY_RUN: run.id } } },
    });
    expect(existsSync(req.mcpConfigPath!)).toBe(false);
  });

  it('removes the config even when the run fails', async () => {
    const { executor, memory, session } = setup();
    memory.save({ mcpMemoria: true });
    events = [{ type: 'error', message: 'boom' }];
    executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(existsSync(seen[0]!.req.mcpConfigPath!)).toBe(false);
  });

  it('is not given to other providers, stateless runs, tool-free runs or when the launcher is missing', async () => {
    const { executor, memory, session } = setup();
    memory.save({ mcpMemoria: true });
    executor.submit({ sessionId: session.id, texto: 'a', provider: 'claude-cli', cwd: dir, stateless: true });
    await executor.idle();
    executor.submit({ sessionId: session.id, texto: 'b', provider: 'claude-cli', cwd: dir, noTools: true });
    await executor.idle();
    expect(seen.map((s) => s.req.mcpConfigPath)).toEqual([undefined, undefined]);

    const other = setup(false);
    other.memory.save({ mcpMemoria: true });
    other.executor.submit({ sessionId: other.session.id, texto: 'c', provider: 'claude-cli', cwd: dir });
    await other.executor.idle();
    expect(seen[2]!.req.mcpConfigPath).toBeUndefined();
    expect(other.memory.mcpFor({ sessionId: other.session.id, runId: 'x', provider: 'codex-cli', stateless: false, noTools: false })).toBeUndefined();
  });

  it('a conversation without a project gets a config without a project', async () => {
    const { executor, memory, repos } = setup();
    memory.save({ mcpMemoria: true });
    const loose = repos.sessions.create({});
    executor.submit({ sessionId: loose.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    const env = (seen[0]!.configAtStart as { mcpServers: Record<string, { env: Record<string, string> }> }).mcpServers['owl-memory']!.env;
    expect(env).not.toHaveProperty('OWL_MEMORY_PROJECT');
  });

  it('records which memory tools the model called in the run (and ignores other tools)', async () => {
    const { executor, session, repos } = setup();
    events = [
      { type: 'tool', name: 'mcp__owl-memory__buscar_memoria', input: { consulta: 'x' } },
      { type: 'tool', name: 'mcp__owl-memory__buscar_memoria', input: { consulta: 'y' } },
      { type: 'tool', name: 'mcp__owl-memory__salvar_fato', input: {} },
      { type: 'tool', name: 'mcp__other__buscar_memoria', input: {} },
      { type: 'tool', name: 'Read', input: {} },
    ];
    const run = executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(repos.runs.get(run.id)!.memoriaChamadas).toEqual({ buscar_memoria: 2, salvar_fato: 1 });
    events = [];
    const quiet = executor.submit({ sessionId: session.id, texto: 'de novo', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(repos.runs.get(quiet.id)!.memoriaChamadas).toBeNull();
  });
});
