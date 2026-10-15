import { parse, stringify } from 'yaml';
import { z, type ZodError } from 'zod';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

const fallbackSchema = z.strictObject({
  provedor: z.string().min(1),
  modelo: z.string().min(1).optional(),
});

const agentSchema = z.strictObject({
  nome: z.string().regex(NAME, 'use only lowercase letters, digits and dashes'),
  /** One line shown in the library. */
  descricao: z.string().max(300).optional(),
  papel: z.string().optional(),
  provedor: z.string().min(1),
  modelo: z.string().min(1).optional(),
  /** Ordered alternatives offered when the provider fails or the user prefers another one. */
  fallback: z.array(fallbackSchema).default([]),
  ferramentas: z.array(z.string().min(1)).default([]),
  /** Names of skill folders (`skills/<name>/SKILL.md`) the agent uses. */
  skills: z.array(z.string().regex(NAME)).default([]),
  /** May approve other agents' work (used by the board, prompt 13). */
  pode_aprovar: z.boolean().default(false),
});

export interface AgentDefinition extends z.infer<typeof agentSchema> {
  /** The system prompt (Markdown body of the file). */
  prompt: string;
}

/** Agent names are file names: lowercase words and dashes only, so a name can never walk out of the folder. */
export const isSafeName = (name: string) => NAME.test(name);

/** One line per problem, each starting with the field: `ferramentas.0: Invalid input`. */
export function describeZodError(error: ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : 'file'}: ${i.message}`).join('; ');
}

/**
 * Parses an agent file: YAML front matter between `---` lines, then the system prompt. Every problem becomes an
 * `Error` whose message says what to fix (it is shown to the user next to the file), never a raw stack of issues.
 */
export function parseAgentFile(text: string): AgentDefinition {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('Agent file must start with a --- front matter block');
  let raw: unknown;
  try {
    raw = parse(m[1] ?? '') ?? {};
  } catch (e) {
    throw new Error(`Invalid front matter (YAML): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const parsed = agentSchema.safeParse(raw);
  if (!parsed.success) throw new Error(describeZodError(parsed.error));
  const prompt = (m[2] ?? '').trim();
  if (!prompt) throw new Error('Agent file has no system prompt after the front matter');
  return { ...parsed.data, prompt };
}

/** Writes an agent back to its file format (the library editor and "duplicate" use it). */
export function serializeAgent(def: AgentDefinition): string {
  const { prompt, ...meta } = def;
  const clean: Record<string, unknown> = { nome: meta.nome };
  if (meta.descricao) clean.descricao = meta.descricao;
  if (meta.papel) clean.papel = meta.papel;
  clean.provedor = meta.provedor;
  if (meta.modelo) clean.modelo = meta.modelo;
  if (meta.fallback.length) clean.fallback = meta.fallback;
  clean.ferramentas = meta.ferramentas;
  if (meta.skills.length) clean.skills = meta.skills;
  clean.pode_aprovar = meta.pode_aprovar;
  return `---\n${stringify(clean).trimEnd()}\n---\n${prompt}\n`;
}
