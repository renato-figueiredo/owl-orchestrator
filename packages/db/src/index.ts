import type { Db } from './connection.js';
import { agentsRepo } from './repos/agents.js';
import { approvalsRepo } from './repos/approvals.js';
import { attachmentsRepo, blobsRepo } from './repos/blobs.js';
import { factsRepo } from './repos/facts.js';
import { buscarMensagens, messagesRepo } from './repos/messages.js';
import { metricsRepo } from './repos/metrics.js';
import { projectsRepo } from './repos/projects.js';
import { quadroRepo } from './repos/quadro.js';
import { runsRepo } from './repos/runs.js';
import { sessionsRepo } from './repos/sessions.js';
import { settingsRepo } from './repos/settings.js';
import { teamsRepo } from './repos/teams.js';
import { ticketsRepo } from './repos/tickets.js';

export { checkSnapshot, foreignKeysEnabled, openDb, openReadonly, snapshotTo, type Db, type SnapshotCheck } from './connection.js';
export { MIGRATIONS_DIR, migrate } from './migrate.js';
export * from './repos/agents.js';
export * from './repos/approvals.js';
export * from './repos/blobs.js';
export * from './repos/facts.js';
export * from './repos/messages.js';
export * from './repos/metrics.js';
export * from './repos/projects.js';
export * from './repos/quadro.js';
export * from './repos/runs.js';
export * from './repos/sessions.js';
export * from './repos/settings.js';
export * from './repos/teams.js';
export * from './repos/tickets.js';

/** All typed repositories bound to one connection. */
export function createRepos(db: Db) {
  return {
    projects: projectsRepo(db),
    sessions: sessionsRepo(db),
    messages: messagesRepo(db),
    runs: runsRepo(db),
    metrics: metricsRepo(db),
    facts: factsRepo(db),
    blobs: blobsRepo(db),
    attachments: attachmentsRepo(db),
    approvals: approvalsRepo(db),
    agents: agentsRepo(db),
    settings: settingsRepo(db),
    tickets: ticketsRepo(db),
    teams: teamsRepo(db),
    quadro: quadroRepo(db),
    /** Full-text search over messages (see `buscarMensagens`). */
    searchMessages: (
      consulta: string,
      escopo: { sessionId?: string; projectId?: string } = {},
      limite = 5,
      modo: 'todas' | 'qualquer' = 'todas',
    ) => buscarMensagens(db, consulta, escopo, limite, modo),
  };
}
