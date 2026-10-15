import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepos, migrate, openDb } from '@owl/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Library, LibraryError } from './library.js';

let root: string;
let bundled: string;
let user: string;
let repos: ReturnType<typeof createRepos>;

const agent = (nome: string, extra = '', body = 'Prompt.') => `---\nnome: ${nome}\nprovedor: claude-cli\n${extra}---\n${body}\n`;
const put = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const lib = () => new Library({ bundledDir: bundled, userDir: user, repos });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'owl-lib-'));
  bundled = join(root, 'bundled');
  user = join(root, 'user');
  mkdirSync(bundled);
  const db = openDb();
  migrate(db);
  repos = createRepos(db);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the bundled examples', () => {
  it('are all valid, and the nine agents of the roadmap exist', () => {
    const { agents, problemas } = new Library().sync();
    expect(problemas).toEqual([]);
    expect(agents.map((a) => a.nome)).toEqual(
      expect.arrayContaining(['po', 'tech-lead', 'dev-front', 'dev-back', 'qa', 'revisor', 'memoria', 'roteador', 'refinador-de-prompt']),
    );
    expect(new Library().skills().problemas).toEqual([]);
    expect(new Library().pipelines().problemas).toEqual([]);
  });
});

describe('listing and the agents table', () => {
  it('merges both folders; a user file wins over a bundled one with the same name', () => {
    put(bundled, 'agents/a.md', agent('a', 'modelo: sonnet\n'));
    put(bundled, 'agents/b.md', agent('b'));
    put(user, 'agents/a.md', agent('a', 'modelo: opus\n'));
    put(user, 'agents/c.md', agent('c'));
    const { agents, problemas } = lib().sync();
    expect(problemas).toEqual([]);
    expect(agents.map((a) => [a.nome, a.modelo, a.origem, a.sobrescreve])).toEqual([
      ['a', 'opus', 'usuario', true],
      ['b', null, 'exemplo', false],
      ['c', null, 'usuario', false],
    ]);
    expect(repos.agents.list().map((r) => [r.nome, r.origem])).toEqual([['a', 'usuario'], ['b', 'exemplo'], ['c', 'usuario']]);
  });

  it('an invalid agent is reported with its error and does not hide the others', () => {
    put(bundled, 'agents/ok.md', agent('ok'));
    put(user, 'agents/quebrado.md', '---\nnome: quebrado\nprovedor: claude-cli\nferramentas: Read\n---\ntexto');
    put(user, 'agents/sem-prompt.md', '---\nnome: sem-prompt\nprovedor: claude-cli\n---\n');
    put(user, 'agents/outro-nome.md', agent('nao-e-este'));
    put(user, 'agents/provedor.md', agent('provedor').replace('claude-cli', 'gpt-na-nuvem'));
    put(user, 'agents/skill.md', agent('skill', 'skills: [nao-existe]\n'));
    const { agents, problemas } = lib().sync();
    expect(agents.map((a) => a.nome)).toEqual(['ok']);
    const by = Object.fromEntries(problemas.map((p) => [p.arquivo, p.erro]));
    expect(by['agents/quebrado.md']).toMatch(/ferramentas/);
    expect(by['agents/sem-prompt.md']).toMatch(/system prompt/);
    expect(by['agents/outro-nome.md']).toMatch(/must match the file name/);
    expect(by['agents/provedor.md']).toMatch(/unknown provider "gpt-na-nuvem"/);
    expect(by['agents/skill.md']).toMatch(/"nao-existe" is not in the library/);
    expect(repos.agents.list().map((r) => r.nome)).toEqual(['ok']);
  });

  it('a broken user override falls back to the bundled agent and is listed as a problem', () => {
    put(bundled, 'agents/a.md', agent('a', 'modelo: sonnet\n'));
    put(user, 'agents/a.md', '---\nnome: a\n---\nsem provedor');
    const l = lib();
    const { agents, problemas } = l.sync();
    expect(agents[0]).toMatchObject({ nome: 'a', origem: 'exemplo', modelo: 'sonnet' });
    expect(problemas).toHaveLength(1);
    expect(l.agent('a').modelo).toBe('sonnet');
  });

  it('with no valid file, running the agent fails with a message that names the agent', () => {
    put(user, 'agents/a.md', '---\nnome: a\n---\nsem provedor');
    expect(() => lib().agent('a')).toThrow(/Agent "a" is invalid: provedor/);
    expect(() => lib().agent('zzz')).toThrow(/not found/);
    expect(() => lib().agent('../etc/passwd')).toThrow(/Invalid agent name/);
  });

  it('picks up an edit on the next read, with no restart', () => {
    put(user, 'agents/a.md', agent('a', 'modelo: sonnet\n'));
    const l = lib();
    expect(l.agent('a').modelo).toBe('sonnet');
    put(user, 'agents/a.md', agent('a', 'modelo: opus\n'));
    expect(l.agent('a').modelo).toBe('opus');
    l.sync();
    expect(repos.agents.byName('a')!.modelo).toBe('opus');
    rmSync(join(user, 'agents/a.md'));
    l.sync();
    expect(repos.agents.byName('a')).toBeUndefined();
  });

  it('does not read a huge file', () => {
    put(user, 'agents/enorme.md', agent('enorme', '', 'x'.repeat(300_000)));
    expect(lib().sync().problemas[0]!.erro).toMatch(/too large/);
  });
});

describe('editing', () => {
  it('saves into the user folder and the index follows', () => {
    const l = lib();
    l.save('novo', agent('novo', 'modelo: haiku\n'));
    expect(readFileSync(join(user, 'agents/novo.md'), 'utf8')).toContain('modelo: haiku');
    expect(repos.agents.byName('novo')).toMatchObject({ origem: 'usuario', modelo: 'haiku' });
  });

  it('refuses to save an invalid agent and writes nothing', () => {
    const l = lib();
    expect(() => l.save('x', '---\nnome: x\n---\ny')).toThrow(LibraryError);
    expect(() => l.save('x', agent('outro'))).toThrow(/must match the file name/);
    expect(() => l.save('../x', agent('x'))).toThrow(/Invalid agent name/);
    expect(() => readFileSync(join(user, 'agents/x.md'))).toThrow();
  });

  it('duplicates a bundled agent under a new name and refuses an existing name', () => {
    put(bundled, 'agents/a.md', agent('a', 'modelo: sonnet\n', 'Texto do A.'));
    const l = lib();
    l.duplicate('a', 'a-copia');
    expect(l.agent('a-copia')).toMatchObject({ nome: 'a-copia', modelo: 'sonnet', prompt: 'Texto do A.' });
    expect(() => l.duplicate('a', 'a-copia')).toThrow(/already exists/);
    expect(() => l.duplicate('a', 'a')).toThrow(/already exists/);
    expect(() => l.duplicate('nada', 'x')).toThrow(/not found/);
  });

  it('deletes only the user file; a bundled agent is read-only and an override can be undone', () => {
    put(bundled, 'agents/a.md', agent('a', 'modelo: sonnet\n'));
    const l = lib();
    expect(() => l.remove('a')).toThrow(/Bundled agents cannot be deleted/);
    l.save('a', agent('a', 'modelo: opus\n'));
    expect(l.agent('a').modelo).toBe('opus');
    l.remove('a');
    expect(l.agent('a').modelo).toBe('sonnet');
    expect(() => l.remove('nada')).toThrow(/not found/);
  });

  it('without a user folder it cannot save', () => {
    expect(() => new Library({ bundledDir: bundled }).save('a', agent('a'))).toThrow(/No user library/);
  });
});

describe('skills', () => {
  it('lists skills, reports a broken one and appends the declared skills to the prompt', () => {
    put(bundled, 'skills/rev/SKILL.md', '---\nname: rev\ndescription: Quando revisar.\n---\nPasso 1.');
    put(user, 'skills/ruim/SKILL.md', '---\nname: ruim\n---\nx');
    put(user, 'agents/a.md', agent('a', 'skills: [rev]\n', 'Base.'));
    const l = lib();
    const { skills, problemas } = l.skills();
    expect(skills.map((s) => s.nome)).toEqual(['rev']);
    expect(problemas[0]).toMatchObject({ arquivo: 'skills/ruim/SKILL.md' });
    const prompt = l.systemPrompt(l.agent('a'));
    expect(prompt.startsWith('Base.')).toBe(true);
    expect(prompt).toContain('## Skill: rev');
    expect(prompt).toContain('Passo 1.');
  });

  it('a skill that disappears after the agent was loaded fails the run with a clear message', () => {
    put(bundled, 'skills/rev/SKILL.md', '---\nname: rev\ndescription: d\n---\nPasso.');
    put(user, 'agents/a.md', agent('a', 'skills: [rev]\n'));
    const l = lib();
    const def = l.agent('a');
    rmSync(join(bundled, 'skills'), { recursive: true });
    expect(() => l.systemPrompt(def)).toThrow(/Skill not found: rev/);
  });
});
