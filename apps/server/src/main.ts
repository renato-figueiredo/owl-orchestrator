import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LocalBoard } from '@owl/board';
import { listAdapters, loadConfig, type OllamaAdapter } from '@owl/core';
import { memoryServerLaunch } from '@owl/mcp-memory';
import { createRepos, migrate, openDb } from '@owl/db';
import { buildApp } from './app.js';
import { SessionAuth } from './auth.js';
import { BackupService } from './backup.js';
import { CleanupService } from './cleanup.js';
import { Executor } from './executor.js';
import { clearStaleMcpConfigs } from './memory.js';
import { LocalModels } from './local-models.js';
import { WorktreeService } from './worktrees.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
// `owl restore` refuses to run while this process is alive (it would swap the database file under it).
const pidFile = join(config.dataDir, 'owl.pid');
writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
const db = openDb(join(config.dataDir, 'owl.sqlite'));
migrate(db);
const repos = createRepos(db);
repos.runs.failInterrupted(); // a run cannot outlive its server; left 'rodando' it would block deleting the conversation
new LocalBoard(repos).recoverInterrupted(); // their tickets would sit in em_andamento with nothing running
repos.approvals.expirePendingRunGates(); // pipeline pauses live in memory and do not survive a restart
const worktreesDir = resolve(config.dataDir, 'worktrees');
try {
  const wt = new WorktreeService({ repos, dir: worktreesDir }).reconcile(); // leftovers of a crash: stale records and orphan folders
  if (wt.removed.length) console.log('owl worktrees cleaned', wt.removed);
} catch (e) {
  console.error('owl worktree cleanup failed', e instanceof Error ? e.message : e);
}
const executor = new Executor({ repos, concurrency: config.concurrency, projectConcurrency: config.projectConcurrency });
const attachmentsDir = join(config.dataDir, 'attachments');
const cleanup = new CleanupService({ db, repos, dir: attachmentsDir, isBusy: (id) => executor.hasActive(id) });
const backup = new BackupService({
  db,
  repos,
  dir: join(config.dataDir, 'backups'),
  recipient: config.backupAgeRecipient,
  remote: config.backupRcloneRemote,
});
const auth = new SessionAuth();
// Optional local model server: when Ollama is not running this stays "unavailable" and nothing changes.
const ollama = listAdapters().find((a): a is OllamaAdapter => a.id === 'ollama' && 'listModels' in a);
const localModels = ollama ? new LocalModels(ollama, process.env.OLLAMA_MODEL) : undefined;
localModels?.start();
clearStaleMcpConfigs(resolve(config.dataDir, 'mcp'));
const app = buildApp({
  startMonitor: true,
  auth,
  ...(localModels ? { localModels } : {}),
  mcpMemory: {
    // absolute: the CLI runs in the project folder, not in ours
    dbFile: resolve(config.dataDir, 'owl.sqlite'),
    dir: resolve(config.dataDir, 'mcp'),
    ...memoryServerLaunch(),
  },
  cleanup,
  backup,
  repos,
  executor,
  userLibraryDir: config.libraryDir,
  workspaceRoots: config.workspaceRoots,
  allowedOrigins: config.allowedOrigins,
  attachmentsDir,
  worktreesDir,
  limits: { project: config.projectConcurrency, global: config.concurrency },
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
  localModels?.stop();
  await executor.shutdown();
  await backup.whenIdle(); // closing the database under a running snapshot would cut it
  rmSync(pidFile, { force: true });
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

app
  .listen({ host: config.host, port: config.port })
  .then(() => {
    console.log(`owl server listening on http://${config.host}:${config.port}`);
    // Printed only here: agents run as subprocesses and never see this console.
    console.log(`owl: to pair the browser open the web app with ?pair=${auth.pairingCode()} (e.g. http://127.0.0.1:5173/?pair=${auth.pairingCode()}), or paste the code on the pairing screen`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
