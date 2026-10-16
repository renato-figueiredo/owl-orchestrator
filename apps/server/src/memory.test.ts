import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
let app: FastifyInstance;
let executor: Executor;
let repos: ReturnType<typeof createRepos>;
let base: string;
let scenario: Record<string, string>;
let spawned: Array<{ provider: string; record: string }>;

const rec = (i: number) => JSON.parse(readFileSync(spawned[i]!.record, 'utf8')) as { argv: string[]; stdin: string };
/** The memory block of a run = what comes before the request in the prompt. */
const prefixOf = (i: number, texto: string) => {
  const stdin = rec(i).stdin;
  expect(stdin.endsWith(texto), `run ${i} ends with its request`).toBe(true);
  return stdin.slice(0, stdin.length - texto.length);
};

async function setup() {
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
  executor = new Executor({
    repos,
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
  app = buildApp({ repos, executor, defaultCwd: dir, workspaceRoots: [tmpdir()] });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  // The summarizer is Codex in these tests so its scenario can differ from the chat provider (Claude).
  await put('/settings', { memory: { resumidor: { provider: 'codex-cli' }, resumoAutomatico: false } });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-mem-'));
  scenario = { 'codex-cli': 'summary-ok' };
  spawned = [];
});
afterEach(async () => {
  await executor.shutdown();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Loosely typed JSON of the API: these tests assert on the shapes they care about. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: (await r.json()) as Json };
};
const post = (p: string, b?: unknown) => call('POST', p, b ?? {});
const put = (p: string, b?: unknown) => call('PUT', p, b);
const get = (p: string) => call('GET', p);

async function project(nome: string) {
  const pasta = mkdtempSync(join(tmpdir(), 'owl-mem-proj-'));
  const r = await post('/projects', { nome, pasta });
  return r.body.project.id as string;
}
async function session(projectId?: string) {
  return (await post('/sessions', projectId ? { projectId } : {})).body.session.id as string;
}
async function say(sid: string, texto: string, extra: object = {}) {
  const r = await post(`/sessions/${sid}/messages`, { texto, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  await executor.idle();
  return r.body.runId as string;
}
const pinnedFact = (projectId: string | undefined, texto: string, fixado = true, sessionId?: string) =>
  post('/facts', { texto, fixado, ...(projectId ? { projectId } : sessionId ? { sessionId } : {}) });

describe('memory block when the CLI has no session to resume', () => {
  it('a new conversation in a project starts with the project\'s PINNED facts (not the unpinned ones)', async () => {
    await setup();
    const p = await project('A');
    await pinnedFact(p, 'Usar pnpm, nunca npm');
    await pinnedFact(p, 'rascunho não fixado', false);
    await say(await session(p), 'crie o pacote');
    const prefix = prefixOf(0, 'crie o pacote');
    expect(prefix).toContain('Fatos fixados');
    expect(prefix).toContain('- Usar pnpm, nunca npm');
    expect(prefix).not.toContain('rascunho');
  });

  it('facts never cross projects, nor reach a conversation with no project', async () => {
    await setup();
    const a = await project('A');
    const b = await project('B');
    await pinnedFact(a, 'segredo do projeto A');
    const other = await session();
    await pinnedFact(undefined, 'fato de outra conversa solta', true, other);
    await say(await session(b), 'pedido B');
    await say(await session(), 'pedido solto');
    expect(rec(0).stdin).toBe('pedido B'); // B has no facts: no block at all
    expect(rec(1).stdin).toBe('pedido solto'); // no block: another loose conversation's fact does not reach it
    expect(rec(1).stdin).not.toContain('segredo do projeto A');
    await say(await session(a), 'pedido A');
    expect(prefixOf(2, 'pedido A')).toContain('segredo do projeto A');
    expect(rec(2).stdin).not.toContain('fato de outra conversa solta');
  });

  it('a conversation with no project sees its own pinned facts, and only those', async () => {
    await setup();
    const mine = await session();
    await pinnedFact(undefined, 'regra só desta conversa', true, mine);
    await say(mine, 'pedido solto');
    expect(prefixOf(0, 'pedido solto')).toContain('- regra só desta conversa');
  });

  it('switching provider hands over summary and recent messages, without repeating the current request', async () => {
    await setup();
    const sid = await session();
    await say(sid, 'primeira pergunta');
    repos.sessions.setSummary(sid, 'Estamos montando o login.', repos.messages.list(sid).at(-1)!.id);
    await say(sid, 'segunda pergunta'); // still Claude: resumes, plain prompt
    expect(rec(1).stdin).toBe('segunda pergunta');

    await say(sid, 'terceira, agora no Codex', { provider: 'codex-cli' });
    const prefix = prefixOf(2, 'terceira, agora no Codex');
    expect(prefix).toContain('Resumo da conversa');
    expect(prefix).toContain('Estamos montando o login.');
    expect(prefix).toContain('Usuário: primeira pergunta');
    expect(prefix).toContain('Usuário: segunda pergunta');
    expect(prefix).toContain('Assistente: ok');
    expect(prefix).not.toContain('terceira'); // the current request is not history
    expect(rec(2).argv.join(' ')).not.toContain('--resume'); // the other CLI starts a fresh session
  });

  it('respects the configured budget end to end', async () => {
    await setup();
    await put('/settings', { memory: { orcamentoTokens: 200, ultimasN: 50 } });
    const sid = await session();
    const sidP = sid;
    for (let i = 0; i < 6; i++) {
      repos.messages.add({ sessionId: sidP, papel: 'usuario', conteudo: `pergunta ${i} ${'x'.repeat(300)}` });
      repos.messages.add({ sessionId: sidP, papel: 'assistente', conteudo: `resposta ${i} ${'y'.repeat(300)}` });
    }
    await say(sid, 'agora', { provider: 'codex-cli' });
    const prefix = prefixOf(0, 'agora');
    expect(Math.ceil(prefix.length / 4)).toBeLessThanOrEqual(200);
    expect(prefix).toContain('resposta 5'); // the newest survive
  });

  it('the refiner never receives memory', async () => {
    await setup();
    const p = await project('A');
    await pinnedFact(p, 'fato do projeto');
    await say(await session(p), 'faça X', { melhorarPrompt: true });
    // spawn 0 = refiner (Codex fake), spawn 1 = executor
    expect(rec(0).stdin).toBe('faça X');
    expect(prefixOf(1, rec(1).stdin)).toBe(''); // sanity: helper
    expect(rec(1).stdin).toContain('fato do projeto');
  });
});

describe('with --resume only NEW pinned facts are sent', () => {
  it('nothing new → plain prompt; a fact pinned after the last run → just that one', async () => {
    await setup();
    const p = await project('A');
    await pinnedFact(p, 'fato antigo');
    const sid = await session(p);
    await say(sid, 'um');
    expect(rec(0).stdin).toContain('fato antigo'); // first turn: full block
    await new Promise((r) => setTimeout(r, 1100)); // facts and runs are timestamped to the second
    await say(sid, 'dois');
    expect(rec(1).stdin).toBe('dois'); // resumed, nothing new

    await new Promise((r) => setTimeout(r, 1100));
    await pinnedFact(p, 'fato novo fixado');
    await pinnedFact(p, 'novo mas não fixado', false);
    await say(sid, 'três');
    const prefix = prefixOf(2, 'três');
    expect(prefix).toContain('- fato novo fixado');
    expect(prefix).not.toContain('fato antigo');
    expect(prefix).not.toContain('não fixado');
    expect(rec(2).argv.join(' ')).toContain('--resume=');
  }, 15_000);
});

describe('with --resume a fact pinned (or edited) later still reaches the conversation', () => {
  it('a fact created unpinned before the last run and pinned after it is sent', async () => {
    await setup();
    const p = await project('A');
    const old = (await pinnedFact(p, 'criado antes, fixado depois', false)).body.fact.id as string;
    const sid = await session(p);
    await say(sid, 'um');
    await new Promise((r) => setTimeout(r, 1100));
    await say(sid, 'dois');
    expect(rec(1).stdin).toBe('dois');
    await new Promise((r) => setTimeout(r, 1100));
    await call('PATCH', `/facts/${old}`, { fixado: true });
    await say(sid, 'três');
    expect(prefixOf(2, 'três')).toContain('- criado antes, fixado depois');
  }, 15_000);
});

describe('related snippets (full-text search)', () => {
  it('adds a snippet only when the request really matches an older message of the project', async () => {
    await setup();
    const p = await project('A');
    const old = await session(p);
    repos.messages.add({ sessionId: old, papel: 'usuario', conteudo: 'A migração do banco de postgres para sqlite foi concluída ontem' });
    repos.messages.add({ sessionId: old, papel: 'assistente', conteudo: 'Receita de bolo de cenoura com cobertura' });

    await say(await session(p), 'como ficou a migração do banco postgres?');
    expect(prefixOf(0, 'como ficou a migração do banco postgres?')).toContain('Trechos relacionados');
    expect(rec(0).stdin).toContain('migração do banco de postgres para sqlite');
    expect(rec(0).stdin).not.toContain('bolo de cenoura');

    await say(await session(p), 'qual a capital da França atual');
    expect(rec(1).stdin).toBe('qual a capital da França atual'); // nothing relevant: no block
  });

  it('a conversation with no project searches only itself, and the switch can turn snippets off', async () => {
    await setup();
    const other = await session();
    repos.messages.add({ sessionId: other, papel: 'usuario', conteudo: 'a migração do banco postgres é confidencial' });
    await say(await session(), 'resumo da migração do banco postgres');
    expect(rec(0).stdin).not.toContain('confidencial');

    await put('/settings', { memory: { trechosFts: false } });
    const p = await project('B');
    const old = await session(p);
    repos.messages.add({ sessionId: old, papel: 'usuario', conteudo: 'a migração do banco postgres foi feita' });
    await say(await session(p), 'conte sobre a migração do banco postgres');
    expect(rec(1).stdin).toBe('conte sobre a migração do banco postgres');
  });
});

describe('incremental summary', () => {
  it('sends the previous summary and ONLY the messages after the marker, then stores the result and the new facts', async () => {
    await setup();
    const sid = await session();
    const old1 = repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'mensagem antiga já resumida' });
    repos.sessions.setSummary(sid, 'Resumo anterior.', old1.id);
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'pedido novo do usuário' });
    const last = repos.messages.add({ sessionId: sid, papel: 'assistente', conteudo: 'resposta nova do assistente' });
    repos.messages.add({ sessionId: sid, papel: 'sistema', conteudo: 'aviso interno que não é conversa' });

    const r = await post(`/sessions/${sid}/summarize`);
    expect(r.body).toMatchObject({ ok: true, fatosNovos: 2 });
    const stdin = rec(0).stdin;
    expect(stdin).toContain('RESUMO ANTERIOR:\nResumo anterior.');
    expect(stdin).toContain('pedido novo do usuário');
    expect(stdin).toContain('resposta nova do assistente');
    expect(stdin).not.toContain('mensagem antiga já resumida');
    expect(stdin).not.toContain('aviso interno');

    const s = repos.sessions.get(sid)!;
    expect(s.resumo).toBe('Resumo novo da conversa.\n\nPendências:\n- Escrever os testes');
    expect(s.resumoAnterior).toBe('Resumo anterior.');
    expect(s.resumoAteMessageId).toBe(last.id + 0); // up to the last CHAT message summarized
    const facts = repos.facts.listScope({ projectId: null, sessionId: sid });
    expect(facts.map((f) => f.texto)).toEqual(['Usar pnpm no projeto', 'Responder em português']);
    expect(facts.every((f) => !f.fixado)).toBe(true); // the user decides what to pin
    // the summary run is recorded (transparent usage) but is not a chat message
    expect(repos.runs.listBySession(sid)[0]).toMatchObject({ etapa: 'resumo', status: 'ok', tokensIn: 50 });
    expect(repos.messages.list(sid).filter((m) => m.runId)).toEqual([]);
  });

  it('a second call right after has nothing new to summarize and spawns nothing', async () => {
    await setup();
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'algo' });
    expect((await post(`/sessions/${sid}/summarize`)).body.ok).toBe(true);
    const again = await post(`/sessions/${sid}/summarize`);
    expect(again.body).toMatchObject({ ok: false, code: 'nothing_to_summarize' });
    expect(spawned).toHaveLength(1);
  });

  it('facts already known are not added twice', async () => {
    await setup();
    const sid = await session();
    await pinnedFact(undefined, 'usar PNPM no projeto', false, sid);
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'algo' });
    const r = await post(`/sessions/${sid}/summarize`);
    expect(r.body.fatosNovos).toBe(1); // "Usar pnpm no projeto" matched case-insensitively
  });

  it('INVALID output keeps the existing summary, marker and facts untouched', async () => {
    scenario = { 'codex-cli': 'summary-bad' };
    await setup();
    const sid = await session();
    const m = repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'antes' });
    repos.sessions.setSummary(sid, 'Resumo bom.', m.id);
    repos.sessions.setSummary(sid, 'Resumo bom.', m.id); // previous == current: no accidental diff
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'depois' });
    const before = repos.sessions.get(sid)!;

    const r = await post(`/sessions/${sid}/summarize`);
    expect(r.body).toMatchObject({ ok: false, code: 'invalid_output' });
    const after = repos.sessions.get(sid)!;
    expect(after.resumo).toBe(before.resumo);
    expect(after.resumoAnterior).toBe(before.resumoAnterior);
    expect(after.resumoAteMessageId).toBe(before.resumoAteMessageId);
    expect(repos.facts.listScope({ projectId: null })).toEqual([]);
    expect(repos.messages.list(sid).at(-1)).toMatchObject({ papel: 'sistema', conteudo: expect.stringContaining('resumo anterior foi mantido') });
  });

  it('a failing summarizer (limit, crash) also changes nothing', async () => {
    scenario = { 'codex-cli': 'error' };
    await setup();
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'algo' });
    const r = await post(`/sessions/${sid}/summarize`);
    expect(r.body).toMatchObject({ ok: false, code: 'run_failed' });
    expect(repos.sessions.get(sid)).toMatchObject({ resumo: null, resumoAteMessageId: null });
  });

  it('the summarizer is stateless and runs outside any project folder', async () => {
    await setup();
    const p = await project('A');
    const sid = await session(p);
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'algo' });
    await post(`/sessions/${sid}/summarize`);
    expect(rec(0).argv.join(' ')).not.toContain('--resume');
    expect(repos.sessions.get(sid)!.cliSessionId).toBeNull(); // did not take the conversation's slot
  });
});

describe('automatic summary', () => {
  it('runs after enough new messages, once, and does not trigger itself', async () => {
    await setup();
    await put('/settings', { memory: { resumoAutomatico: true, resumirACada: 2 } });
    const sid = await session();
    await say(sid, 'primeira'); // user + assistant = 2 new messages
    await executor.idle();
    expect(spawned.map((s) => s.provider)).toEqual(['claude-cli', 'codex-cli']); // chat, then the summary
    await executor.idle();
    expect(repos.sessions.get(sid)!.resumo).toContain('Resumo novo');
    expect(spawned).toHaveLength(2); // no loop
  });

  it('is off when disabled, and waits for the threshold', async () => {
    await setup();
    const sid = await session();
    await say(sid, 'a');
    expect(spawned).toHaveLength(1); // auto summary disabled in setup()
    await put('/settings', { memory: { resumoAutomatico: true, resumirACada: 10 } });
    await say(sid, 'b');
    expect(spawned).toHaveLength(2); // 4 messages < 10: still no summary
  });
});

describe('summarizer safety and failure handling', () => {
  it('runs with no tools at all', async () => {
    await setup();
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'texto não confiável' });
    await post(`/sessions/${sid}/summarize`);
    const argv = rec(0).argv;
    const i = argv.indexOf('--tools');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('');
  });

  it('after a failed automatic summary it waits for another full batch, and stays silent in the conversation', async () => {
    scenario = { 'codex-cli': 'summary-bad' };
    await setup();
    await put('/settings', { memory: { resumoAutomatico: true, resumirACada: 3 } });
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'antes' });
    const summaries = () => spawned.filter((s) => s.provider === 'codex-cli').length;

    await say(sid, 'a'); // 3 pending → tries, invalid JSON
    await executor.idle();
    expect(summaries()).toBe(1);
    await say(sid, 'b'); // 5 pending < 3 + 3 → no new attempt
    await executor.idle();
    expect(summaries()).toBe(1);
    await say(sid, 'c'); // 7 pending ≥ 6 → tries again
    await executor.idle();
    expect(summaries()).toBe(2);
    expect(repos.messages.list(sid).filter((m) => m.papel === 'sistema')).toEqual([]);
  });

  it('a manual failure still tells the user', async () => {
    scenario = { 'codex-cli': 'summary-bad' };
    await setup();
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'algo' });
    await post(`/sessions/${sid}/summarize`);
    expect(repos.messages.list(sid).some((m) => m.papel === 'sistema')).toBe(true);
  });
});

describe('ultimasN = 0 end to end', () => {
  it('the handover carries no recent messages', async () => {
    await setup();
    await put('/settings', { memory: { ultimasN: 0 } });
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'conversa antiga' });
    repos.messages.add({ sessionId: sid, papel: 'assistente', conteudo: 'resposta antiga' });
    await say(sid, 'nova');
    expect(rec(0).stdin).not.toContain('conversa antiga');
    expect(rec(0).stdin).not.toContain('resposta antiga');
  });
});

describe('summary editing', () => {
  it('edit keeps the previous version; undo swaps, a second undo redoes; none to undo → 409', async () => {
    await setup();
    const sid = await session();
    expect((await post(`/sessions/${sid}/summary/undo`)).status).toBe(409);
    await put(`/sessions/${sid}/summary`, { resumo: 'versão 1' });
    await put(`/sessions/${sid}/summary`, { resumo: 'versão 2' });
    expect(repos.sessions.get(sid)).toMatchObject({ resumo: 'versão 2', resumoAnterior: 'versão 1' });
    await post(`/sessions/${sid}/summary/undo`);
    expect(repos.sessions.get(sid)).toMatchObject({ resumo: 'versão 1', resumoAnterior: 'versão 2' });
    await post(`/sessions/${sid}/summary/undo`);
    expect(repos.sessions.get(sid)!.resumo).toBe('versão 2');
    expect((await put(`/sessions/${sid}/summary`, { resumo: '   ' })).status).toBe(400);
    expect((await put('/sessions/nope/summary', { resumo: 'x' })).status).toBe(404);
  });

  it('a user-edited summary is what the next handover carries', async () => {
    await setup();
    const sid = await session();
    await say(sid, 'pergunta');
    await put(`/sessions/${sid}/summary`, { resumo: 'RESUMO ESCRITO PELO USUÁRIO' });
    await say(sid, 'agora no outro', { provider: 'codex-cli' });
    expect(prefixOf(1, 'agora no outro')).toContain('RESUMO ESCRITO PELO USUÁRIO');
  });
});

describe('settings and facts API', () => {
  it('settings have defaults, merge partial updates, persist and validate', async () => {
    await setup();
    const fresh = openDb();
    migrate(fresh);
    const defaults = (await get('/settings')).body.memory;
    expect(defaults).toMatchObject({ ultimasN: 8, resumirACada: 10, orcamentoTokens: 4000, trechosFts: true });
    expect((await put('/settings', { memory: { ultimasN: 3 } })).body.memory).toMatchObject({ ultimasN: 3, resumirACada: 10 });
    expect((await get('/settings')).body.memory.ultimasN).toBe(3);
    for (const bad of [{ ultimasN: -1 }, { resumirACada: 1 }, { orcamentoTokens: 50 }, { orcamentoTokens: 1e9 }, { resumidor: { provider: 'x', model: '--bad' } }]) {
      expect((await put('/settings', { memory: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await put('/settings', { memory: { resumidor: { provider: 'nope' } } })).body.error.code).toBe('unknown_provider');
    void fresh;
  });

  it('the summarizer defaults to haiku on Claude (it runs often; the Codex limit is low)', async () => {
    await setup();
    repos.settings.set('memory', {}); // nothing customised
    expect((await get('/settings')).body.memory.resumidor).toEqual({ provider: 'claude-cli', model: 'haiku' });
  });

  it('a corrupted stored value falls back to defaults instead of breaking', async () => {
    await setup();
    repos.settings.set('memory', { ultimasN: 'muitas' });
    expect((await get('/settings')).body.memory.ultimasN).toBe(8);
  });

  it('facts: create, scope, edit, pin, delete, validate', async () => {
    await setup();
    const p = await project('A');
    const mine = (await pinnedFact(p, 'do projeto', false)).body.fact;
    await pinnedFact(undefined, 'solto');
    expect((await get(`/facts?projectId=${p}`)).body.facts.map((f: { texto: string }) => f.texto)).toEqual(['do projeto']);
    expect((await get('/facts')).body.facts.map((f: { texto: string }) => f.texto)).toEqual(['solto']);
    const patched = await call('PATCH', `/facts/${mine.id}`, { texto: 'editado', fixado: true });
    expect(patched.body.fact).toMatchObject({ texto: 'editado', fixado: true });
    expect((await call('DELETE', `/facts/${mine.id}`)).status).toBe(200);
    expect((await call('DELETE', `/facts/${mine.id}`)).status).toBe(404);
    expect((await post('/facts', { texto: '' })).status).toBe(400);
    expect((await post('/facts', { texto: 'x'.repeat(501) })).status).toBe(400);
    expect((await post('/facts', { texto: 'x', projectId: 'nope' })).status).toBe(404);
  });
});

describe('QA 07: lacunas', () => {
  it('Claude -> Codex -> Claude: ao voltar, o Claude recebe o bloco (a sessão nativa foi trocada pelo Codex)', async () => {
    await setup();
    const sid = await session();
    await say(sid, 'um');
    await say(sid, 'dois', { provider: 'codex-cli' });
    await say(sid, 'três de volta');
    const argv = rec(2).argv.join(' ');
    expect(argv).not.toContain('--resume');
    expect(prefixOf(2, 'três de volta')).toContain('Usuário: dois');
  });

  it('o mesmo fato duas vezes na resposta do resumidor entra uma só vez', async () => {
    await setup();
    const sid = await session();
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'a' });
    await post(`/sessions/${sid}/summarize`);
    repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'b' });
    const r = await post(`/sessions/${sid}/summarize`); // mesmos fatos do cenário: já conhecidos
    expect(r.body.fatosNovos).toBe(0);
    expect(repos.facts.listScope({ projectId: null, sessionId: sid })).toHaveLength(2);
  });

  it('lote acima do teto de caracteres: o marcador só avança até o fim do lote e a próxima chamada pega o resto', async () => {
    await setup();
    const sid = await session();
    const big = 'z'.repeat(40_000);
    const m1 = repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: big });
    repos.messages.add({ sessionId: sid, papel: 'assistente', conteudo: big });
    const m3 = repos.messages.add({ sessionId: sid, papel: 'usuario', conteudo: 'resto final' });
    await post(`/sessions/${sid}/summarize`);
    expect(repos.sessions.get(sid)!.resumoAteMessageId).toBe(m1.id);
    expect(rec(0).stdin).not.toContain('resto final');
    await post(`/sessions/${sid}/summarize`);
    expect(repos.sessions.get(sid)!.resumoAteMessageId).toBe(m3.id - 0);
  });
});
