import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { buildApp } from './app.js';
import { BackupService } from './backup.js';
import { CleanupService } from './cleanup.js';
import { Executor } from './executor.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(join(config.dataDir, 'owl.sqlite'));
migrate(db);
const repos = createRepos(db);
repos.approvals.expirePendingRunGates(); // pipeline pauses live in memory and do not survive a restart
const executor = new Executor({ repos, concurrency: config.concurrency });
const attachmentsDir = join(config.dataDir, 'attachments');
const cleanup = new CleanupService({ db, repos, dir: attachmentsDir, isBusy: (id) => executor.hasActive(id) });
const backup = new BackupService({
  db,
  repos,
  dir: join(config.dataDir, 'backups'),
  recipient: config.backupAgeRecipient,
  remote: config.backupRcloneRemote,
});
// The workspace packages export TypeScript, so the MCP server is started through the same tsx loader as this process.
const mcpEntry = fileURLToPath(new URL('../../../packages/mcp-memory/src/bin.ts', import.meta.url));
const app = buildApp({
  mcpMemory: {
    // absolute: the CLI runs in the project folder, not in ours
    dbFile: resolve(config.dataDir, 'owl.sqlite'),
    dir: resolve(config.dataDir, 'mcp'),
    command: process.execPath,
    args: [createRequire(import.meta.url).resolve('tsx/cli'), mcpEntry],
  },
  cleanup,
  backup,
  repos,
  executor,
  workspaceRoots: config.workspaceRoots,
  allowedOrigins: config.allowedOrigins,
  attachmentsDir,
  maxAttachmentBytes: config.maxAttachmentBytes,
});

// Housekeeping at startup and every few hours; a failure here must never take the server down.
const housekeeping = () => {
  try {
    const purged = cleanup.purgeExpired();
    const swept = cleanup.sweep();
    if (purged.purged || swept.orphanBlobs || swept.strayFiles) console.log('owl cleanup', { purged, swept });
  } catch (e) {
    console.error('owl cleanup failed', e instanceof Error ? e.message : e);
  }
  void backup.tick().catch((e: unknown) => console.error('owl backup failed', e instanceof Error ? e.message : e));
};
housekeeping();
const timer = setInterval(housekeeping, 3 * 3_600_000);
timer.unref();

const stop = async () => {
  clearInterval(timer);
  await executor.shutdown();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

app
  .listen({ host: config.host, port: config.port })
  .then(() => console.log(`owl server listening on http://${config.host}:${config.port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
