import { parse } from 'yaml';
import { z } from 'zod';
import { describeZodError } from './agents.js';

/** Same limits as Claude Code's own skills: a short lowercase name and a description of when to use it. */
const skillSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'use only lowercase letters, digits and dashes (max 64)'),
  description: z.string().min(1).max(1024),
});

export interface SkillDefinition {
  nome: string;
  descricao: string;
  /** Markdown body of `SKILL.md`. */
  corpo: string;
}

/**
 * Parses a `SKILL.md`: YAML front matter with `name` and `description`, then instructions in Markdown. Other keys
 * (`allowed-tools`, `license`...) are accepted and ignored, so skills written for Claude Code load unchanged.
 */
export function parseSkillFile(text: string): SkillDefinition {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('SKILL.md must start with a --- block with name and description');
  let raw: unknown;
  try {
    raw = parse(m[1] ?? '') ?? {};
  } catch (e) {
    throw new Error(`Invalid front matter (YAML): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const parsed = skillSchema.safeParse(raw);
  if (!parsed.success) throw new Error(describeZodError(parsed.error));
  const corpo = (m[2] ?? '').trim();
  if (!corpo) throw new Error('SKILL.md has no instructions after the front matter');
  return { nome: parsed.data.name, descricao: parsed.data.description, corpo };
}

/**
 * The skills as a block appended to the agent's system prompt. Provider-neutral on purpose: the CLIs run isolated
 * (no user skills, no slash commands) and OWL never writes into the project folder, so the instructions travel in
 * the prompt, which works the same for Claude and Codex.
 */
export function renderSkills(skills: readonly SkillDefinition[]): string {
  if (!skills.length) return '';
  const blocks = skills.map((s) => `## Skill: ${s.nome}\n_${s.descricao}_\n\n${s.corpo}`);
  return `\n\n# Skills disponíveis\nSiga as instruções das skills abaixo quando a tarefa se encaixar na descrição.\n\n${blocks.join('\n\n')}`;
}
