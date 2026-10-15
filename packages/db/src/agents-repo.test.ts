import { describe, expect, it } from 'vitest';
import { createRepos, migrate, openDb } from './index.js';

const entry = (nome: string, extra: object = {}) => ({
  nome,
  papel: null,
  descricao: null,
  provedor: 'claude-cli',
  modelo: null,
  origem: 'exemplo' as const,
  arquivo: `agents/${nome}.md`,
  ...extra,
});

function setup() {
  const db = openDb();
  migrate(db);
  return { db, repos: createRepos(db) };
}

describe('agents index', () => {
  it('adds, updates in place (the id stays) and removes names that disappeared', () => {
    const { repos } = setup();
    repos.agents.sync([entry('a'), entry('b')]);
    const id = repos.agents.byName('a')!.id;
    repos.agents.sync([entry('a', { modelo: 'opus', origem: 'usuario' })]);
    expect(repos.agents.byName('a')).toMatchObject({ id, modelo: 'opus', origem: 'usuario' });
    expect(repos.agents.byName('b')).toBeUndefined();
    expect(repos.agents.list().map((x) => x.nome)).toEqual(['a']);
  });

  it('a run keeps its agent while the agent exists and loses the link, not the run, when it is removed', () => {
    const { repos } = setup();
    repos.agents.sync([entry('a')]);
    const agentId = repos.agents.byName('a')!.id;
    const session = repos.sessions.create({});
    const run = repos.runs.start({ provedor: 'claude-cli', sessionId: session.id, agentId });
    expect(repos.runs.get(run.id)!.agentId).toBe(agentId);
    repos.agents.sync([]);
    expect(repos.runs.get(run.id)).toMatchObject({ agentId: null });
  });
});
