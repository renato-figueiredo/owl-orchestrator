import { describe, expect, it } from 'vitest';
import { parseAgentFile, serializeAgent } from './agents.js';
import { classificationSchema, complexityOf, escalate, fromClassification, needsApproval, routeByRules, routerConfigSchema, DEFAULT_ROUTER, tierOf, withEscalation } from './router.js';

describe('routeByRules (no model involved)', () => {
  it('short, simple requests are small', () => {
    expect(routeByRules({ papel: 'dev', texto: 'Corrigir o texto do botão de login' })).toMatchObject({ complexidade: 'baixa', tier: 'pequeno', confianca: 1, origem: 'regra' });
  });

  it.each(['Migração do banco', 'Refatorar tudo no módulo de pagamentos', 'Reescrever o parser', 'Rever a segurança do login', 'Decisão de arquitetura do cache'])('risk keyword "%s" is large', (texto) => {
    expect(routeByRules({ papel: 'dev', texto })).toMatchObject({ complexidade: 'alta', tier: 'forte' });
  });

  it('keywords win over a short size and over the role', () => {
    expect(routeByRules({ papel: 'memoria', texto: 'migração' })?.tier).toBe('forte');
    expect(routeByRules({ papel: 'dev', texto: 'Ajustar typo na migração' })?.tier).toBe('forte');
  });

  it('roles that summarize are small, roles that judge are medium', () => {
    expect(routeByRules({ papel: 'memoria', texto: 'x'.repeat(5000) })?.tier).toBe('pequeno');
    expect(routeByRules({ papel: 'qa', texto: 'conferir' })?.tier).toBe('medio');
    expect(routeByRules({ papel: 'po', texto: 'x' })?.tier).toBe('medio');
  });

  it('a big diff or many sub-tasks are large', () => {
    expect(routeByRules({ papel: 'qa', texto: 'conferir', linhasDiff: 900 })?.tier).toBe('forte');
    expect(routeByRules({ papel: 'revisor', texto: 'conferir', arquivos: 20 })?.tier).toBe('forte');
    expect(routeByRules({ papel: 'dev', texto: 'planejar', subtarefas: 6 })?.tier).toBe('forte');
  });

  it('does not decide when the signals are mixed: a medium request without keywords is ambiguous', () => {
    expect(routeByRules({ papel: 'dev', texto: 'Adicionar um filtro. '.repeat(60) })).toBeUndefined();
    expect(routeByRules({ papel: 'dev', texto: 'curto', criterios: 5 })).toBeUndefined();
  });

  it('a very long request is large', () => {
    expect(routeByRules({ papel: 'dev', texto: 'detalhe '.repeat(1000) })?.tier).toBe('forte');
  });

  it('ignores accents and case in keywords', () => {
    expect(routeByRules({ papel: 'dev', texto: 'MIGRACAO de dados' })?.tier).toBe('forte');
    expect(routeByRules({ papel: 'dev', texto: 'Segurança' })?.tier).toBe('forte');
  });
});

describe('classification (phase 2 output)', () => {
  it('accepts the documented shape', () => {
    expect(fromClassification({ complexidade: 'media', confianca: 0.8, motivo: 'alguns arquivos' })).toEqual({ complexidade: 'media', tier: 'medio', confianca: 0.8, motivo: 'alguns arquivos', origem: 'modelo' });
  });
  it.each([null, 'media', {}, { complexidade: 'média', confianca: 1 }, { complexidade: 'alta', confianca: 3 }, { complexidade: 'alta', confianca: -1 }, { complexidade: 'alta' }])('rejects %j', (v) => {
    expect(fromClassification(v)).toBeUndefined();
  });
  it('a missing reason is filled in', () => {
    expect(classificationSchema.parse({ complexidade: 'baixa', confianca: 1 }).motivo).toBe('');
    expect(fromClassification({ complexidade: 'baixa', confianca: 1 })?.motivo).toBeTruthy();
  });
});

describe('tiers, escalation and confidence', () => {
  it('maps complexity to tier and back', () => {
    expect(['baixa', 'media', 'alta'].map((c) => tierOf(c as 'baixa'))).toEqual(['pequeno', 'medio', 'forte']);
    expect((['pequeno', 'medio', 'forte'] as const).map(complexityOf)).toEqual(['baixa', 'media', 'alta']);
  });
  it('escalates one tier per failure and stops at the strongest', () => {
    expect(escalate('pequeno')).toBe('medio');
    expect(escalate('pequeno', 2)).toBe('forte');
    expect(escalate('forte', 3)).toBe('forte');
    expect(escalate('medio', -1)).toBe('medio');
  });
  it('withEscalation keeps the decision with no failures and records the jump', () => {
    const base = routeByRules({ papel: 'dev', texto: 'typo' })!;
    expect(withEscalation(base, 0)).toBe(base);
    expect(withEscalation(base, 1)).toMatchObject({ tier: 'medio', origem: 'escalonamento' });
    expect(withEscalation(base, 1).motivo).toContain('1 reprovação');
    expect(withEscalation({ ...base, tier: 'forte' }, 2)).toMatchObject({ tier: 'forte', origem: 'regra' });
  });
  it('low confidence needs a person; the threshold itself does not', () => {
    const d = { complexidade: 'media', tier: 'medio', motivo: '', origem: 'modelo' } as const;
    expect(needsApproval({ ...d, confianca: 0.59 }, 0.6)).toBe(true);
    expect(needsApproval({ ...d, confianca: 0.6 }, 0.6)).toBe(false);
  });
  it('the default config is valid and unknown keys are refused', () => {
    expect(routerConfigSchema.parse(DEFAULT_ROUTER)).toEqual(DEFAULT_ROUTER);
    expect(routerConfigSchema.safeParse({ ...DEFAULT_ROUTER, extra: 1 }).success).toBe(false);
    expect(routerConfigSchema.safeParse({ ...DEFAULT_ROUTER, orcamentoDiaTokens: 0 }).success).toBe(false);
  });
});

describe('agent file: roteamento', () => {
  const file = (extra: string) => `---\nnome: a\nprovedor: claude-cli\n${extra}---\nprompt\n`;
  it('defaults to fixo and round-trips auto', () => {
    expect(parseAgentFile(file('')).roteamento).toBe('fixo');
    const auto = parseAgentFile(file('roteamento: auto\n'));
    expect(auto.roteamento).toBe('auto');
    expect(parseAgentFile(serializeAgent(auto)).roteamento).toBe('auto');
    expect(serializeAgent(parseAgentFile(file(''))).includes('roteamento')).toBe(false);
  });
  it('rejects other values', () => {
    expect(() => parseAgentFile(file('roteamento: sempre\n'))).toThrow(/roteamento/);
  });
});
