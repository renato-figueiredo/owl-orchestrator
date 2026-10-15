// E2E-only server: the real app and executor, but the CLIs are replaced by the fake CLI used in unit tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCliAdapter, registerAdapter } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { buildApp } from '../src/app.js';
import { Executor } from '../src/executor.js';

const FAKE = fileURLToPath(new URL('../../../packages/core/test/fake-cli.mjs', import.meta.url));
const fake = (id: string, scenario: string) => {
  const real = createClaudeCliAdapter({
    bin: process.execPath,
    binArgs: [FAKE],
    killGraceMs: 300,
    env: { ...process.env, FAKE_SCENARIO: scenario },
  });
  return { ...real, id, run: real.run };
};
// `claude-cli` answers immediately; `codex-cli` is replaced by one that hangs until cancelled.
registerAdapter(fake('claude-cli', 'text'));
registerAdapter(fake('codex-cli', 'hang'));

const dir = mkdtempSync(join(tmpdir(), 'owl-e2e-'));
const db = openDb(join(dir, 'owl.sqlite'));
migrate(db);
const repos = createRepos(db);
const executor = new Executor({ repos });
const app = buildApp({ repos, executor, workspaceRoots: [tmpdir()], defaultCwd: dir });
const port = Number(process.env.OWL_PORT ?? 4318);
await app.listen({ host: '127.0.0.1', port });
console.log(`e2e server on ${port}, data in ${dir}`);
