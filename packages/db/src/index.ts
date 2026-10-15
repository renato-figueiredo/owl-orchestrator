import type { Db } from './connection.js';
import { attachmentsRepo, blobsRepo } from './repos/blobs.js';
import { factsRepo } from './repos/facts.js';
import { messagesRepo } from './repos/messages.js';
import { runsRepo } from './repos/runs.js';
import { sessionsRepo } from './repos/sessions.js';

export { foreignKeysEnabled, openDb, type Db } from './connection.js';
export { MIGRATIONS_DIR, migrate } from './migrate.js';
export * from './repos/blobs.js';
export * from './repos/facts.js';
export * from './repos/messages.js';
export * from './repos/runs.js';
export * from './repos/sessions.js';

/** All typed repositories bound to one connection. */
export function createRepos(db: Db) {
  return {
    sessions: sessionsRepo(db),
    messages: messagesRepo(db),
    runs: runsRepo(db),
    facts: factsRepo(db),
    blobs: blobsRepo(db),
    attachments: attachmentsRepo(db),
  };
}
