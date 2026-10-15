import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeTools,
  isSafeName,
  listAdapters,
  parseAgentFile,
  parsePipeline,
  parseSkillFile,
  renderSkills,
  serializeAgent,
  type AgentDefinition,
  type Pipeline,
  type SkillDefinition,
} from '@owl/core';
import type { AgentOrigin, createRepos } from '@owl/db';

type Repos = ReturnType<typeof createRepos>;

/** Where the bundled agents, skills and pipelines live (the repo's `examples/` folder). */
export const DEFAULT_LIBRARY_DIR = fileURLToPath(new URL('../../../examples', import.meta.url));

/** A library file is a few KB of text; anything bigger is a mistake and is not read. */
const MAX_FILE_BYTES = 200_000;

export interface LibraryOptions {
  /** Examples shipped with OWL (read-only): `agents/`, `skills/`, `pipelines/`. */
  bundledDir?: string;
  /** The user's own library (`~/.owl`): same layout. A file here wins over a bundled one with the same name. */
  userDir?: string;
  /** When given, the agents table is kept in sync as an index of the valid agent files. */
  repos?: Repos;
}

export interface AgentSummary {
  nome: string;
  descricao: string | null;
  papel: string | null;
  provedor: string;
  modelo: string | null;
  ferramentas: string[];
  skills: string[];
  podeAprovar: boolean;
  origem: AgentOrigin;
  /** A bundled agent with the same name exists and is shadowed by the user's. */
  sobrescreve: boolean;
}

export interface LibraryProblem {
  /** `agents/foo.md` inside its library. */
  arquivo: string;
  origem: AgentOrigin;
  erro: string;
}

export class LibraryError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Loaded {
  def: AgentDefinition;
  origem: AgentOrigin;
  arquivo: string;
  shadows: boolean;
}

/**
 * Agents (`agents/<name>.md`), skills (`skills/<name>/SKILL.md`) and pipelines (`pipelines/<name>.yaml`).
 * Files are read from disk on every use, so editing one takes effect on the next run with no restart; the agents
 * table is re-synced on every listing. A broken file is reported with its error and skipped: it never breaks the
 * others. Names are validated, so they cannot point outside the folders.
 */
export class Library {
  private readonly bundled: string;
  private readonly user: string | undefined;
  private readonly repos: Repos | undefined;

  constructor(opts: LibraryOptions | string = {}) {
    const o = typeof opts === 'string' ? { bundledDir: opts } : opts;
    this.bundled = o.bundledDir ?? DEFAULT_LIBRARY_DIR;
    this.user = o.userDir;
    this.repos = o.repos;
  }

  private dirs(): Array<{ dir: string; origem: AgentOrigin }> {
    return [...(this.user ? [{ dir: this.user, origem: 'usuario' as const }] : []), { dir: this.bundled, origem: 'exemplo' as const }];
  }

  private read(file: string): string {
    if (statSync(file).size > MAX_FILE_BYTES) throw new Error('file too large (200 KB maximum)');
    return readFileSync(file, 'utf8');
  }

  /** Validates what a single file cannot know on its own: the name matches the file, the provider and skills exist. */
  private check(def: AgentDefinition, fileName: string): void {
    if (def.nome !== fileName) throw new Error(`nome: "${def.nome}" must match the file name ("${fileName}")`);
    if (!listAdapters().some((a) => a.id === def.provedor)) {
      throw new Error(`provedor: unknown provider "${def.provedor}" (available: ${listAdapters().map((a) => a.id).join(', ')})`);
    }
    for (const f of def.fallback) {
      if (!listAdapters().some((a) => a.id === f.provedor)) throw new Error(`fallback: unknown provider "${f.provedor}"`);
    }
    const tools = analyzeTools(def.ferramentas);
    if (tools.problems.length) throw new Error(`ferramentas: ${tools.problems.join('; ')}`);
    // Codex runs in a fixed read-only sandbox and ignores `ferramentas`: a Codex agent that claims to write would silently do nothing.
    if (tools.writes && [def.provedor, ...def.fallback.map((f) => f.provedor)].includes('codex-cli')) {
      throw new Error('ferramentas: o Codex roda somente leitura; agentes que escrevem ou rodam comandos precisam de claude-cli (e fallback também)');
    }
    for (const s of def.skills) if (!this.findSkill(s)) throw new Error(`skills: "${s}" is not in the library`);
  }

  /** Every valid agent (user files shadow bundled ones) plus the files that failed to load. */
  scan(): { loaded: Loaded[]; problems: LibraryProblem[] } {
    const loaded = new Map<string, Loaded>();
    const problems: LibraryProblem[] = [];
    const bundledNames = new Set<string>();
    for (const { dir, origem } of [...this.dirs()].reverse()) {
      const folder = join(dir, 'agents');
      if (!existsSync(folder)) continue;
      for (const file of readdirSync(folder).sort()) {
        if (!file.endsWith('.md')) continue;
        const name = file.slice(0, -3);
        const arquivo = `agents/${file}`;
        try {
          if (!isSafeName(name)) throw new Error('invalid file name (use lowercase letters, digits and dashes)');
          const def = parseAgentFile(this.read(join(folder, file)));
          this.check(def, name);
          if (origem === 'exemplo') bundledNames.add(name);
          loaded.set(name, { def, origem, arquivo, shadows: origem === 'usuario' && bundledNames.has(name) });
        } catch (e) {
          problems.push({ arquivo, origem, erro: e instanceof Error ? e.message : String(e) });
          // A broken user file must not hide a valid bundled agent of the same name by deleting it silently:
          // the bundled one keeps working and the problem is listed.
        }
      }
    }
    return { loaded: [...loaded.values()].sort((a, b) => a.def.nome.localeCompare(b.def.nome)), problems };
  }

  /** Re-reads the folders and updates the agents table. */
  sync(): { agents: AgentSummary[]; problemas: LibraryProblem[] } {
    const { loaded, problems } = this.scan();
    this.repos?.agents.sync(
      loaded.map((l) => ({
        nome: l.def.nome,
        papel: l.def.papel ?? null,
        descricao: l.def.descricao ?? null,
        provedor: l.def.provedor,
        modelo: l.def.modelo ?? null,
        origem: l.origem,
        arquivo: l.arquivo,
      })),
    );
    return {
      agents: loaded.map((l) => ({
        nome: l.def.nome,
        descricao: l.def.descricao ?? null,
        papel: l.def.papel ?? null,
        provedor: l.def.provedor,
        modelo: l.def.modelo ?? null,
        ferramentas: l.def.ferramentas,
        skills: l.def.skills,
        podeAprovar: l.def.pode_aprovar,
        origem: l.origem,
        sobrescreve: l.shadows,
      })),
      problemas: problems,
    };
  }

  private agentFile(name: string): { file: string; origem: AgentOrigin } | undefined {
    for (const { dir, origem } of this.dirs()) {
      const file = join(dir, 'agents', `${name}.md`);
      if (existsSync(file)) return { file, origem };
    }
    return undefined;
  }

  /**
   * The agent to run. An invalid file never runs: if the user's override is broken, the bundled agent of the same
   * name is used (and the problem shows in the listing); with no valid file the error is thrown.
   */
  agent(name: string): AgentDefinition {
    if (!isSafeName(name)) throw new Error(`Invalid agent name: ${name}`);
    let lastError: Error | undefined;
    for (const { dir } of this.dirs()) {
      const file = join(dir, 'agents', `${name}.md`);
      if (!existsSync(file)) continue;
      try {
        const def = parseAgentFile(this.read(file));
        this.check(def, name);
        return def;
      } catch (e) {
        lastError = new Error(`Agent "${name}" is invalid: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw lastError ?? new Error(`Agent not found: ${name}`);
  }

  /** The system prompt of an agent: its own text followed by the skills it declares. */
  systemPrompt(def: AgentDefinition): string {
    const skills = def.skills.map((s) => {
      const found = this.skill(s);
      if (!found) throw new Error(`Skill not found: ${s}`);
      return found;
    });
    return def.prompt + renderSkills(skills);
  }

  /** Raw text and origin of an agent file, for the editor. */
  source(name: string): { texto: string; origem: AgentOrigin } {
    if (!isSafeName(name)) throw new LibraryError(400, 'invalid_name', `Invalid agent name: ${name}`);
    const found = this.agentFile(name);
    if (!found) throw new LibraryError(404, 'agent_not_found', `Agent not found: ${name}`);
    return { texto: this.read(found.file), origem: found.origem };
  }

  private requireUserDir(): string {
    if (!this.user) throw new LibraryError(409, 'no_user_library', 'No user library folder is configured');
    return this.user;
  }

  /** Creates or replaces the user's file for `name`. The text is validated first; an invalid agent is not saved. */
  save(name: string, texto: string): AgentDefinition {
    if (!isSafeName(name)) throw new LibraryError(400, 'invalid_name', `Invalid agent name: ${name}`);
    if (Buffer.byteLength(texto) > MAX_FILE_BYTES) throw new LibraryError(400, 'invalid_agent', 'file too large (200 KB maximum)');
    let def: AgentDefinition;
    try {
      def = parseAgentFile(texto);
      this.check(def, name);
    } catch (e) {
      throw new LibraryError(400, 'invalid_agent', e instanceof Error ? e.message : String(e));
    }
    const folder = join(this.requireUserDir(), 'agents');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${name}.md`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, texto.endsWith('\n') ? texto : `${texto}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    this.sync();
    return def;
  }

  /** Copies an agent (bundled or the user's) into the user's library under a new name. */
  duplicate(name: string, newName: string): AgentDefinition {
    if (!isSafeName(newName)) throw new LibraryError(400, 'invalid_name', `Invalid agent name: ${newName}`);
    if (this.agentFile(newName)) throw new LibraryError(409, 'agent_exists', `An agent named "${newName}" already exists`);
    let def: AgentDefinition;
    try {
      def = this.agent(name);
    } catch (e) {
      throw new LibraryError(404, 'agent_not_found', e instanceof Error ? e.message : String(e));
    }
    return this.save(newName, serializeAgent({ ...def, nome: newName }));
  }

  /** Removes the user's file. A bundled agent cannot be deleted; deleting an override brings the bundled one back. */
  remove(name: string): void {
    if (!isSafeName(name)) throw new LibraryError(400, 'invalid_name', `Invalid agent name: ${name}`);
    const file = join(this.requireUserDir(), 'agents', `${name}.md`);
    if (!existsSync(file)) {
      if (this.agentFile(name)) throw new LibraryError(403, 'read_only', 'Bundled agents cannot be deleted; duplicate it to change it');
      throw new LibraryError(404, 'agent_not_found', `Agent not found: ${name}`);
    }
    rmSync(file);
    this.sync();
  }

  /** A skill folder's `SKILL.md`, user's library first. */
  skill(name: string): SkillDefinition | undefined {
    return this.findSkill(name);
  }

  private findSkill(name: string): SkillDefinition | undefined {
    if (!isSafeName(name)) return undefined;
    for (const { dir } of this.dirs()) {
      const file = join(dir, 'skills', name, 'SKILL.md');
      if (!existsSync(file)) continue;
      try {
        const def = parseSkillFile(this.read(file));
        if (def.nome === name) return def;
      } catch {
        // invalid: treated as missing here; `skills()` reports why
      }
    }
    return undefined;
  }

  skills(): { skills: Array<{ nome: string; descricao: string; origem: AgentOrigin }>; problemas: LibraryProblem[] } {
    const found = new Map<string, { nome: string; descricao: string; origem: AgentOrigin }>();
    const problemas: LibraryProblem[] = [];
    for (const { dir, origem } of [...this.dirs()].reverse()) {
      const folder = join(dir, 'skills');
      if (!existsSync(folder)) continue;
      for (const name of readdirSync(folder).sort()) {
        const file = join(folder, name, 'SKILL.md');
        if (!existsSync(file)) continue;
        try {
          if (!isSafeName(name)) throw new Error('invalid folder name');
          const def = parseSkillFile(this.read(file));
          if (def.nome !== name) throw new Error(`name: "${def.nome}" must match the folder name ("${name}")`);
          found.set(name, { nome: name, descricao: def.descricao, origem });
        } catch (e) {
          problemas.push({ arquivo: `skills/${name}/SKILL.md`, origem, erro: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return { skills: [...found.values()], problemas };
  }

  pipeline(name: string): Pipeline {
    if (!isSafeName(name)) throw new Error(`Invalid pipeline name: ${name}`);
    for (const { dir } of this.dirs()) {
      const file = join(dir, 'pipelines', `${name}.yaml`);
      if (existsSync(file)) return parsePipeline(this.read(file));
    }
    throw new Error(`Pipeline not found: ${name}`);
  }

  pipelines(): { pipelines: Array<{ nome: string; etapas: string[]; origem: AgentOrigin }>; problemas: LibraryProblem[] } {
    const found = new Map<string, { nome: string; etapas: string[]; origem: AgentOrigin }>();
    const problemas: LibraryProblem[] = [];
    for (const { dir, origem } of [...this.dirs()].reverse()) {
      const folder = join(dir, 'pipelines');
      if (!existsSync(folder)) continue;
      for (const file of readdirSync(folder).sort()) {
        if (!file.endsWith('.yaml')) continue;
        const name = file.slice(0, -5);
        try {
          if (!isSafeName(name)) throw new Error('invalid file name');
          const p = parsePipeline(this.read(join(folder, file)));
          found.set(name, { nome: name, etapas: p.etapas.map((e) => e.id), origem });
        } catch (e) {
          problemas.push({ arquivo: `pipelines/${file}`, origem, erro: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return { pipelines: [...found.values()], problemas };
  }
}
