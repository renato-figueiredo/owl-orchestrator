import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeName, parseAgentFile, parsePipeline, type AgentDefinition, type Pipeline } from '@owl/core';

/** Where the bundled agents and pipelines live (the repo's `examples/` folder). */
export const DEFAULT_LIBRARY_DIR = fileURLToPath(new URL('../../../examples', import.meta.url));

/**
 * Agents (`agents/<name>.md`) and pipelines (`pipelines/<name>.yaml`) read from disk on every use, so editing a
 * file takes effect without restarting the server. Names are validated, so they cannot point outside the folder.
 */
export class Library {
  constructor(private readonly dir: string = DEFAULT_LIBRARY_DIR) {}

  agent(name: string): AgentDefinition {
    if (!isSafeName(name)) throw new Error(`Invalid agent name: ${name}`);
    return parseAgentFile(readFileSync(join(this.dir, 'agents', `${name}.md`), 'utf8'));
  }

  pipeline(name: string): Pipeline {
    if (!isSafeName(name)) throw new Error(`Invalid pipeline name: ${name}`);
    return parsePipeline(readFileSync(join(this.dir, 'pipelines', `${name}.yaml`), 'utf8'));
  }
}
