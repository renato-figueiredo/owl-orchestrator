// E2E-only server: the real app and executor, but the CLIs are replaced by the fake CLI used in unit tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCliAdapter, registerAdapter } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { buildApp } from '../src/app.js';
import { CleanupService } from '../src/cleanup.js';
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
// `claude-cli` and `codex-cli` (the refiner) answer immediately; `fake-hang` stays running until cancelled.
registerAdapter(fake('claude-cli', 'text'));
registerAdapter(fake('codex-cli', 'text'));
registerAdapter(fake('fake-hang', 'hang'));
// A summarizer that answers with valid JSON (the plain fake CLIs answer "ok", which is not a summary).
registerAdapter(fake('fake-summarizer', 'summary-ok'));

// The Playwright config picks the folder so the tests can look inside it (files must really disappear).
const dir = process.env.OWL_E2E_DIR ?? mkdtempSync(join(tmpdir(), 'owl-e2e-'));
const db = openDb(join(dir, 'owl.sqlite'));
migrate(db);
const repos = createRepos(db);
const executor = new Executor({ repos });
const attachmentsDir = join(dir, 'attachments');
const cleanup = new CleanupService({ db, repos, dir: attachmentsDir, isBusy: (id) => executor.hasActive(id) });
const app = buildApp({ repos, executor, cleanup, attachmentsDir, workspaceRoots: [tmpdir()], defaultCwd: dir, userLibraryDir: join(dir, 'library') });
const port = Number(process.env.OWL_PORT ?? 4318);
await app.listen({ host: '127.0.0.1', port });
console.log(`e2e server on ${port}, data in ${dir}`);
