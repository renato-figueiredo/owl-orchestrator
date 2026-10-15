import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb, openReadonly } from '@owl/db';
import { createMemoryServer } from './server.js';

/** Entry point started by the CLI: `OWL_DB`, `OWL_MEMORY_SESSION` and optionally `OWL_MEMORY_PROJECT` / `OWL_MEMORY_RUN`. */
const file = process.env.OWL_DB;
const sessionId = process.env.OWL_MEMORY_SESSION;
if (!file || !sessionId) {
  console.error('owl-memory: OWL_DB and OWL_MEMORY_SESSION are required');
  process.exit(1);
}
const read = openReadonly(file);
const write = openDb(file);
const server = createMemoryServer({
  read,
  write,
  scope: {
    projectId: process.env.OWL_MEMORY_PROJECT || null,
    sessionId,
    ...(process.env.OWL_MEMORY_RUN ? { runId: process.env.OWL_MEMORY_RUN } : {}),
  },
});
await server.connect(new StdioServerTransport());
process.on('SIGTERM', () => process.exit(0));
