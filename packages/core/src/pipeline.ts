import { parse } from 'yaml';
import { z } from 'zod';
import { describeZodError } from './agents.js';

const stepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/i),
  /** Agent file name. Without it the step uses the provider and model the user chose for the conversation. */
  agente: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  /** Template; the step is skipped when it evaluates to something falsy. */
  quando: z.string().optional(),
  /** Template for the prompt of the step (default: the original request). */
  entrada: z.string().optional(),
  /** The user may review and edit this step's output before the next step runs (when they asked for it). */
  revisao: z.boolean().optional(),
  /** How many times the step may run when it fails or answers with nothing (default 1: no automatic retry). */
  tentativas: z.number().int().min(1).max(5).optional(),
  /** Id of an earlier step: this one must run on a different provider than that step did (a cross-provider review). */
  outroProvedorQue: z.string().regex(/^[a-z][a-z0-9_]*$/i).optional(),
});

const pipelineSchema = z.object({
  nome: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  etapas: z.array(stepSchema).min(1),
});

export type PipelineStep = z.infer<typeof stepSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;

export function parsePipeline(text: string): Pipeline {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const parsed = pipelineSchema.safeParse(raw);
  if (!parsed.success) throw new Error(describeZodError(parsed.error));
  const p = parsed.data;
  const ids = new Set<string>();
  for (const s of p.etapas) {
    if (ids.has(s.id)) throw new Error(`Duplicate step id: ${s.id}`);
    if (s.outroProvedorQue !== undefined && !ids.has(s.outroProvedorQue)) {
      throw new Error(`Step ${s.id}: outroProvedorQue must name an earlier step, got ${JSON.stringify(s.outroProvedorQue)}`);
    }
    if (s.outroProvedorQue !== undefined && !s.agente) {
      throw new Error(`Step ${s.id}: outroProvedorQue needs an agent (its provider and fallbacks are the candidates)`);
    }
    ids.add(s.id);
  }
  return p;
}

export interface PipelineState {
  /** The user's original request. */
  pedido: string;
  opcoes: Record<string, unknown>;
  etapas: Record<string, { saida?: string; ignorada?: boolean; /** Provider that ran the step. */ provedor?: string }>;
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Reads `a.b.c` from the state. Only own properties are followed, so `constructor` and friends resolve to nothing. */
function lookup(path: string, state: PipelineState): unknown {
  const parts = path.split('.');
  let cur: unknown = state;
  for (const part of parts) {
    if (FORBIDDEN.has(part) || typeof cur !== 'object' || cur === null || !own(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const ROOTS = new Set(['pedido', 'opcoes', 'etapas']);
const PATH = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w-]*)*$/;
const STRING = /^(['"])(.*)\1$/;

/** One operand: a string literal or a path that starts at `pedido`, `opcoes` or `etapas`. */
function operand(raw: string, state: PipelineState): unknown {
  const t = raw.trim();
  const lit = t.match(STRING);
  if (lit) return lit[2];
  if (!PATH.test(t) || !ROOTS.has(t.split('.')[0]!)) throw new Error(`Unsupported expression: ${JSON.stringify(t)}`);
  return lookup(t, state);
}

/** Splits on `??` outside string literals, so `'a ?? b'` stays one operand. */
function splitCoalesce(expr: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '?' && expr[i + 1] === '?') {
      parts.push(expr.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

/** `a ?? b ?? 'x'`: first operand that is neither undefined nor null. NOT code: no calls, no operators beyond `??`. */
export function evaluateExpression(expr: string, state: PipelineState): unknown {
  for (const part of splitCoalesce(expr)) {
    const v = operand(part, state);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const TEMPLATE = /\{\{([^{}]*)\}\}/g;

/** Resolves `{{ ... }}` blocks in a string. Missing values become an empty string. */
export function renderTemplate(template: string, state: PipelineState): string {
  return template.replace(TEMPLATE, (_, expr: string) => {
    const v = evaluateExpression(expr, state);
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Truthiness of a `quando`: false, 0, empty and the strings "false"/"0" skip the step; a missing `quando` runs it. */
export function isEnabled(quando: string | undefined, state: PipelineState): boolean {
  if (quando === undefined) return true;
  const m = quando.match(/^\s*\{\{([^{}]*)\}\}\s*$/);
  const v = m ? evaluateExpression(m[1]!, state) : renderTemplate(quando, state);
  if (typeof v === 'string') return !['', 'false', '0'].includes(v.trim().toLowerCase());
  return Boolean(v);
}

export interface PlannedStep {
  step: PipelineStep;
  /** The resolved prompt for this step. */
  entrada: string;
}

/**
 * The next step to run, or null when the pipeline is finished. Steps already in `state.etapas` are done; steps whose
 * `quando` is falsy are recorded as `ignorada` and passed over. The caller runs the step, stores its output in
 * `state.etapas[id]` and asks again, which makes the pipeline resumable between any two steps.
 */
export function nextStep(pipeline: Pipeline, state: PipelineState): PlannedStep | null {
  for (const step of pipeline.etapas) {
    if (own(state.etapas, step.id)) continue;
    if (!isEnabled(step.quando, state)) {
      state.etapas[step.id] = { ignorada: true };
      continue;
    }
    const rendered = step.entrada === undefined ? state.pedido : renderTemplate(step.entrada, state);
    // A step must never run with an empty prompt (it would spend tokens on nothing): fall back to the request.
    return { step, entrada: rendered.trim() === '' ? state.pedido : rendered };
  }
  return null;
}

export interface ProviderChoice {
  provedor: string;
  modelo?: string | undefined;
}

/** First candidate whose provider is not `avoid`, or undefined when every candidate would repeat it. */
export function pickOtherProvider<T extends ProviderChoice>(candidates: readonly T[], avoid: string | undefined): T | undefined {
  return candidates.find((c) => c.provedor !== avoid);
}
