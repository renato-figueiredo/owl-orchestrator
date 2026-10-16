import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildClaudeArgs, scopeReadTools, scopeWriteTools } from './claude-cli.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owl-scope-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scopeWriteTools', () => {
  it('turns every bare writing tool into one Edit rule confined to the working folder', () => {
    const rules = scopeWriteTools(['Read', 'Edit', 'Write', 'MultiEdit', 'Bash(pnpm test:*)'], dir);
    expect(rules).toContain('Read');
    expect(rules).toContain('Bash(pnpm test:*)');
    expect(rules.filter((r) => r.startsWith('Edit('))).toEqual([`Edit(/${dir}/**)`]);
    expect(rules.some((r) => r === 'Edit' || r === 'Write' || r === 'MultiEdit')).toBe(false);
  });

  it('also covers the real path when the folder is reached through a symlink', () => {
    const real = join(dir, 'real');
    mkdirSync(real);
    const link = join(dir, 'link');
    symlinkSync(real, link);
    const rules = scopeWriteTools(['Write'], link).filter((r) => r.startsWith('Edit('));
    expect(rules).toHaveLength(2);
    expect(rules).toContain(`Edit(/${link}/**)`);
    expect(rules.some((r) => r.includes(`${real}/**`))).toBe(true);
  });

  it('keeps the path an agent scoped itself (Write(path) becomes Edit(path), the only form the CLI honours)', () => {
    expect(scopeWriteTools(['Write(//x/y/**)', 'Edit(./src/**)'], dir)).toEqual(['Edit(//x/y/**)', 'Edit(./src/**)']);
  });

  it('is applied to the arguments of a run', () => {
    const args = buildClaudeArgs({ prompt: 'p', cwd: dir, allowedTools: ['Edit', 'Read'] });
    const tools = args.slice(args.indexOf('--allowedTools') + 1);
    expect(tools).toEqual(['Edit(/' + dir + '/**)', 'Read'].sort((a, b) => tools.indexOf(a) - tools.indexOf(b)));
    expect(tools).not.toContain('Edit');
  });
});

describe('scopeReadTools', () => {
  it('turns a bare Read into a rule confined to the working folder and leaves the rest alone', () => {
    expect(scopeReadTools(['Read', 'Grep', 'Read(//x/**)', 'Bash(pnpm test:*)'], dir)).toEqual([`Read(/${dir}/**)`, 'Grep', 'Read(//x/**)', 'Bash(pnpm test:*)']);
  });

  it('only applies when the run asks for it', () => {
    const on = buildClaudeArgs({ prompt: 'p', cwd: dir, allowedTools: ['Read'], confineReads: true });
    expect(on.slice(on.indexOf('--allowedTools') + 1)).toContain(`Read(/${dir}/**)`);
    const off = buildClaudeArgs({ prompt: 'p', cwd: dir, allowedTools: ['Read'] });
    expect(off.slice(off.indexOf('--allowedTools') + 1)).toEqual(['Read']);
  });
});
