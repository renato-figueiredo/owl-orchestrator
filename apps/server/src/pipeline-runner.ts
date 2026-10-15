import { nextStep, type Pipeline, type PipelineState, type PipelineStep } from '@owl/core';
import type { createRepos, Run } from '@owl/db';
import type { Executor, StepOutcome } from './executor.js';
import type { Library } from './library.js';

type Repos = ReturnType<typeof createRepos>;

export interface PipelineRequest {
  sessionId: string;
  /** The user's original request. */
  pedido: string;
  cwd: string;
  /** Pause after a `revisao` step so the user can edit its output before the next step. */
  editarAntes: boolean;
  /** Provider, model and instructions for steps that name no agent. */
  executar: { provider: string; model?: string; systemAppend?: string };
  /** Overrides the refiner agent's own provider/model (e.g. the user picked haiku). */
  refinador?: { provider: string; model?: string };
}

/** Raised when a pipeline cannot be resumed (unknown or already handled run, or the server restarted). */
export class PipelineError extends Error {
  constructor(
    readonly status: 404 | 409 | 410,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Context {
  req: PipelineRequest;
  pipeline: Pipeline;
  state: PipelineState;
  /** The step this context is waiting on (a review or a failure). */
  waitingOn?: PipelineStep;
}

/**
 * Runs a pipeline one step at a time. Each step is a run (`etapa`, `parent_run_id` = the run that fed it). The
 * pipeline state lives in memory between steps; a pause (user review or a failed refinement) is also stored as a
 * pending approval so the interface can show it after a reload. After a server restart a pause can no longer be
 * resumed (410): the user just sends the request again.
 */
export class PipelineRunner {
  private readonly waiting = new Map<string, Context>();

  constructor(
    private readonly deps: { repos: Repos; executor: Executor; library: Library; pipelineName?: string },
  ) {}

  /** Stores the request and starts the first step that applies. */
  start(req: PipelineRequest, opcoes: { melhorarPrompt: boolean }): Run {
    const pipeline = this.deps.library.pipeline(this.deps.pipelineName ?? 'melhorar-e-executar');
    const ctx: Context = {
      req,
      pipeline,
      state: { pedido: req.pedido, opcoes: { ...opcoes, editarAntes: req.editarAntes }, etapas: {} },
    };
    this.deps.repos.messages.add({ sessionId: req.sessionId, papel: 'usuario', conteudo: req.pedido });
    const run = this.advance(ctx);
    if (!run) throw new Error('Pipeline has no step to run');
    return run;
  }

  /** Approves a pause. `texto` replaces the step's output (the user's edit). After a failed step it runs without it. */
  continue(runId: string, texto?: string): Run {
    const ctx = this.take(runId);
    const step = ctx.waitingOn!;
    const edited = texto?.trim();
    if (edited) ctx.state.etapas[step.id] = { saida: edited };
    else if (!ctx.state.etapas[step.id]) ctx.state.etapas[step.id] = { ignorada: true };
    this.decide(runId, 'aprovado', edited);
    this.waiting.delete(runId);
    const run = this.advance(ctx, runId);
    if (!run) throw new PipelineError(409, 'nothing_to_run', 'The pipeline has no further step');
    return run;
  }

  /** Runs the waiting step again, with another provider/model (e.g. haiku after the refiner failed). */
  retry(runId: string, via: { provider: string; model?: string }): Run {
    const ctx = this.take(runId);
    const step = ctx.waitingOn!;
    delete ctx.state.etapas[step.id];
    ctx.req = { ...ctx.req, refinador: via };
    this.decide(runId, 'rejeitado', 'nova tentativa');
    this.waiting.delete(runId);
    const run = this.advance(ctx); // the step is back in the plan; its parent is the same as before (none)
    if (!run) throw new PipelineError(409, 'nothing_to_run', 'The pipeline has no further step');
    return run;
  }

  /** Drops the pause: nothing else runs for this request. */
  discard(runId: string): void {
    this.take(runId);
    this.decide(runId, 'rejeitado', 'descartado');
    this.waiting.delete(runId);
  }

  private take(runId: string): Context {
    const approval = this.deps.repos.approvals.byRun(runId);
    if (!approval) throw new PipelineError(404, 'approval_not_found', 'This run is not waiting for a decision');
    if (approval.status !== 'pendente') throw new PipelineError(409, 'already_decided', 'This decision was already made');
    const ctx = this.waiting.get(runId);
    if (!ctx) {
      this.decide(runId, 'rejeitado', 'expirado');
      throw new PipelineError(410, 'expired', 'The server restarted since this step; send the request again');
    }
    return ctx;
  }

  private decide(runId: string, status: 'aprovado' | 'rejeitado', comentario?: string): void {
    const a = this.deps.repos.approvals.byRun(runId);
    if (a) this.deps.repos.approvals.decide(a.id, status, comentario);
  }

  private advance(ctx: Context, parentRunId?: string): Run | undefined {
    const planned = nextStep(ctx.pipeline, ctx.state);
    if (!planned) return undefined;
    const { step, entrada } = planned;
    const agent = step.agente ? this.deps.library.agent(step.agente) : undefined;
    const via = agent
      ? (ctx.req.refinador ?? { provider: agent.provedor, ...(agent.modelo ? { model: agent.modelo } : {}) })
      : ctx.req.executar;
    const systemAppend = agent ? agent.prompt : ctx.req.executar.systemAppend;
    return this.deps.executor.submit({
      sessionId: ctx.req.sessionId,
      texto: entrada,
      provider: via.provider,
      ...(via.model ? { model: via.model } : {}),
      cwd: ctx.req.cwd,
      ...(systemAppend ? { systemAppend } : {}),
      etapa: step.id,
      ...(parentRunId ? { parentRunId } : {}),
      recordUserMessage: false,
      storeAs: agent ? 'agente' : 'assistente',
      after: (outcome) => this.afterStep(ctx, step, outcome),
    });
  }

  private afterStep(ctx: Context, step: PipelineStep, outcome: StepOutcome): void {
    const { repos } = this.deps;
    if (outcome.status === 'ok') {
      ctx.state.etapas[step.id] = { saida: outcome.result };
      const hasMore = nextStep(ctx.pipeline, ctx.state) !== null;
      if (step.revisao && ctx.req.editarAntes && hasMore) {
        repos.approvals.create({ runId: outcome.run.id, motivo: 'Revisar o prompt melhorado antes de executar' });
        this.waiting.set(outcome.run.id, { ...ctx, waitingOn: step });
        return;
      }
      this.advance(ctx, outcome.run.id);
    } else if (outcome.status === 'erro' && step.agente) {
      // The refiner failed (limit reached, CLI missing...). Never switch provider silently: ask.
      repos.approvals.create({
        runId: outcome.run.id,
        motivo: `Falha ao melhorar o prompt: ${outcome.error ?? 'erro desconhecido'}`,
      });
      this.waiting.set(outcome.run.id, { ...ctx, waitingOn: step });
    }
    // 'executar' failing or any cancellation just ends the pipeline; the run shows it.
  }
}

export type { PipelineState };
