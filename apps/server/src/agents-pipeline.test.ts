import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCliAdapter } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor } from './executor.js';

const FAKE = fileURLToPath(new URL('../../../packages/core/test/fake-cli.mjs', import.meta.url));

let dir: string;
let userLib: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let scenario: Record<string, string>;
let spawned: Array<{ provider: string; record: string }>;

const rec = (i: number) => JSON.parse(readFileSync(spawned[i]!.record, 'utf8')) as { argv: string[]; stdin: string };

async function setup(opts: { concurrency?: number } = {}) {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({
    repos,
    concurrency: opts.concurrency ?? 1,
    resolveAdapter: (id) => {
      const record = join(dir, `rec-${spawned.length}.json`);
      spawned.push({ provider: id, record });
      return createClaudeCliAdapter({
        bin: process.execPath,
        binArgs: [FAKE],
        killGraceMs: 300,
        env: { ...process.env, FAKE_SCENARIO: scenario[id] ?? 'text', FAKE_RECORD: record },
      });
    },
  });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()], userLibraryDir: userLib });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-agents-'));
  userLib = join(dir, 'user-lib');
  scenario = {};
  spawned = [];
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
const post = (path: string, body?: unknown) => call('POST', path, body ?? {});
const get = async <T>(path: string) => (await (await fetch(base + path)).json()) as T;

interface Detail {
  messages: { papel: string; conteudo: string; runId: string | null }[];
  runs: { id: string; etapa: string | null; parentRunId: string | null; provedor: string; agentId: string | null; status: string }[];
  approvals: { id: string; runId: string; motivo: string }[];
}
const detail = (sid: string) => get<Detail>(`/sessions/${sid}`);
async function newSession() {
  return ((await (await post('/sessions')).json()) as { session: { id: string } }).session.id;
}
const send = async (sid: string, body: object) => {
  const r = await post(`/sessions/${sid}/messages`, { texto: 'faça X', ...body });
  return { status: r.status, body: (await r.json()) as { runId: string; etapa?: string | null; error?: { code: string; message: string } } };
};

describe('pipeline refinar → executar → revisar com outro provedor', () => {
  const pipeline = 'refinar-executar-revisar';

  it('runs the three steps end to end; the reviewer is not on the provider that executed', async () => {
    await setup();
    const sid = await newSession();
    const first = await send(sid, { pipeline, melhorarPrompt: true, provider: 'codex-cli' });
    expect(first.status).toBe(202);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.provedor, r.status])).toEqual([
      ['melhorar', 'codex-cli', 'ok'],
      ['executar', 'codex-cli', 'ok'],
      ['revisar', 'claude-cli', 'ok'], // the reviewer's own provider is codex-cli: it takes the fallback
    ]);
    const [melhorar, executar, revisar] = d.runs;
    expect(executar!.parentRunId).toBe(melhorar!.id);
    expect(revisar!.parentRunId).toBe(executar!.id);
    expect(d.messages.map((m) => m.papel)).toEqual(['usuario', 'agente', 'assistente', 'agente']);

    // The reviewer sees the original request and the executor's output, and the agent's own instructions + skill.
    const reviewerInput = rec(2).stdin;
    expect(reviewerInput).toContain('faça X');
    expect(reviewerInput).toContain(d.messages[2]!.conteudo);
    expect(reviewerInput).toContain('codex-cli');
    expect(rec(2).argv.join(' ')).toContain('Você é o revisor');
    expect(rec(2).argv.join(' ')).toContain('## Skill: checklist-de-revisao');
    // Only agent runs carry the agent id.
    expect(melhorar!.agentId).toBe(repos.agents.byName('refinador-de-prompt')!.id);
    expect(executar!.agentId).toBeNull();
    expect(revisar!.agentId).toBe(repos.agents.byName('revisor')!.id);
  });

  it('with the executor on claude-cli the reviewer uses its own provider (codex-cli)', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, { pipeline, provider: 'claude-cli' }); // no refinement: the first step is skipped
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.provedor])).toEqual([
      ['executar', 'claude-cli'],
      ['revisar', 'codex-cli'],
    ]);
  });

  it('the allowed tools of the reviewer reach the CLI', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, { pipeline, provider: 'claude-cli' });
    await executor.idle();
    const argv = rec(1).argv;
    expect(argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--allowedTools') + 4)).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('refuses an unknown pipeline before storing anything', async () => {
    await setup();
    const sid = await newSession();
    const r = await send(sid, { pipeline: 'nao-existe' });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('unknown_pipeline');
    expect((await detail(sid)).messages).toEqual([]);
  });
});

describe('tentativas', () => {
  it('runs the failing step again on the same provider, up to the limit, before asking the user', async () => {
    await setup();
    scenario['codex-cli'] = 'error';
    const sid = await newSession();
    await send(sid, { pipeline: 'refinar-executar-revisar', melhorarPrompt: true });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.provedor, r.status])).toEqual([
      ['melhorar', 'codex-cli', 'erro'],
      ['melhorar', 'codex-cli', 'erro'], // tentativas: 2
    ]);
    expect(d.approvals).toHaveLength(1);
    expect(d.approvals[0]!.motivo).toContain('Falha ao melhorar o prompt');
    expect(d.approvals[0]!.runId).toBe(d.runs[1]!.id);
  });

  it('a transient failure is absorbed: the second attempt succeeds and the pipeline goes on', async () => {
    await setup();
    const real = executor.submit.bind(executor);
    let n = 0;
    scenario['codex-cli'] = 'error';
    // First spawn of the refiner fails, then the scenario flips to success.
    executor.submit = (input) => {
      if (input.etapa === 'melhorar' && n++ === 1) scenario['codex-cli'] = 'text';
      return real(input);
    };
    const sid = await newSession();
    await send(sid, { pipeline: 'refinar-executar-revisar', melhorarPrompt: true, provider: 'claude-cli' });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.status])).toEqual([
      ['melhorar', 'erro'],
      ['melhorar', 'ok'],
      ['executar', 'ok'],
      ['revisar', 'ok'],
    ]);
    expect(d.approvals).toEqual([]);
  });

  it('a step with the default single attempt does not retry', async () => {
    await setup();
    scenario['claude-cli'] = 'error';
    const sid = await newSession();
    await send(sid, { pipeline: 'refinar-executar-revisar', provider: 'claude-cli' });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.status])).toEqual([['executar', 'erro']]);
  });
});

describe('outroProvedorQue with nowhere to go', () => {
  it('fails the step with a message when the agent offers no different provider, and tells the session', async () => {
    mkdirSync(join(userLib, 'agents'), { recursive: true });
    mkdirSync(join(userLib, 'pipelines'), { recursive: true });
    writeFileSync(join(userLib, 'agents/so-claude.md'), '---\nnome: so-claude\nprovedor: claude-cli\n---\nRevise.\n');
    writeFileSync(
      join(userLib, 'pipelines/dois.yaml'),
      'nome: dois\netapas:\n  - id: executar\n  - id: revisar\n    agente: so-claude\n    outroProvedorQue: executar\n',
    );
    await setup();
    const sid = await newSession();
    await send(sid, { pipeline: 'dois', provider: 'claude-cli' });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => r.etapa)).toEqual(['executar']);
    const note = d.messages.find((m) => m.papel === 'sistema');
    expect(note?.conteudo).toMatch(/other than "claude-cli"/);
  });
});

describe('the same agent in two sessions', () => {
  it('runs side by side without sharing state: each run has its own input, parent and session', async () => {
    await setup({ concurrency: 2 });
    const a = await newSession();
    const b = await newSession();
    await Promise.all([
      send(a, { pipeline: 'refinar-executar-revisar', provider: 'claude-cli', texto: 'pedido da sessão A' }),
      send(b, { pipeline: 'refinar-executar-revisar', provider: 'claude-cli', texto: 'pedido da sessão B' }),
    ]);
    await executor.idle();
    const [da, db] = await Promise.all([detail(a), detail(b)]);
    for (const [d, texto] of [[da, 'pedido da sessão A'], [db, 'pedido da sessão B']] as const) {
      expect(d.runs.map((r) => [r.etapa, r.status])).toEqual([['executar', 'ok'], ['revisar', 'ok']]);
      const reviewer = d.runs[1]!;
      const input = JSON.parse(readFileSync(spawned.map((s) => s.record).find((p) => readFileSync(p, 'utf8').includes(`Pedido original:\\n${texto}`))!, 'utf8')) as { stdin: string };
      expect(input.stdin).toContain(texto);
      expect(input.stdin).not.toContain(texto === 'pedido da sessão A' ? 'sessão B' : 'sessão A');
      expect(reviewer.agentId).toBe(repos.agents.byName('revisor')!.id);
    }
    expect(da.runs.map((r) => r.id).some((id) => db.runs.some((x) => x.id === id))).toBe(false);
  });
});

describe('library routes', () => {
  const agent = (nome: string, extra = '') => `---\nnome: ${nome}\nprovedor: claude-cli\n${extra}---\nVocê é ${nome}.\n`;

  it('lists the bundled agents, reports broken files and never fails because of one', async () => {
    mkdirSync(join(userLib, 'agents'), { recursive: true });
    writeFileSync(join(userLib, 'agents/quebrado.md'), '---\nnome: quebrado\nprovedor: claude-cli\nferramentas: Read\n---\nx');
    await setup();
    const r = await get<{ agents: { nome: string; origem: string }[]; problemas: { arquivo: string; erro: string }[] }>('/agents');
    expect(r.agents.map((a) => a.nome)).toContain('revisor');
    expect(r.agents.every((a) => a.origem === 'exemplo')).toBe(true);
    expect(r.problemas).toEqual([{ arquivo: 'agents/quebrado.md', origem: 'usuario', erro: expect.stringContaining('ferramentas') }]);
  });

  it('creates, reads, edits, duplicates and deletes through the API', async () => {
    await setup();
    expect((await call('PUT', '/agents/meu', { texto: agent('meu') })).status).toBe(200);
    const src = await get<{ texto: string; origem: string }>('/agents/meu');
    expect(src).toMatchObject({ origem: 'usuario' });
    expect(src.texto).toContain('Você é meu.');

    expect((await call('PUT', '/agents/meu', { texto: agent('meu', 'modelo: opus\n') })).status).toBe(200);
    expect((await get<{ texto: string }>('/agents/meu')).texto).toContain('modelo: opus');

    expect((await post('/agents/meu/duplicate', { novoNome: 'meu-2' })).status).toBe(201);
    expect((await post('/agents/meu/duplicate', { novoNome: 'meu-2' })).status).toBe(409);
    expect((await get<{ agents: { nome: string }[] }>('/agents')).agents.map((a) => a.nome)).toEqual(expect.arrayContaining(['meu', 'meu-2']));

    expect((await call('DELETE', '/agents/meu')).status).toBe(200);
    expect((await call('GET', '/agents/meu')).status).toBe(404);
    expect((await call('DELETE', '/agents/revisor')).status).toBe(403); // bundled
  });

  it('answers 400 with the reason for an invalid agent and never writes it', async () => {
    await setup();
    const r = await call('PUT', '/agents/ruim', { texto: '---\nnome: ruim\nprovedor: nuvem\n---\nx' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { code: 'invalid_agent', message: expect.stringContaining('unknown provider "nuvem"') } });
    expect((await call('GET', '/agents/ruim')).status).toBe(404);
  });

  it('refuses names that would leave the folder', async () => {
    await setup();
    for (const nome of ['..%2Fx', '.hidden', 'A', 'a%20b']) {
      const r = await call('PUT', `/agents/${nome}`, { texto: agent('x') });
      expect([400, 404]).toContain(r.status);
    }
    expect((await post('/agents/revisor/duplicate', { novoNome: '../fora' })).status).toBe(400);
  });

  it('lists skills and pipelines', async () => {
    await setup();
    expect((await get<{ skills: { nome: string }[] }>('/skills')).skills.map((s) => s.nome)).toEqual(
      expect.arrayContaining(['checklist-de-revisao', 'revisao-de-arquitetura']),
    );
    expect((await get<{ pipelines: { nome: string; etapas: string[] }[] }>('/pipelines')).pipelines).toEqual(
      expect.arrayContaining([{ nome: 'refinar-executar-revisar', etapas: ['melhorar', 'executar', 'revisar'], origem: 'exemplo' }]),
    );
  });

  it('a corrupted agent file used by a running pipeline fails with a readable error and the app keeps working', async () => {
    await setup();
    mkdirSync(join(userLib, 'agents'), { recursive: true });
    writeFileSync(join(userLib, 'agents/revisor.md'), 'lixo sem front matter');
    const sid = await newSession();
    // The broken override is skipped: the bundled reviewer runs and the problem is listed.
    await send(sid, { pipeline: 'refinar-executar-revisar', provider: 'claude-cli' });
    await executor.idle();
    expect((await detail(sid)).runs.map((r) => r.etapa)).toEqual(['executar', 'revisar']);
    expect((await get<{ problemas: unknown[] }>('/agents')).problemas).toHaveLength(1);
    expect((await call('GET', '/health')).status).toBe(200);
  });
});

describe('index freshness', () => {
  it('an agent file added after startup still gets its id on the run', async () => {
    await setup();
    mkdirSync(join(userLib, 'agents'), { recursive: true });
    mkdirSync(join(userLib, 'pipelines'), { recursive: true });
    writeFileSync(join(userLib, 'agents/novo.md'), '---\nnome: novo\nprovedor: claude-cli\n---\nOi.\n');
    writeFileSync(join(userLib, 'pipelines/um.yaml'), 'nome: um\netapas:\n  - id: so\n    agente: novo\n');
    const sid = await newSession();
    await send(sid, { pipeline: 'um' });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs[0]!.agentId).toBe(repos.agents.byName('novo')!.id);
  });
});
