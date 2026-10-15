import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRepos, migrate, openDb, openReadonly } from '@owl/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { writeMcpConfig } from './config.js';
import { createMemoryServer, MAX_FACTS_PER_RUN, type MemoryScope } from './server.js';

// QA do prompt 10: lacunas de escopo, validação, limites e falhas.
let db: ReturnType<typeof openDb>;
let repos: ReturnType<typeof createRepos>;
let a: { id: string };
let b: { id: string };
let sa: { id: string };
let sb: { id: string };
let loose1: { id: string };
let loose2: { id: string };

async function connect(scope: MemoryScope, read = db) {
  const server = createMemoryServer({ read, write: db, scope });
  const client = new Client({ name: 'qa', version: '0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args }).catch((e: unknown) => ({ isError: true, content: [{ text: String(e) }] }))) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
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
  sa = repos.sessions.create({ projectId: a.id, titulo: 'A1' });
  sb = repos.sessions.create({ projectId: b.id, titulo: 'B1' });
  loose1 = repos.sessions.create({ titulo: 'Solta 1' });
  loose2 = repos.sessions.create({ titulo: 'Solta 2' });
});

describe('QA 10 — escopo', () => {
  it('a conversa solta nunca enxerga mensagens de outra conversa solta nem de projeto', async () => {
    repos.messages.add({ sessionId: loose1.id, papel: 'usuario', conteudo: 'token zebra da solta 1' });
    repos.messages.add({ sessionId: loose2.id, papel: 'usuario', conteudo: 'token zebra da solta 2' });
    repos.messages.add({ sessionId: sa.id, papel: 'usuario', conteudo: 'token zebra do projeto' });
    const { call } = await connect({ projectId: null, sessionId: loose1.id });
    const r = await call('buscar_memoria', { consulta: 'zebra' });
    expect(r.text).toContain('solta 1');
    expect(r.text).not.toContain('solta 2');
    expect(r.text).not.toContain('projeto');
  });

  it('ler_resumo da conversa solta não devolve o resumo de outra', async () => {
    db.prepare('UPDATE sessions SET resumo = ? WHERE id = ?').run('resumo secreto 2', loose2.id);
    const { call } = await connect({ projectId: null, sessionId: loose1.id });
    expect((await call('ler_resumo')).text).not.toContain('secreto');
  });

  it('ler_resumo "sessao" com sessão de outro projeto no scope não existe: devolve texto neutro', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: 'nao-existe' });
    expect((await call('ler_resumo')).text).toContain('ainda não tem resumo');
  });

  it('ler_resumo do projeto ignora conversas na lixeira? (resumos de conversas apagadas)', async () => {
    const s2 = repos.sessions.create({ projectId: a.id, titulo: 'A2' });
    db.prepare('UPDATE sessions SET resumo = ? WHERE id = ?').run('resumo da lixeira', s2.id);
    db.prepare("UPDATE sessions SET deleted_at = datetime('now') WHERE id = ?").run(s2.id);
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('ler_resumo', { alvo: 'projeto' })).text).not.toContain('lixeira');
  });

  it('listar_fatos ignora fatos de agente (agent_id) do mesmo projeto', async () => {
    const agent = db.prepare("INSERT INTO agents (id, nome) VALUES ('ag1','x')");
    try {
      agent.run();
      repos.facts.add({ texto: 'fato de agente', projectId: a.id, agentId: 'ag1' });
    } catch {
      return; // schema de agents diferente: nada a verificar
    }
    repos.facts.add({ texto: 'fato do projeto', projectId: a.id });
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    const r = await call('listar_fatos');
    expect(r.text).toContain('fato do projeto');
    expect(r.text).not.toContain('agente');
  });

  it('o mesmo texto salvo em outro projeto não conta como duplicado', async () => {
    repos.facts.add({ texto: 'igual', projectId: b.id });
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('salvar_fato', { texto: 'igual' })).text).toBe('Fato salvo.');
    expect(repos.facts.listScope({ projectId: a.id })).toHaveLength(1);
  });

  it('argumento "projeto"/"projectId" enviado pelo modelo não muda o escopo', async () => {
    repos.messages.add({ sessionId: sb.id, papel: 'usuario', conteudo: 'segredo laranja de B' });
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    const r = await call('buscar_memoria', { consulta: 'laranja', projeto: b.id, projectId: b.id, sessionId: sb.id });
    expect(r.text).not.toContain('segredo');
    const s = await call('salvar_fato', { texto: 'x-inj', projeto: b.id, projectId: b.id });
    expect(s.error).toBe(false);
    expect(repos.facts.listScope({ projectId: b.id })).toEqual([]);
    expect(repos.facts.listScope({ projectId: a.id }).map((f) => f.texto)).toEqual(['x-inj']);
  });

  // Corrigido (migração 0006): fatos de conversa sem projeto têm session_id e ficam só nela.
  it('fato salvo numa conversa solta NÃO aparece em outra conversa solta', async () => {
    const one = await connect({ projectId: null, sessionId: loose1.id });
    await one.call('salvar_fato', { texto: 'preferência privada da solta 1' });
    const two = await connect({ projectId: null, sessionId: loose2.id });
    expect((await two.call('listar_fatos')).text).not.toContain('privada');
  });
});

describe('QA 10 — validação de entrada', () => {
  it('buscar_memoria: limite inválido (0, negativo, fracionário, texto) e consulta longa/ausente', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    for (const limite of [0, -1, 1.5, '3', null, 11]) expect((await call('buscar_memoria', { consulta: 'x', limite })).error, String(limite)).toBe(true);
    expect((await call('buscar_memoria', { consulta: 'x'.repeat(501) })).error).toBe(true);
    expect((await call('buscar_memoria', {})).error).toBe(true);
    expect((await call('buscar_memoria', { consulta: 42 })).error).toBe(true);
  });

  it('ler_resumo: alvo desconhecido é rejeitado', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('ler_resumo', { alvo: 'tudo' })).error).toBe(true);
  });

  it('salvar_fato: vazio, só espaço, não-string, NUL e 500 caracteres exatos', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    for (const texto of ['', '   \n', 7, null]) expect((await call('salvar_fato', { texto })).error, String(texto)).toBe(true);
    expect((await call('salvar_fato', { texto: 'a\0b' })).error).toBe(true);
    expect((await call('salvar_fato', { texto: 'y'.repeat(500) })).error).toBe(false);
    expect(repos.facts.listScope({ projectId: a.id })).toHaveLength(1);
    expect(repos.facts.listScope({ projectId: a.id }).some((f) => f.texto.includes('\0'))).toBe(false);
  });

  it('salvar_fato apara espaços e considera "x" e " x " duplicados', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    await call('salvar_fato', { texto: '  x  ' });
    expect((await call('salvar_fato', { texto: 'x' })).text).toContain('já estava salvo');
    expect(repos.facts.listScope({ projectId: a.id }).map((f) => f.texto)).toEqual(['x']);
  });

  it('ferramenta inexistente devolve erro sem derrubar o servidor', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await call('apagar_tudo')).error).toBe(true);
    expect((await call('listar_fatos')).error).toBe(false);
  });

  it('texto com SQL/FTS hostil é tratado como dado', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    for (const q of ["'; DROP TABLE facts; --", 'a OR b AND NOT', '"', '*', 'NEAR(a b)', 'col:x', '-x', '\\']) expect((await call('buscar_memoria', { consulta: q })).error, q).toBe(false);
    await call('salvar_fato', { texto: "'; DROP TABLE facts; --" });
    expect(repos.facts.listScope({ projectId: a.id })).toHaveLength(1);
  });
});

describe('QA 10 — limites de resultado', () => {
  it('buscar_memoria respeita limite (padrão 5, máximo 10) e corta trechos longos', async () => {
    for (let i = 0; i < 15; i++) repos.messages.add({ sessionId: sa.id, papel: 'usuario', conteudo: `marcador item ${i}` });
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    const count = (t: string) => (t.match(/marcador item/g) ?? []).length;
    expect(count((await call('buscar_memoria', { consulta: 'marcador' })).text)).toBe(5);
    expect(count((await call('buscar_memoria', { consulta: 'marcador', limite: 2 })).text)).toBe(2);
    expect(count((await call('buscar_memoria', { consulta: 'marcador', limite: 10 })).text)).toBe(10);
    repos.messages.add({ sessionId: sa.id, papel: 'usuario', conteudo: `longo ${'z'.repeat(5000)}` });
    const long = (await call('buscar_memoria', { consulta: 'longo' })).text;
    expect(long.length).toBeLessThan(800);
    expect(long).toContain('…');
  });

  it('ler_resumo do projeto devolve no máximo 10 conversas e corta cada resumo em ~2000 caracteres', async () => {
    for (let i = 0; i < 14; i++) {
      const s = repos.sessions.create({ projectId: a.id, titulo: `conv${i}` });
      db.prepare('UPDATE sessions SET resumo = ? WHERE id = ?').run(`R${i} ${'w'.repeat(3000)}`, s.id);
    }
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    const t = (await call('ler_resumo', { alvo: 'projeto' })).text;
    expect((t.match(/^## /gm) ?? []).length).toBe(10);
    expect(t.length).toBeLessThan(10 * 2100);
  });

  it('o limite de fatos por execução é por servidor (execução), não global', async () => {
    const one = await connect({ projectId: a.id, sessionId: sa.id });
    for (let i = 0; i < MAX_FACTS_PER_RUN; i++) await one.call('salvar_fato', { texto: `f${i}` });
    expect((await one.call('salvar_fato', { texto: 'extra' })).error).toBe(true);
    const two = await connect({ projectId: a.id, sessionId: sa.id });
    expect((await two.call('salvar_fato', { texto: 'extra' })).error).toBe(false);
  });

  it('duplicado não consome a cota de fatos da execução', async () => {
    const { call } = await connect({ projectId: a.id, sessionId: sa.id });
    for (let i = 0; i < 30; i++) await call('salvar_fato', { texto: 'mesmo' });
    for (let i = 0; i < MAX_FACTS_PER_RUN - 1; i++) expect((await call('salvar_fato', { texto: `n${i}` })).error).toBe(false);
  });
});

describe('QA 10 — falhas', () => {
  it('conexão somente leitura: salvar_fato continua funcionando pela conexão de escrita e a leitura não escreve', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-qa10-'));
    try {
      const file = join(dir, 'o.sqlite');
      const w = openDb(file);
      migrate(w);
      const r = createRepos(w);
      const p = r.projects.create({ nome: 'P', pasta: dir });
      const s = r.sessions.create({ projectId: p.id });
      const ro = openReadonly(file);
      expect(() => ro.prepare("INSERT INTO facts (id, texto) VALUES ('x','y')").run()).toThrow();
      const server = createMemoryServer({ read: ro, write: w, scope: { projectId: p.id, sessionId: s.id } });
      const client = new Client({ name: 'qa', version: '0' });
      const [c, sv] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(sv), client.connect(c)]);
      await client.callTool({ name: 'salvar_fato', arguments: { texto: 'visível na leitura' } });
      const listed = (await client.callTool({ name: 'listar_fatos', arguments: {} })) as { content: Array<{ text: string }> };
      expect(listed.content[0]!.text).toContain('visível na leitura');
      ro.close();
      w.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('banco fechado/indisponível vira resposta de erro, não queda do servidor', async () => {
    const dead = openDb();
    migrate(dead);
    const d = createRepos(dead);
    const p = d.projects.create({ nome: 'P', pasta: '/tmp/p' });
    const s = d.sessions.create({ projectId: p.id });
    const server = createMemoryServer({ read: dead, write: dead, scope: { projectId: p.id, sessionId: s.id } });
    const client = new Client({ name: 'qa', version: '0' });
    const [c, sv] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(sv), client.connect(c)]);
    dead.close();
    for (const [name, args] of [['buscar_memoria', { consulta: 'x' }], ['listar_fatos', {}], ['salvar_fato', { texto: 'x' }], ['ler_resumo', {}]] as const) {
      const r = (await client.callTool({ name, arguments: args }).catch(() => ({ isError: true }))) as { isError?: boolean };
      expect(r.isError, name).toBe(true);
    }
    // continua respondendo ao protocolo
    expect((await client.listTools()).tools).toHaveLength(4);
  });

  it('writeMcpConfig grava com modo 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owl-qa10-'));
    try {
      const f = join(dir, 'c.json');
      writeMcpConfig(f, { command: 'node', args: [], dbFile: '/d', projectId: null, sessionId: 's' });
      expect(statSync(f).mode & 0o777).toBe(0o600);
      chmodSync(f, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeMcpConfig falha alto numa pasta inexistente (quem chama decide)', () => {
    expect(() => writeMcpConfig('/nonexistent-dir-qa10/c.json', { command: 'node', args: [], dbFile: '/d', projectId: null, sessionId: 's' })).toThrow();
  });
});
