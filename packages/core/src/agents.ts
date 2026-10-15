import { parse } from 'yaml';
import { z } from 'zod';

const fallbackSchema = z.object({
  provedor: z.string().min(1),
  modelo: z.string().min(1).optional(),
});

const agentSchema = z.object({
  nome: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  papel: z.string().optional(),
  provedor: z.string().min(1),
  modelo: z.string().min(1).optional(),
  /** Ordered alternatives offered when the provider fails or the user prefers another one. */
  fallback: z.array(fallbackSchema).default([]),
  ferramentas: z.array(z.string()).default([]),
});

export interface AgentDefinition extends z.infer<typeof agentSchema> {
  /** The system prompt (Markdown body of the file). */
  prompt: string;
}

/** Agent names are file names: lowercase words and dashes only, so a name can never walk out of the folder. */
export const isSafeName = (name: string) => /^[a-z0-9][a-z0-9-]*$/.test(name);

/**
 * Parses an agent file: YAML front matter between `---` lines, then the system prompt.
 * Minimal on purpose; the full agent library (skills, teams) comes with build/prompts/12.
 */
export function parseAgentFile(text: string): AgentDefinition {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('Agent file must start with a --- front matter block');
  const meta = agentSchema.parse(parse(m[1] ?? '') ?? {});
  const prompt = (m[2] ?? '').trim();
  if (!prompt) throw new Error('Agent file has no system prompt after the front matter');
  return { ...meta, prompt };
}
