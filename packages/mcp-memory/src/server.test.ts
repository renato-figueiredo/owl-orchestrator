import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRepos, migrate, openDb } from '@owl/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryServer, MAX_FACTS_PER_RUN, MEMORY_TOOLS, type MemoryScope } from './server.js';

let db: ReturnType<typeof openDb>;
let repos: ReturnType<typeof createRepos>;
let a: { id: string };
let b: { id: string };
let sa: { id: string };
let sa2: { id: string };
let sb: { id: string };
let loose: { id: string };

async function connect(scope: MemoryScope) {
  const server = createMemoryServer({ read: db, write: db, scope });
  const client = new Client({ name: 'test', version: '0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    return { error: r.isError === true, text: r.content.map((x) => x.text).join('\n') };
  };
  return { client, call };
}

beforeEach(() => {
  db = openDb();
  migrate(db);
  repos = createRepos(db);
  a = repos.projects.create({ nome: 'A', pasta: '/tmp/a' });
  b = repos.projects.create({ nome: 'B', pasta: '/tmp/b' });
  sa = repos.sessions.create({ projectId: a.id, titulo: 'Conversa A1' });
  sa2 = repos.sessions.create({ projectId: a.id, titulo: 'Conversa A2' });
  sb = repos.sessions.create({ projectId: b.id, titulo: 'Conversa B' });
  loose = repos.sessions.create({ titulo: 'Solta' });
  repos.messages.add({ sessionId: sa.id, papel: 'usuario', conteudo: 'usamos o banco postgres no projeto A' });
  repos.messages.add({ sessionId: sa2.id, papel: 'assistente', conteudo: 'decidimos migrar para postgres' });
  repos.messages.add({ sessionId: sb.id, papel: 'usuario', conteudo: 'segredo do projeto B: postgres' });
  repos.messages.add({ sessionId: loose.id, papel: 'usuario', conteudo: 'postgres numa conversa solta' });
});

describe('memory MCP server', () => {
  it('exposes exactly the four tools', async () => {
    const { client } = await connect({ projectId: a.id, sessionId: sa.id });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...MEMORY_TOOLS].sort());
  });

  it('buscar_memoria finds messages of the whole project and never of another one', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    const r = await call('buscar_memoria', { consulta: 'postgres' });
    expect(r.text).toContain('projeto A');
    expect(r.text).toContain('migrar');
    expect(r.text).not.toContain('projeto B');
    expect(r.text).not.toContain('solta');
  });

  it('buscar_memoria in a conversation without a project sees only that conversation', async () => {
    const { call } = await connect({ projectId: null, sessionId: loose.id });
    const r = await call('buscar_memoria', { consulta: 'postgres' });
    expect(r.text).toContain('solta');
    expect(r.text).not.toContain('projeto');
  });

  it('buscar_memoria treats FTS operators as plain words and reports an empty result', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('buscar_memoria', { consulta: '"* NEAR (' })).error).toBe(false);
    expect((await call('buscar_memoria', { consulta: 'inexistente' })).text).toBe('Nenhum resultado.');
  });

  it('buscar_memoria skips conversations in the trash', async () => {
    db.prepare("UPDATE sessions SET deleted_at = datetime('now') WHERE id = ?").run(sa2.id);
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('buscar_memoria', { consulta: 'migrar' })).text).toBe('Nenhum resultado.');
  });

  it('rejects out-of-range arguments', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('buscar_memoria', { consulta: 'x', limite: 99 })).error).toBe(true);
    expect((await call('buscar_memoria', { consulta: '   ' })).error).toBe(true);
    expect((await call('salvar_fato', { texto: 'x'.repeat(501) })).error).toBe(true);
  });

  it('ler_resumo reads this conversation, or the others of the project', async () => {
    db.prepare('UPDATE sessions SET resumo = ? WHERE id = ?').run('resumo da A1', sa.id);
    db.prepare('UPDATE sessions SET resumo = ? WHERE id = ?').run('resumo da A2', sa2.id);
    db.prepare('UPDATE sessions SET resumo = ? WHERE id = ?').run('resumo da B', sb.id);
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('ler_resumo')).text).toBe('resumo da A1');
    const all = await call('ler_resumo', { alvo: 'projeto' });
    expect(all.text).toContain('resumo da A2');
    expect(all.text).not.toContain('resumo da B');
    expect(all.text).not.toContain('resumo da A1');
  });

  it('ler_resumo of the project is refused without a project', async () => {
    const { call } = await connect({ projectId: null, sessionId: loose.id });
    expect((await call('ler_resumo', { alvo: 'projeto' })).error).toBe(true);
    expect((await call('ler_resumo')).text).toContain('ainda não tem resumo');
  });

  it('salvar_fato stores an unpinned fact in the scope, with the run as origin', async () => {
    const run = repos.runs.start({ provedor: 'claude-cli', sessionId: sa.id });
    const { call } = await connect({ projectId: a.id, sessionId: sa.id, runId: run.id });
    expect((await call('salvar_fato', { texto: 'usar pnpm', fixado: true })).text).toBe('Fato salvo.');
    const [fact] = repos.facts.listScope({ projectId: a.id });
    expect(fact).toMatchObject({ texto: 'usar pnpm', fixado: false, projectId: a.id, origemRunId: run.id });
    expect(repos.facts.listScope({ projectId: b.id })).toEqual([]);
  });

  it('salvar_fato ignores an unknown run id instead of failing', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id, runId: 'does-not-exist' });
    expect((await call('salvar_fato', { texto: 'ok' })).error).toBe(false);
    expect(repos.facts.listScope({ projectId: a.id })[0]?.origemRunId).toBeNull();
  });

  it('salvar_fato skips duplicates and caps the number of facts per run', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    await call('salvar_fato', { texto: 'repetido' });
    expect((await call('salvar_fato', { texto: 'repetido' })).text).toContain('já estava salvo');
    for (let i = 1; i < MAX_FACTS_PER_RUN; i++) await call('salvar_fato', { texto: `fato ${i}` });
    const over = await call('salvar_fato', { texto: 'um a mais' });
    expect(over.error).toBe(true);
    expect(repos.facts.listScope({ projectId: a.id })).toHaveLength(MAX_FACTS_PER_RUN);
  });

  it('listar_fatos shows only the scope and marks pinned facts', async () => {
    repos.facts.add({ texto: 'do A', projectId: a.id, fixado: true });
    repos.facts.add({ texto: 'do B', projectId: b.id });
    repos.facts.add({ texto: 'sem projeto', sessionId: loose.id });
    repos.facts.add({ texto: 'de outra solta' });
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('listar_fatos')).text).toBe('- [fixado] do A');
    const none = await connect({ projectId: null, sessionId: loose.id });
    expect((await none.call('listar_fatos')).text).toBe('- sem projeto');
  });

  it('writes nothing outside facts', async () => {
    const before = db.prepare('SELECT (SELECT COUNT(*) FROM messages) m, (SELECT COUNT(*) FROM sessions) s').get();
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    await call('buscar_memoria', { consulta: 'postgres' });
    await call('ler_resumo', { alvo: 'projeto' });
    await call('salvar_fato', { texto: 'x' });
    expect(db.prepare('SELECT (SELECT COUNT(*) FROM messages) m, (SELECT COUNT(*) FROM sessions) s').get()).toEqual(before);
  });
});
