import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMcpConfig } from './config.js';
import { memoryServerLaunch } from './launch.js';

const BIN = fileURLToPath(new URL('./bin.ts', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
let dir: string | undefined;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('memory MCP server over stdio (the way the CLI starts it)', () => {
  it('starts from the generated config, answers the tools and writes facts to the real file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'owl-mcp-'));
    const file = join(dir, 'owl.sqlite');
    const db = openDb(file);
    migrate(db);
    const repos = createRepos(db);
    const project = repos.projects.create({ nome: 'P', pasta: dir });
    const session = repos.sessions.create({ projectId: project.id, titulo: 'T' });
    repos.messages.add({ sessionId: session.id, papel: 'usuario', conteudo: 'lembre do café com leite' });

    const cfg = buildMcpConfig({ command: process.execPath, args: [TSX, BIN], dbFile: file, projectId: project.id, sessionId: session.id });
    const spec = cfg.mcpServers['owl-memory']!;
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...process.env, ...spec.env } as Record<string, string> }));
    try {
      const found = (await client.callTool({ name: 'buscar_memoria', arguments: { consulta: 'café' } })) as { content: Array<{ text: string }> };
      expect(found.content[0]!.text).toContain('café com leite');
      await client.callTool({ name: 'salvar_fato', arguments: { texto: 'gosta de café' } });
      expect(repos.facts.listScope({ projectId: project.id }).map((f) => f.texto)).toEqual(['gosta de café']);
    } finally {
      await client.close();
      db.close();
    }
  }, 30_000);

  it('refuses to start without a database or a session', async () => {
    const client = new Client({ name: 'test', version: '0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [TSX, BIN], env: { PATH: process.env.PATH ?? '' } });
    await expect(client.connect(transport)).rejects.toThrow();
  }, 30_000);
});

describe('start folder', () => {
  it('a hostile tsconfig in the project folder cannot redirect what the server loads', async () => {
    dir = mkdtempSync(join(tmpdir(), 'owl-mcp-'));
    const file = join(dir, 'owl.sqlite');
    const db = openDb(file);
    migrate(db);
    const project = join(dir, 'project');
    mkdirSync(project);
    // Without the explicit --tsconfig, tsx would apply this `paths` and load the evil module instead of the real one.
    writeFileSync(join(project, 'evil.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(dir, 'PWNED'))}, 'x'); export const MEMORY_SERVER_NAME = 'evil';`);
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@owl/db': ['./evil.ts'], zod: ['./evil.ts'] } } }));
    const repos = createRepos(db);
    const p = repos.projects.create({ nome: 'P', pasta: project });
    const s = repos.sessions.create({ projectId: p.id });
    const launch = memoryServerLaunch();
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StdioClientTransport({ ...launch, cwd: project, env: { ...process.env, OWL_DB: file, OWL_MEMORY_SESSION: s.id, OWL_MEMORY_PROJECT: p.id } as Record<string, string> }),
    );
    try {
      expect((await client.listTools()).tools).toHaveLength(4);
    } finally {
      await client.close();
      db.close();
    }
    expect(readdirSync(dir)).not.toContain('PWNED');
  }, 30_000);
});

describe('buildMcpConfig', () => {
  it('puts the scope in the environment and omits what is absent', () => {
    const c = buildMcpConfig({ command: 'node', args: ['x'], dbFile: '/d.sqlite', projectId: null, sessionId: 's' });
    expect(c.mcpServers['owl-memory']!.env).toEqual({ OWL_DB: '/d.sqlite', OWL_MEMORY_SESSION: 's' });
  });
});
