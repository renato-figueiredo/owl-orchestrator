import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSafeName, parseAgentFile } from './agents.js';
import { evaluateExpression, isEnabled, nextStep, parsePipeline, renderTemplate, type PipelineState } from './pipeline.js';

const example = (p: string) => readFileSync(fileURLToPath(new URL(`../../../examples/${p}`, import.meta.url)), 'utf8');
const state = (over: Partial<PipelineState> = {}): PipelineState => ({ pedido: 'faça X', opcoes: {}, etapas: {}, ...over });

describe('example files', () => {
  it('the refiner agent parses: Codex first, haiku as the alternative, prompt present', () => {
    const a = parseAgentFile(example('agents/refinador-de-prompt.md'));
    expect(a).toMatchObject({ nome: 'refinador-de-prompt', provedor: 'codex-cli', fallback: [{ provedor: 'claude-cli', modelo: 'haiku' }] });
    expect(a.prompt).toContain('SOMENTE o prompt reescrito');
  });
  it('the pipeline parses', () => {
    const p = parsePipeline(example('pipelines/melhorar-e-executar.yaml'));
    expect(p.etapas.map((s) => s.id)).toEqual(['melhorar', 'executar']);
    expect(p.etapas[0]).toMatchObject({ agente: 'refinador-de-prompt', revisao: true });
  });
});

describe('parseAgentFile', () => {
  it('requires front matter, a valid name and a prompt', () => {
    expect(() => parseAgentFile('sem front matter')).toThrow();
    expect(() => parseAgentFile('---\nnome: Bad Name\nprovedor: x\n---\ntexto')).toThrow();
    expect(() => parseAgentFile('---\nnome: ok\nprovedor: x\n---\n')).toThrow(/system prompt/);
    expect(parseAgentFile('---\nnome: ok\nprovedor: x\n---\nOlá').fallback).toEqual([]);
  });
  it('isSafeName refuses path tricks', () => {
    for (const bad of ['../x', 'a/b', '.hidden', 'A', '', 'a b']) expect(isSafeName(bad)).toBe(false);
    expect(isSafeName('refinador-de-prompt')).toBe(true);
  });
});

describe('parsePipeline', () => {
  it('rejects duplicate ids, empty pipelines and bad ids', () => {
    expect(() => parsePipeline('nome: a\netapas:\n  - id: x\n  - id: x\n')).toThrow(/Duplicate/);
    expect(() => parsePipeline('nome: a\netapas: []\n')).toThrow();
    expect(() => parsePipeline('nome: a\netapas:\n  - id: "a b"\n')).toThrow();
  });
});

describe('templates (no eval)', () => {
  it('resolves pedido, opcoes and etapas, with ?? fallbacks and literals', () => {
    const s = state({ opcoes: { melhorarPrompt: true }, etapas: { melhorar: { saida: 'prompt bom' } } });
    expect(renderTemplate('{{ etapas.melhorar.saida ?? pedido }}', s)).toBe('prompt bom');
    expect(renderTemplate('{{ etapas.outra.saida ?? pedido }}', s)).toBe('faça X');
    expect(renderTemplate('{{ etapas.outra.saida ?? \'padrão\' }}', s)).toBe('padrão');
    expect(renderTemplate('antes {{ pedido }} depois', s)).toBe('antes faça X depois');
    expect(renderTemplate('{{ opcoes.inexistente }}', s)).toBe('');
  });

  it('refuses anything that is not a path or a string literal', () => {
    for (const bad of ['process.exit()', '1 + 1', 'globalThis', 'require("fs")', 'pedido; x', '`x`', '(pedido)']) {
      expect(() => evaluateExpression(bad, state()), bad).toThrow();
    }
  });

  it('does not reach prototypes or inherited properties', () => {
    for (const p of ['pedido.length', 'pedido.constructor', 'opcoes.constructor', 'opcoes.__proto__', 'etapas.__proto__.x', 'opcoes.toString', 'opcoes.hasOwnProperty']) {
      expect(evaluateExpression(p, state()), p).toBeUndefined();
    }
    expect(renderTemplate('{{ opcoes.constructor }}', state())).toBe('');
  });

  it('`??` inside a string literal is part of the literal, not an operator', () => {
    expect(evaluateExpression("'a ?? b'", state())).toBe('a ?? b');
    expect(evaluateExpression("etapas.x.saida ?? 'não ?? sei'", state())).toBe('não ?? sei');
    expect(evaluateExpression('opcoes.x ?? "\'??\'"', state())).toBe("'??'");
  });

  it('user text is data: braces in the request are never evaluated', () => {
    const s = state({ pedido: '{{ process.exit() }} e {{ opcoes.x }}' });
    expect(renderTemplate('{{ pedido }}', s)).toBe('{{ process.exit() }} e {{ opcoes.x }}');
  });
});

describe('quando', () => {
  it('missing quando runs; falsy values skip', () => {
    expect(isEnabled(undefined, state())).toBe(true);
    const q = '{{ opcoes.melhorarPrompt }}';
    expect(isEnabled(q, state({ opcoes: { melhorarPrompt: true } }))).toBe(true);
    for (const v of [false, 0, '', 'false', 'FALSE', '0', null, undefined]) expect(isEnabled(q, state({ opcoes: { melhorarPrompt: v } })), String(v)).toBe(false);
  });
});

describe('nextStep (resumable stepper)', () => {
  const pipeline = parsePipeline(example('pipelines/melhorar-e-executar.yaml'));

  it('checkbox off: the refinement step is skipped and only "executar" runs, with the original request', () => {
    const s = state({ opcoes: { melhorarPrompt: false } });
    const next = nextStep(pipeline, s);
    expect(next?.step.id).toBe('executar');
    expect(next?.entrada).toBe('faça X');
    expect(s.etapas.melhorar).toEqual({ ignorada: true });
    s.etapas.executar = { saida: 'feito' };
    expect(nextStep(pipeline, s)).toBeNull();
  });

  it('an input that renders empty falls back to the request (never an empty prompt)', () => {
    const s = state({ opcoes: { melhorarPrompt: true }, etapas: { melhorar: { saida: '   ' } } });
    expect(nextStep(pipeline, s)).toMatchObject({ step: { id: 'executar' }, entrada: 'faça X' });
  });

  it('checkbox on: refine first, then run with the refined (or edited) prompt', () => {
    const s = state({ opcoes: { melhorarPrompt: true } });
    expect(nextStep(pipeline, s)).toMatchObject({ step: { id: 'melhorar' }, entrada: 'faça X' });
    s.etapas.melhorar = { saida: 'Objetivo: X' };
    expect(nextStep(pipeline, s)).toMatchObject({ step: { id: 'executar' }, entrada: 'Objetivo: X' });
    s.etapas.melhorar = { saida: 'EDITADO pelo usuário' }; // an edit just replaces the stored output
    expect(nextStep(pipeline, s)?.entrada).toBe('EDITADO pelo usuário');
  });
});
