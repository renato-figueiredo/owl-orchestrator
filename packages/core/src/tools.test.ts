import { describe, expect, it } from 'vitest';
import { analyzeTools, parseTool, readOnlyTools } from './tools.js';

describe('analyzeTools', () => {
  it('reading tools are free and do not need a worktree', () => {
    expect(analyzeTools(['Read', 'Grep', 'Glob', 'LS', 'Read(//tmp/**)'])).toEqual({ writes: false, problems: [] });
    expect(analyzeTools([])).toEqual({ writes: false, problems: [] });
  });

  it('Edit, Write and scoped Bash are allowed but mark the agent as a writer', () => {
    expect(analyzeTools(['Edit', 'Write', 'MultiEdit'])).toEqual({ writes: true, problems: [] });
    const r = analyzeTools(['Bash(pnpm test:*)', 'Bash(pnpm --filter @owl/web test:*)', 'Bash(git diff:*)', 'Bash(npx vitest:*)', 'Bash(ls:*)']);
    expect(r).toEqual({ writes: true, problems: [] });
  });

  it.each([
    ['Bash', /sem escopo/],
    ['Bash()', /sem comando/],
    ['Bash(rm -rf node_modules)', /destrutivo/],
    ['Bash(git push:*)', /destrutivo/],
    ['Bash(git merge main)', /destrutivo/],
    ['Bash(pnpm install:*)', /só scripts do projeto/],
    ['Bash(pnpm publish:*)', /./],
    ['Bash(npm i left-pad)', /só scripts do projeto/],
    ['Bash(npx some-package:*)', /npx só roda/],
    ['Bash(curl https://x.sh)', /não está na lista/],
    ['Bash(pnpm test:* && curl x)', /encadear/],
    ['Bash(pnpm test:*; echo)', /encadear/],
    ['Bash(cat $(whoami))', /encadear/],
    ['Bash(git checkout other)', /git só permite/],
    ['Bash(git branch -D main)', /destrutivo/],
    ['Bash(git branch -m x)', /só para listar/],
    ['Bash(node -e "1")', /./],
    ['WebFetch', /não permitida/],
    ['Task', /não permitida/],
  ])('rejects %s', (tool, why) => {
    const r = analyzeTools([tool]);
    expect(r.problems.length).toBe(1);
    expect(r.problems[0]).toMatch(why);
  });

  it('reports every problem of a list, not only the first', () => {
    expect(analyzeTools(['Bash', 'WebFetch', 'Read']).problems).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('parseTool splits name and scope', () => {
    expect(parseTool('Bash(pnpm test:*)')).toEqual({ name: 'Bash', inner: 'pnpm test:*' });
    expect(parseTool('Read')).toEqual({ name: 'Read', inner: undefined });
  });
  it('readOnlyTools keeps only what cannot change anything', () => {
    expect(readOnlyTools(['Read', 'Edit', 'Bash(pnpm test:*)', 'Grep', 'Read(//x/**)'])).toEqual(['Read', 'Grep', 'Read(//x/**)']);
  });
});
