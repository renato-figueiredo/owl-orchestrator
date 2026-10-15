import { describe, expect, it } from 'vitest';
import { evaluateExpression, isEnabled, nextStep, parsePipeline, renderTemplate, type PipelineState } from './pipeline.js';

// QA gap tests for prompt 06: YAML validation and stepper edge cases.

const state = (over: Partial<PipelineState> = {}): PipelineState => ({ pedido: 'faça X', opcoes: {}, etapas: {}, ...over });
const FLOW = `
nome: melhorar-e-executar
etapas:
  - id: melhorar
    agente: refinador-de-prompt
    quando: "{{ opcoes.melhorarPrompt }}"
    revisao: true
  - id: executar
    entrada: "{{ etapas.melhorar.saida ?? pedido }}"
`;

describe('parsePipeline validation', () => {
  it.each([
    ['invalid YAML', 'nome: [x'],
    ['not an object', '- a\n- b'],
    ['missing nome', 'etapas:\n  - id: a'],
    ['uppercase/underscore nome', 'nome: Bad_Name\netapas:\n  - id: a'],
    ['agente with path traversal', 'nome: x\netapas:\n  - id: a\n    agente: ../../etc/passwd'],
    ['agente with uppercase', 'nome: x\netapas:\n  - id: a\n    agente: Agent'],
    ['revisao not boolean', 'nome: x\netapas:\n  - id: a\n    revisao: sim'],
    ['step id starting with digit', 'nome: x\netapas:\n  - id: 1a'],
    ['step id with hyphen (would not be addressable in templates)', 'nome: x\netapas:\n  - id: a-b'],
    ['etapas is not a list', 'nome: x\netapas: a'],
  ])('rejects %s', (_n, yaml) => {
    expect(() => parsePipeline(yaml)).toThrow();
  });

  it('accepts a minimal valid pipeline and keeps optional fields undefined', () => {
    const p = parsePipeline('nome: x\netapas:\n  - id: a');
    expect(p.etapas[0]).toEqual({ id: 'a' });
  });
});

describe('quando / templates, extra edge cases', () => {
  it('opcoes values: false, 0, "false", "0", "" skip; true, 1, "sim" run', () => {
    for (const v of [false, 0, 'false', '0', '', 'FALSE', ' false ', undefined, null]) {
      expect(isEnabled('{{ opcoes.m }}', state({ opcoes: { m: v } })), String(v)).toBe(false);
    }
    for (const v of [true, 1, 'sim', 'true']) {
      expect(isEnabled('{{ opcoes.m }}', state({ opcoes: { m: v } })), String(v)).toBe(true);
    }
  });

  it('a quando that uses an unsupported expression throws instead of running the step', () => {
    expect(() => isEnabled('{{ opcoes.m && true }}', state())).toThrow();
  });

  it('? fallback chain skips null and undefined but not empty string (documented behaviour)', () => {
    expect(evaluateExpression('etapas.a.saida ?? pedido', state({ etapas: { a: { saida: '' } } }))).toBe('');
    expect(evaluateExpression('etapas.a.saida ?? pedido', state({ etapas: { a: { ignorada: true } } }))).toBe('faça X');
  });

  it('no recursion: a refined output containing braces is returned verbatim', () => {
    const s = state({ etapas: { melhorar: { saida: 'use {{ pedido }}' } } });
    expect(renderTemplate('{{ etapas.melhorar.saida ?? pedido }}', s)).toBe('use {{ pedido }}');
  });

  it('unterminated or empty braces do not crash', () => {
    expect(renderTemplate('{{ pedido', state())).toBe('{{ pedido');
    expect(() => renderTemplate('{{ }}', state())).toThrow();
  });
});

describe('nextStep (stepper) edge cases', () => {
  const flow = parsePipeline(FLOW);

  it('is idempotent: asking twice without storing an output returns the same step', () => {
    const s = state({ opcoes: { melhorarPrompt: true } });
    expect(nextStep(flow, s)?.step.id).toBe('melhorar');
    expect(nextStep(flow, s)?.step.id).toBe('melhorar');
  });

  it('checkbox off marks "melhorar" as ignored and never returns it again', () => {
    const s = state({ opcoes: { melhorarPrompt: false } });
    expect(nextStep(flow, s)?.step.id).toBe('executar');
    expect(s.etapas.melhorar).toEqual({ ignorada: true });
    s.etapas.executar = { saida: 'x' };
    expect(nextStep(flow, s)).toBeNull();
  });

  it('retry support: removing a step output brings it back as the next step', () => {
    const s = state({ opcoes: { melhorarPrompt: true }, etapas: { melhorar: { saida: 'novo' } } });
    expect(nextStep(flow, s)?.step.id).toBe('executar');
    delete s.etapas.melhorar;
    expect(nextStep(flow, s)?.step.id).toBe('melhorar');
  });

  it('a skipped (ignorada) refiner leaves the executor with the original request', () => {
    const s = state({ opcoes: { melhorarPrompt: true }, etapas: { melhorar: { ignorada: true } } });
    expect(nextStep(flow, s)).toMatchObject({ step: { id: 'executar' }, entrada: 'faça X' });
  });

  it('an edited output replaces the refined one in the next prompt', () => {
    const s = state({ opcoes: { melhorarPrompt: true }, etapas: { melhorar: { saida: 'EDITADO' } } });
    expect(nextStep(flow, s)?.entrada).toBe('EDITADO');
  });

  it('all steps skipped: finishes with null', () => {
    const p = parsePipeline('nome: x\netapas:\n  - id: a\n    quando: "{{ opcoes.go }}"');
    expect(nextStep(p, state())).toBeNull();
  });
});
