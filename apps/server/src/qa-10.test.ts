import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAdapter, RunEvent, RunRequest } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';
import { MemoryService } from './memory.js';

// QA do prompt 10: registro de chamadas, ligação, falhas.
let dir: string;
let seen: RunRequest[];
let script: (req: RunRequest, signal: AbortSignal) => AsyncGenerator<RunEvent>;

const adapter: ProviderAdapter = {
  id: 'claude-cli',
  isAvailable: async () => true,
  run: (req, signal) => {
    seen.push(req);
    return script(req, signal);
  },
};
const ok = (events: RunEvent[] = []) =>
  async function* (req: RunRequest): AsyncGenerator<RunEvent> {
    yield { type: 'start', runId: req.runId ?? 'r', provider: 'claude-cli' };
    for (const e of events) yield e;
    yield { type: 'end', result: 'feito' };
  };

function setup(mcpDir = join(dir, 'mcp')) {
  const db = openDb();
  migrate(db);
  const repos = createRepos(db);
  const executor = new Executor({ repos, resolveAdapter: () => adapter });
  const memory = new MemoryService({ repos, executor, mcp: { dbFile: '/d.sqlite', dir: mcpDir, command: 'node', args: ['bin.ts'] } });
  memory.save({ mcpMemoria: true });
  const project = repos.projects.create({ nome: 'P', pasta: dir });
  const session = repos.sessions.create({ projectId: project.id });
  return { db, repos, executor, memory, project, session };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-qa10s-'));
  seen = [];
  script = ok();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('QA 10 — registro de chamadas no run', () => {
  it('registra mesmo quando a execução termina em erro depois das chamadas', async () => {
    const { executor, repos, session } = setup();
    script = ok([{ type: 'tool', name: 'mcp__owl-memory__listar_fatos', input: {} }, { type: 'error', message: 'boom' }]);
    const run = executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(repos.runs.get(run.id)).toMatchObject({ status: 'erro', memoriaChamadas: { listar_fatos: 1 } });
  });

  it('cancelar a execução remove o arquivo de config e mantém a contagem', async () => {
    const { executor, repos, session } = setup();
    script = async function* (req, signal) {
      yield { type: 'start', runId: req.runId ?? 'r', provider: 'claude-cli' };
      yield { type: 'tool', name: 'mcp__owl-memory__buscar_memoria', input: {} };
      await new Promise((r) => setTimeout(r, 30));
      if (signal.aborted) {
        yield { type: 'error', message: 'cancelado' };
        return;
      }
      yield { type: 'end', result: 'x' };
    };
    const run = executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await new Promise((r) => setTimeout(r, 10));
    executor.cancel(run.id);
    await executor.idle();
    expect(existsSync(join(dir, 'mcp', `${run.id}.json`))).toBe(false);
    expect(repos.runs.get(run.id)!.memoriaChamadas).toEqual({ buscar_memoria: 1 });
  });

  it('só conta nomes de ferramentas válidas do servidor owl-memory (sem prefixo parcial/sufixo estranho)', async () => {
    const { executor, repos, session } = setup();
    script = ok([
      { type: 'tool', name: 'xmcp__owl-memory__buscar_memoria', input: {} },
      { type: 'tool', name: 'mcp__owl-memory__', input: {} },
      { type: 'tool', name: 'mcp__owl-memory__listar_fatos', input: {} },
    ]);
    const run = executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(repos.runs.get(run.id)!.memoriaChamadas).toEqual({ listar_fatos: 1 });
  });

  it('JSON corrompido em memoria_chamadas não derruba a leitura do run', () => {
    const { db, repos, session } = setup();
    const run = repos.runs.start({ provedor: 'claude-cli', sessionId: session.id });
    db.prepare('UPDATE runs SET memoria_chamadas = ? WHERE id = ?').run('{nope', run.id);
    expect(repos.runs.get(run.id)!.memoriaChamadas).toBeNull();
    expect(repos.runs.listBySession(session.id)).toHaveLength(1);
  });

  it('setMemoryCalls com objeto vazio grava NULL', () => {
    const { repos, session } = setup();
    const run = repos.runs.start({ provedor: 'claude-cli', sessionId: session.id });
    repos.runs.setMemoryCalls(run.id, { a: 1 });
    repos.runs.setMemoryCalls(run.id, {});
    expect(repos.runs.get(run.id)!.memoriaChamadas).toBeNull();
  });

  it('a API de execuções da sessão devolve memoriaChamadas', async () => {
    const { executor, repos, session } = setup();
    script = ok([{ type: 'tool', name: 'mcp__owl-memory__salvar_fato', input: {} }]);
    executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(repos.runs.listBySession(session.id)[0]!.memoriaChamadas).toEqual({ salvar_fato: 1 });
  });
});

describe('QA 10 — falhas na ligação do servidor MCP', () => {
  it('pasta de config impossível de criar: a execução falha com erro claro e não deixa run "rodando"', async () => {
    const blocker = join(dir, 'arquivo');
    writeFileSync(blocker, 'x');
    const { executor, repos, session } = setup(join(blocker, 'mcp'));
    const run = executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    const r = repos.runs.get(run.id)!;
    expect(r.status).not.toBe('rodando');
    expect(r.status).toBe('erro');
    expect(r.erro).toBeTruthy();
  });

  it('adaptador que lança no meio: arquivo de config é apagado', async () => {
    const { executor, session } = setup();
    script = async function* () {
      throw new Error('spawn falhou');
    };
    executor.submit({ sessionId: session.id, texto: 'oi', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(readdirSync(join(dir, 'mcp'))).toEqual([]);
  });

  it('mcpFor para sessão inexistente não escreve config', () => {
    const { memory } = setup();
    expect(memory.mcpFor({ sessionId: 'nada', runId: 'r1', provider: 'claude-cli', stateless: false, noTools: false })).toBeUndefined();
    expect(existsSync(join(dir, 'mcp', 'r1.json'))).toBe(false);
  });

  it('execuções simultâneas usam configs distintos, cada um com o seu escopo', async () => {
    const { executor, repos, project } = setup();
    const other = repos.projects.create({ nome: 'Q', pasta: dir });
    const s1 = repos.sessions.create({ projectId: project.id });
    const s2 = repos.sessions.create({ projectId: other.id });
    executor.submit({ sessionId: s1.id, texto: '1', provider: 'claude-cli', cwd: dir });
    executor.submit({ sessionId: s2.id, texto: '2', provider: 'claude-cli', cwd: dir });
    await executor.idle();
    expect(new Set(seen.map((r) => r.mcpConfigPath)).size).toBe(2);
    expect(readdirSync(join(dir, 'mcp'))).toEqual([]);
  });

  it('mcpMemoria é desligável e persiste em /api (rota de configurações)', async () => {
    const db = openDb();
    migrate(db);
    const repos = createRepos(db);
    const app = buildApp({ repos, executor: new Executor({ repos, resolveAdapter: () => adapter }), libraryDir: dir, mcpMemory: { dbFile: '/d', dir: join(dir, 'm'), command: 'node', args: [] } } as never);
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/settings', payload: payload as object });
    expect((await app.inject({ method: 'GET', url: '/settings' })).json().memory.mcpMemoria).toBe(false);
    expect((await put({ memory: { mcpMemoria: true } })).json().memory.mcpMemoria).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/settings' })).json().memory.mcpMemoria).toBe(true);
    expect((await put({ memory: { mcpMemoria: false } })).json().memory.mcpMemoria).toBe(false);
    expect((await put({ memory: { mcpMemoria: 'sim' } })).statusCode).toBeGreaterThanOrEqual(400);
  });
});
