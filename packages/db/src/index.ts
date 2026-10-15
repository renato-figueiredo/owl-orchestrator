import type { Db } from './connection.js';
import { approvalsRepo } from './repos/approvals.js';
import { attachmentsRepo, blobsRepo } from './repos/blobs.js';
import { factsRepo } from './repos/facts.js';
import { buscarMensagens, messagesRepo } from './repos/messages.js';
import { projectsRepo } from './repos/projects.js';
import { runsRepo } from './repos/runs.js';
import { sessionsRepo } from './repos/sessions.js';
import { settingsRepo } from './repos/settings.js';

export { checkSnapshot, foreignKeysEnabled, openDb, snapshotTo, type Db, type SnapshotCheck } from './connection.js';
export { MIGRATIONS_DIR, migrate } from './migrate.js';
export * from './repos/approvals.js';
export * from './repos/blobs.js';
export * from './repos/facts.js';
export * from './repos/messages.js';
export * from './repos/projects.js';
export * from './repos/runs.js';
export * from './repos/sessions.js';
export * from './repos/settings.js';

/** All typed repositories bound to one connection. */
export function createRepos(db: Db) {
  return {
    projects: projectsRepo(db),
    sessions: sessionsRepo(db),
    messages: messagesRepo(db),
    runs: runsRepo(db),
    facts: factsRepo(db),
    blobs: blobsRepo(db),
    attachments: attachmentsRepo(db),
    approvals: approvalsRepo(db),
    settings: settingsRepo(db),
    /** Full-text search over messages (see `buscarMensagens`). */
    searchMessages: (
      consulta: string,
      escopo: { sessionId?: string; projectId?: string } = {},
      limite = 5,
      modo: 'todas' | 'qualquer' = 'todas',
    ) => buscarMensagens(db, consulta, escopo, limite, modo),
  };
}
