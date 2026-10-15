import { describe, expect, it } from 'vitest';
import { childEnv, parseAgentFile, parsePipeline, parseSkillFile, pickOtherProvider, renderSkills, serializeAgent } from './index.js';

const AGENT = `---
nome: dev-back
provedor: claude-cli
modelo: sonnet
ferramentas: [Read, "Bash(pnpm *)"]
skills: [checklist-de-revisao]
---
Você escreve código.
`;

describe('agent files', () => {
  it('reads every field, with defaults for the optional ones', () => {
    const a = parseAgentFile(AGENT);
    expect(a).toMatchObject({
      nome: 'dev-back',
      provedor: 'claude-cli',
      modelo: 'sonnet',
      ferramentas: ['Read', 'Bash(pnpm *)'],
      skills: ['checklist-de-revisao'],
      pode_aprovar: false,
      fallback: [],
      prompt: 'Você escreve código.',
    });
  });

  it('round-trips through serializeAgent', () => {
    const a = parseAgentFile(AGENT);
    expect(parseAgentFile(serializeAgent({ ...a, nome: 'copia', pode_aprovar: true }))).toEqual({ ...a, nome: 'copia', pode_aprovar: true });
  });

  it('says which field is wrong instead of dumping the validator', () => {
    expect(() => parseAgentFile('---\nnome: Maiúsculo\nprovedor: x\n---\nok')).toThrow(/^nome: /);
    expect(() => parseAgentFile('---\nnome: a\n---\nok')).toThrow(/provedor: /);
    expect(() => parseAgentFile('---\nnome: a\nprovedor: x\nferramentas: Read\n---\nok')).toThrow(/ferramentas: /);
  });

  it('rejects a misspelled field instead of ignoring it', () => {
    expect(() => parseAgentFile('---\nnome: a\nprovedor: x\nferramenta: [Bash]\n---\nok')).toThrow(/ferramenta/);
  });

  it('rejects broken YAML without a stack dump', () => {
    const run = () => parseAgentFile('---\nnome: [a\nprovedor: x\n---\nok');
    expect(run).toThrow(/Invalid front matter/);
    expect(run).not.toThrow(/\n\s+at /);
  });
});

describe('skills', () => {
  const SKILL = `---\nname: revisao\ndescription: Use ao revisar.\nallowed-tools: Read\n---\n# Passos\n1. Leia.\n`;

  it('reads a SKILL.md written for Claude Code, ignoring keys OWL does not use', () => {
    expect(parseSkillFile(SKILL)).toEqual({ nome: 'revisao', descricao: 'Use ao revisar.', corpo: '# Passos\n1. Leia.' });
  });

  it('needs name, description and instructions', () => {
    expect(() => parseSkillFile('# sem front matter')).toThrow(/front matter|---/);
    expect(() => parseSkillFile('---\nname: a\n---\ncorpo')).toThrow(/description/);
    expect(() => parseSkillFile('---\nname: A_B\ndescription: x\n---\ncorpo')).toThrow(/name/);
    expect(() => parseSkillFile('---\nname: a\ndescription: x\n---\n')).toThrow(/instructions/);
  });

  it('renders a block for the system prompt, empty when there are no skills', () => {
    expect(renderSkills([])).toBe('');
    const text = renderSkills([parseSkillFile(SKILL)]);
    expect(text).toContain('## Skill: revisao');
    expect(text).toContain('1. Leia.');
  });
});

describe('pipeline step options', () => {
  const base = (extra: string) => `nome: p\netapas:\n  - id: a\n  - id: b\n    agente: revisor\n${extra}`;

  it('accepts tentativas and outroProvedorQue pointing at an earlier step', () => {
    const p = parsePipeline(base('    tentativas: 3\n    outroProvedorQue: a\n'));
    expect(p.etapas[1]).toMatchObject({ tentativas: 3, outroProvedorQue: 'a' });
  });

  it('rejects a reference to a later or unknown step, a missing agent and a silly retry count', () => {
    expect(() => parsePipeline(base('    outroProvedorQue: z\n'))).toThrow(/earlier step/);
    expect(() => parsePipeline('nome: p\netapas:\n  - id: a\n    outroProvedorQue: a\n')).toThrow(/earlier step/);
    expect(() => parsePipeline('nome: p\netapas:\n  - id: a\n  - id: b\n    outroProvedorQue: a\n')).toThrow(/needs an agent/);
    expect(() => parsePipeline(base('    tentativas: 0\n'))).toThrow(/tentativas/);
    expect(() => parsePipeline(base('    tentativas: 99\n'))).toThrow(/tentativas/);
  });

  it('reports a malformed file as a message', () => {
    expect(() => parsePipeline('nome: p\netapas: []\n')).toThrow(/etapas/);
    expect(() => parsePipeline('nome: [')).toThrow(/Invalid YAML/);
  });

  it('pickOtherProvider skips the provider to avoid', () => {
    expect(pickOtherProvider([{ provedor: 'a' }, { provedor: 'b' }], 'a')).toEqual({ provedor: 'b' });
    expect(pickOtherProvider([{ provedor: 'a' }], 'a')).toBeUndefined();
    expect(pickOtherProvider([{ provedor: 'a' }], undefined)).toEqual({ provedor: 'a' });
  });
});

describe('childEnv', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/x',
    LANG: 'pt_BR.UTF-8',
    LC_ALL: 'C',
    XDG_CONFIG_HOME: '/c',
    HTTPS_PROXY: 'http://p',
    https_proxy: 'http://p',
    CLAUDE_CONFIG_DIR: '/cfg',
    CODEX_HOME: '/cx',
    SSH_AUTH_SOCK: '/s',
    NODE_OPTIONS: '--require /evil.js',
    GITHUB_TOKEN: 'x',
    AWS_SECRET_ACCESS_KEY: 'y',
    MY_VAR: 'z',
  };

  it('passes what a CLI needs and nothing else', () => {
    expect(Object.keys(childEnv(base)).sort()).toEqual(
      ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'HOME', 'HTTPS_PROXY', 'LANG', 'LC_ALL', 'PATH', 'XDG_CONFIG_HOME', 'https_proxy'],
    );
  });

  it('passes extra names the user listed, only when set', () => {
    const out = childEnv(base, ['SSH_AUTH_SOCK', 'NOT_SET']);
    expect(out.SSH_AUTH_SOCK).toBe('/s');
    expect('NOT_SET' in out).toBe(false);
    expect(out.GITHUB_TOKEN).toBeUndefined();
  });
});
