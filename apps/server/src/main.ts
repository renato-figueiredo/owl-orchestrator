import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@owl/core';
import { createRepos, migrate, openDb } from '@owl/db';
import { buildApp } from './app.js';
import { Executor } from './executor.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(join(config.dataDir, 'owl.sqlite'));
migrate(db);
const repos = createRepos(db);
repos.approvals.expirePendingRunGates(); // pipeline pauses live in memory and do not survive a restart
const executor = new Executor({ repos, concurrency: config.concurrency });
const app = buildApp({ repos, executor, workspaceRoots: config.workspaceRoots, allowedOrigins: config.allowedOrigins });

const stop = async () => {
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
