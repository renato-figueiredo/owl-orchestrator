import { writeFileSync } from 'node:fs';
import { MEMORY_SERVER_NAME } from './server.js';

export interface McpConfigInput {
  /** Program and leading arguments that start `bin.ts` (e.g. node + the tsx loader + the entry file). */
  command: string;
  args: string[];
  dbFile: string;
  projectId: string | null;
  sessionId: string;
  runId?: string;
}

/** The file `claude --mcp-config` reads. The scope travels in the environment of the server process. */
export function buildMcpConfig(i: McpConfigInput): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } {
  return {
    mcpServers: {
      [MEMORY_SERVER_NAME]: {
        command: i.command,
        args: i.args,
        env: {
          OWL_DB: i.dbFile,
          OWL_MEMORY_SESSION: i.sessionId,
          ...(i.projectId ? { OWL_MEMORY_PROJECT: i.projectId } : {}),
          ...(i.runId ? { OWL_MEMORY_RUN: i.runId } : {}),
        },
      },
    },
  };
}

export function writeMcpConfig(file: string, input: McpConfigInput): void {
  writeFileSync(file, JSON.stringify(buildMcpConfig(input), null, 2), { mode: 0o600 });
}
