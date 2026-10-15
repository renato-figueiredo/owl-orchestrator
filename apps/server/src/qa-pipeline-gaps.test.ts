import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCliAdapter } from '@owl/core';
import { createRepos, migrate, openDb, type Run } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { Executor, type SubmitInput } from './executor.js';
import { Library } from './library.js';
import { PipelineError, PipelineRunner } from './pipeline-runner.js';

// QA gap tests for prompt 06 (melhorar prompt): edge cases around approvals, retry and the review gate.

const FAKE = fileURLToPath(new URL('../../../packages/core/test/fake-cli.mjs', import.meta.url));

let dir: string;
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let scenario: Record<string, string>;
let spawned: string[];
const rec = (i: number) => JSON.parse(readFileSync(join(dir, `rec-${i}.json`), 'utf8')) as { argv: string[]; stdin: string };

async function setup() {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({
    repos,
    resolveAdapter: (id) => {
      const record = join(dir, `rec-${spawned.length}.json`);
      spawned.push(id);
      return createClaudeCliAdapter({
        bin: process.execPath,
        binArgs: [FAKE],
        killGraceMs: 300,
        env: { ...process.env, FAKE_SCENARIO: scenario[id] ?? 'text', FAKE_RECORD: record },
      });
    },
  });
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-qa06-'));
  scenario = {};
  spawned = [];
});
afterEach(async () => {
  await executor?.shutdown();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body?: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const get = async <T>(path: string) => (await (await fetch(base + path)).json()) as T;
interface Detail {
  messages: { papel: string; conteudo: string }[];
  runs: { id: string; etapa: string | null; parentRunId: string | null; provedor: string; status: string; tokensIn: number | null; tokensOut: number | null }[];
  approvals: { id: string; runId: string; motivo: string }[];
}
const detail = (sid: string) => get<Detail>(`/sessions/${sid}`);
const newSession = async () => ((await (await post('/sessions')).json()) as { session: { id: string } }).session.id;
const send = async (sid: string, body: object, texto = 'faça X') => {
  const r = await post(`/sessions/${sid}/messages`, { texto, ...body });
  return { status: r.status, body: (await r.json()) as { runId: string; etapa?: string | null } };
};
/** Sends with review on and waits until the pipeline is paused. */
async function paused(extra: object = {}) {
  await setup();
  const sid = await newSession();
  const first = await send(sid, { melhorarPrompt: true, editarAntes: true, ...extra });
  await executor.idle();
  return { sid, runId: first.body.runId };
}

describe('acceptance: tokens per step', () => {
  it('both chained steps carry their own token counts', async () => {
    await setup();
    const sid = await newSession();
    await send(sid, { melhorarPrompt: true });
    await executor.idle();
    const { runs } = await detail(sid);
    expect(runs).toHaveLength(2);
    for (const r of runs) {
      expect(r.tokensIn, `tokens_in of ${r.etapa}`).not.toBeNull();
      expect(r.tokensOut, `tokens_out of ${r.etapa}`).not.toBeNull();
    }
  });
});

describe('request flags', () => {
  it('editarAntes without melhorarPrompt is ignored: one run, no approval', async () => {
    await setup();
    const sid = await newSession();
    const r = await send(sid, { editarAntes: true });
    expect(r.status).toBe(202);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]!.etapa).toBeNull();
    expect(d.approvals).toEqual([]);
  });

  it('melhorarPrompt must be a boolean', async () => {
    await setup();
    const sid = await newSession();
    expect((await send(sid, { melhorarPrompt: 'yes' })).status).toBe(400);
    expect(spawned).toHaveLength(0);
  });
});

describe('review gate edge cases', () => {
  it('a whitespace-only edit counts as "no edit": the refined prompt runs', async () => {
    const { sid, runId } = await paused();
    const refined = (await detail(sid)).messages.find((m) => m.papel === 'agente')!.conteudo;
    expect((await post(`/runs/${runId}/continue`, { texto: '   \n ' })).status).toBe(202);
    await executor.idle();
    expect(rec(1).stdin).toBe(refined);
  });

  it('the edit is trimmed and braces in it are sent literally (no template re-evaluation)', async () => {
    const { runId } = await paused();
    await post(`/runs/${runId}/continue`, { texto: '  use {{ pedido }} e {{ process.exit() }}  ' });
    await executor.idle();
    expect(rec(1).stdin).toBe('use {{ pedido }} e {{ process.exit() }}');
  });

  it('a multiline edit with unicode survives intact', async () => {
    const { runId } = await paused();
    const text = 'Objetivo: ação\n\n- item 1\n- item 2 ✓';
    await post(`/runs/${runId}/continue`, { texto: text });
    await executor.idle();
    expect(rec(1).stdin).toBe(text);
  });

  it('an edit above the size limit is rejected with 400 and the pause stays open', async () => {
    const { sid, runId } = await paused();
    expect((await post(`/runs/${runId}/continue`, { texto: 'a'.repeat(200_001) })).status).toBe(400);
    expect((await detail(sid)).approvals).toHaveLength(1);
    expect((await post(`/runs/${runId}/continue`, {})).status).toBe(202);
  });

  it('the decision is stored: approved + the edited text as comment', async () => {
    const { runId } = await paused();
    await post(`/runs/${runId}/continue`, { texto: 'EDITADO' });
    await executor.idle();
    expect(repos.approvals.byRun(runId)).toMatchObject({ status: 'aprovado', comentario: 'EDITADO' });
  });

  it('the pause is visible again after a reload (GET session lists it) until decided', async () => {
    const { sid, runId } = await paused();
    for (let i = 0; i < 2; i++) expect((await detail(sid)).approvals.map((a) => a.runId)).toEqual([runId]);
  });

  it('two concurrent "continue" calls start the next step only once', async () => {
    const { sid, runId } = await paused();
    const [a, b] = await Promise.all([post(`/runs/${runId}/continue`, {}), post(`/runs/${runId}/continue`, {})]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await executor.idle();
    expect((await detail(sid)).runs.filter((r) => r.etapa === 'executar')).toHaveLength(1);
  });

  it('retry on a review pause re-runs the refiner with the other model and pauses again', async () => {
    const { sid, runId } = await paused();
    const res = await post(`/runs/${runId}/retry`, { provider: 'claude-cli', model: 'haiku' });
    expect(res.status).toBe(202);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.provedor])).toEqual([['melhorar', 'codex-cli'], ['melhorar', 'claude-cli']]);
    expect(d.approvals).toHaveLength(1);
    expect(d.approvals[0]!.runId).toBe(d.runs[1]!.id); // the new pause belongs to the new run
    expect(repos.approvals.byRun(runId)).toMatchObject({ status: 'rejeitado' });
    // the old run can no longer be resumed
    expect((await post(`/runs/${runId}/continue`, {})).status).toBe(409);
    // and approving the new one executes the NEW refined prompt (original request is not duplicated)
    expect((await post(`/runs/${d.runs[1]!.id}/continue`, {})).status).toBe(202);
    await executor.idle();
    expect((await detail(sid)).messages.filter((m) => m.papel === 'usuario')).toHaveLength(1);
  });

  it('retry and discard on a decided or unknown run answer 409 / 404', async () => {
    const { runId } = await paused();
    await post(`/runs/${runId}/discard`);
    expect((await post(`/runs/${runId}/discard`)).status).toBe(409);
    expect((await post(`/runs/${runId}/retry`, { provider: 'claude-cli' })).status).toBe(409);
    expect((await post('/runs/nope/discard')).status).toBe(404);
    expect((await post('/runs/nope/retry', { provider: 'claude-cli' })).status).toBe(404);
  });

  it('retry validates its body (provider required, model cannot look like a flag)', async () => {
    const { runId } = await paused();
    expect((await post(`/runs/${runId}/retry`, {})).status).toBe(400);
    expect((await post(`/runs/${runId}/retry`, { provider: 'claude-cli', model: '--dangerous' })).status).toBe(400);
    expect(spawned).toHaveLength(1);
  });
});

describe('refiner failure edge cases', () => {
  it('a retry that fails again asks again (a new pending approval), never runs the executor', async () => {
    scenario = { 'codex-cli': 'error', 'claude-cli': 'error' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    await executor.idle();
    await post(`/runs/${first.body.runId}/retry`, { provider: 'claude-cli', model: 'haiku' });
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs.map((r) => [r.etapa, r.status])).toEqual([['melhorar', 'erro'], ['melhorar', 'erro']]);
    expect(d.approvals).toHaveLength(1);
    expect(d.approvals[0]!.runId).toBe(d.runs[1]!.id);
    expect(d.approvals[0]!.motivo).toContain('Falha ao melhorar o prompt');
  });

  it('discarding after a failure ends cleanly: one failed run, no approval, nothing else spawned', async () => {
    scenario = { 'codex-cli': 'error' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    await executor.idle();
    expect((await post(`/runs/${first.body.runId}/discard`)).status).toBe(200);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs).toHaveLength(1);
    expect(d.approvals).toEqual([]);
    expect(spawned).toEqual(['codex-cli']);
  });

  it('"run without improving" after a failure: the executor is not linked to a refined output and gets the original text', async () => {
    scenario = { 'codex-cli': 'error' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true }, 'pedido {{ opcoes.melhorarPrompt }} original');
    await executor.idle();
    await post(`/runs/${first.body.runId}/continue`, {});
    await executor.idle();
    expect(rec(1).stdin).toBe('pedido {{ opcoes.melhorarPrompt }} original');
    expect((await detail(sid)).messages.filter((m) => m.papel === 'agente')).toEqual([]);
  });

  it('a failing refiner on an unfinished pause survives a server restart as 410 and closes the approval', async () => {
    scenario = { 'codex-cli': 'error' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    await executor.idle();
    const restarted = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
    const res = await restarted.inject({ method: 'POST', url: `/runs/${first.body.runId}/retry`, headers: { host: '127.0.0.1:4317', 'content-type': 'application/json' }, payload: { provider: 'claude-cli' } });
    expect(res.statusCode).toBe(410);
    expect((await detail(sid)).approvals).toEqual([]);
    await restarted.close();
  });
});

describe('cancellation', () => {
  it('cancelling the refiner run ends the pipeline: no approval, no executor run', async () => {
    scenario = { 'codex-cli': 'hang' };
    await setup();
    const sid = await newSession();
    const first = await send(sid, { melhorarPrompt: true });
    // wait for the process to be live
    for (let i = 0; i < 50 && spawned.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 200));
    expect((await post(`/runs/${first.body.runId}/cancel`)).status).toBeLessThan(300);
    await executor.idle();
    const d = await detail(sid);
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]!.status).toBe('cancelado');
    expect(d.approvals).toEqual([]);
  });
});

// --- PipelineRunner with a stub executor: edge cases that need full control over step outcomes -----------------

describe('PipelineRunner (stub executor)', () => {
  function harness() {
    const db = openDb();
    migrate(db);
    const r = createRepos(db);
    const session = r.sessions.create({});
    const submitted: SubmitInput[] = [];
    let n = 0;
    const stub = {
      submit(input: SubmitInput): Run {
        submitted.push(input);
        n++;
        return r.runs.start({
          provedor: input.provider,
          sessionId: input.sessionId,
          ...(input.etapa ? { etapa: input.etapa } : {}),
          ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        });
      },
    } as unknown as Executor;
    const library = new Library();
    const runner = new PipelineRunner({ repos: r, executor: stub, library });
    const req = (over: object = {}) => ({ sessionId: session.id, pedido: 'faça X', cwd: dir, editarAntes: true, executar: { provider: 'claude-cli' }, ...over });
    return { r, runner, submitted, req, count: () => n };
  }
  const finish = (h: ReturnType<typeof harness>, i: number, outcome: { status: 'ok' | 'erro' | 'cancelado'; result?: string; error?: string }) => {
    const run = h.r.runs.listBySession(h.submitted[i]!.sessionId)[i]!;
    h.submitted[i]!.after!({ run, status: outcome.status, result: outcome.result ?? '', ...(outcome.error ? { error: outcome.error } : {}) });
    return run;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owl-qa06-'));
  });

  it('checkbox off: only "executar" is submitted, with the original request and no parent', () => {
    const h = harness();
    h.runner.start(h.req(), { melhorarPrompt: false });
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]).toMatchObject({ etapa: 'executar', texto: 'faça X', provider: 'claude-cli', storeAs: 'assistente', recordUserMessage: false });
    expect(h.submitted[0]!.parentRunId).toBeUndefined();
  });

  it('the refiner step is stored as "agente" and receives the agent system prompt', () => {
    const h = harness();
    h.runner.start(h.req(), { melhorarPrompt: true });
    expect(h.submitted[0]).toMatchObject({ etapa: 'melhorar', storeAs: 'agente', provider: 'codex-cli' });
    expect(h.submitted[0]!.systemAppend).toContain('SOMENTE o prompt reescrito');
  });

  it('review pause: the original request is stored exactly once', () => {
    const h = harness();
    const first = h.runner.start(h.req(), { melhorarPrompt: true });
    expect(h.r.messages.list(first.sessionId!).filter((m) => m.papel === 'usuario')).toHaveLength(1);
  });

  it('an empty refiner output is a failed refinement: the user is asked, the executor does NOT run', () => {
    for (const result of ['', '  \n ']) {
      const h = harness();
      h.runner.start(h.req({ editarAntes: false }), { melhorarPrompt: true });
      const refiner = finish(h, 0, { status: 'ok', result });
      expect(h.submitted).toHaveLength(1);
      const pending = h.r.approvals.pendingBySession(refiner.sessionId!);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.motivo).toContain('não devolveu nenhum texto');
      // from there the user can still run the original request
      h.runner.continue(refiner.id);
      expect(h.submitted[1]).toMatchObject({ etapa: 'executar', texto: 'faça X' });
      expect(h.submitted[1]!.parentRunId).toBeUndefined();
    }
  });

  it('a cancelled refiner ends the pipeline silently', () => {
    const h = harness();
    h.runner.start(h.req(), { melhorarPrompt: true });
    finish(h, 0, { status: 'cancelado' });
    expect(h.submitted).toHaveLength(1);
    expect(h.r.approvals.pendingBySession(h.submitted[0]!.sessionId)).toEqual([]);
  });

  it('continue/retry/discard on an unknown run raise PipelineError 404', () => {
    const h = harness();
    for (const f of [() => h.runner.continue('x'), () => h.runner.retry('x', { provider: 'claude-cli' }), () => h.runner.discard('x')]) {
      expect(f).toThrowError(PipelineError);
      try { f(); } catch (e) { expect((e as PipelineError).status).toBe(404); }
    }
  });

  it('review pause then continue(edit): executar gets the edit, parent is the refiner run', () => {
    const h = harness();
    h.runner.start(h.req(), { melhorarPrompt: true });
    const refiner = finish(h, 0, { status: 'ok', result: 'melhorado' });
    expect(h.submitted).toHaveLength(1); // paused
    h.runner.continue(refiner.id, 'editado');
    expect(h.submitted[1]).toMatchObject({ etapa: 'executar', texto: 'editado', parentRunId: refiner.id });
  });

  it('retry overrides the refiner model but keeps the agent system prompt', () => {
    const h = harness();
    h.runner.start(h.req(), { melhorarPrompt: true });
    const failed = finish(h, 0, { status: 'erro', error: 'limit' });
    h.runner.retry(failed.id, { provider: 'claude-cli', model: 'haiku' });
    expect(h.submitted[1]).toMatchObject({ etapa: 'melhorar', provider: 'claude-cli', model: 'haiku' });
    expect(h.submitted[1]!.systemAppend).toContain('SOMENTE o prompt reescrito');
    expect(h.submitted[1]!.parentRunId).toBeUndefined();
  });

  it('the executor step after a retry should still be linked to the refiner run it consumed', () => {
    const h = harness();
    h.runner.start(h.req({ editarAntes: false }), { melhorarPrompt: true });
    const failed = finish(h, 0, { status: 'erro', error: 'limit' });
    h.runner.retry(failed.id, { provider: 'claude-cli', model: 'haiku' });
    const retried = finish(h, 1, { status: 'ok', result: 'melhorado' });
    expect(h.submitted[2]!.parentRunId).toBe(retried.id);
  });
});
