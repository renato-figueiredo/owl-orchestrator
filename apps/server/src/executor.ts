import { getAdapter, type ProviderAdapter, type RunEvent } from '@owl/core';
import type { createRepos, Run, RunStatus } from '@owl/db';

type Repos = ReturnType<typeof createRepos>;

/** What a step produced, handed to `SubmitInput.after` once it is stored. */
export interface StepOutcome {
  run: Run;
  status: Exclude<RunStatus, 'rodando'>;
  /** The reply as stored (last message for Codex, full text for Claude). */
  result: string;
  error?: string;
}

/** Supplies the memory block for a run (see `MemoryService`). */
export interface MemoryProvider {
  /** Text placed before the request, or undefined. `resume`: the CLI continues its own session, so only news go in. */
  contextFor(input: { sessionId: string; runId: string; texto: string; beforeMessageId: number | undefined; resume: boolean }): string | undefined;
}

/** Gives a run access to the memory tools (MCP server), see `MemoryService.mcpFor`. */
export interface McpProvider {
  /** Config file and tool permissions for this run, or undefined when it gets no memory tools. */
  mcpFor(input: { sessionId: string; runId: string; provider: string; stateless: boolean; noTools: boolean }):
    | { configPath: string; allowedTools: string[]; done(): void }
    | undefined;
}

/** Turns attachments into what the model gets (see `AttachmentService`). */
export interface AttachmentProvider {
  prepare(refs: Array<{ hash: string; nome?: string | undefined }>): { images: string[]; note: string };
  afterRun(outcome: { status: string; input: SubmitInput }): void;
}

export interface SubmitInput {
  sessionId: string;
  texto: string;
  provider: string;
  model?: string;
  cwd: string;
  systemAppend?: string;
  /**
   * Do not read or write the session's CLI session id. For steps of other agents (the prompt refiner): the session slot
   * belongs to the conversation, and a refiner run must neither resume it nor overwrite it.
   */
  stateless?: boolean;
  /** Images attached to the request: stored with the user message (when recorded) and sent to the model. */
  anexos?: Array<{ hash: string; nome?: string | undefined }>;
  /** Image files to hand to the CLI as they are (the describer). Attachments are turned into this automatically. */
  images?: string[];
  /** Run with no tools at all (the summarizer reads untrusted text and needs none). */
  noTools?: boolean;
  /** Tools pre-approved for this run (agent `ferramentas`); empty or absent leaves the adapter's default. */
  allowedTools?: string[];
  /** Library agent this run executes (`agents.id`), stored in `runs.agent_id`. */
  agentId?: string;
  /** Board ticket this run works on (`runs.ticket_id`), so its tokens and cost add up on the ticket. */
  ticketId?: string;
  /** Pipeline step name, stored in `runs.etapa`. */
  etapa?: string;
  /** What the router decided for this run (prompt 15): stored in `runs.complexidade`, `runs.tier`, `runs.roteamento_json`. */
  routing?: { complexidade: string; tier: string; detalhe: Record<string, unknown> };
  /** The run whose output feeds this one (`runs.parent_run_id`). */
  parentRunId?: string;
  /** Store `texto` as the user's message (default). Pipeline steps pass false: the request was stored once, at the start. */
  recordUserMessage?: boolean;
  /**
   * Role of the stored reply: `assistente` (default), `agente` for intermediate output such as a refined prompt, or
   * `false` to store nothing (the caller reads the result from `after`, e.g. the summarizer).
   */
  storeAs?: 'assistente' | 'agente' | false;
  /**
   * Messages with an id below this are the history; this and later ones belong to the current request and are kept
   * out of the memory block. Set automatically for a recorded user message; pipeline steps pass it explicitly.
   */
  contextBeforeMessageId?: number;
  /**
   * Runs after the run is stored and BEFORE its terminal event reaches clients, so a follow-up run created here
   * already exists when the client sees the first one end. It must not throw: failures are recorded in the session.
   */
  after?: (outcome: StepOutcome) => void;
}

export interface ExecutorOptions {
  repos: Repos;
  /** Maximum runs executing at once. */
  concurrency?: number;
  /** Maximum runs of one project executing at once when the project sets no limit of its own (default: no extra limit). */
  projectConcurrency?: number;
  /** Adapter lookup (defaults to the core registry); tests inject fakes here. */
  resolveAdapter?: (id: string) => ProviderAdapter;
  /** Finished runs whose events stay replayable from memory. */
  keepFinished?: number;
  memory?: MemoryProvider;
  mcp?: McpProvider;
  attachments?: AttachmentProvider;
  /** Called for every finished run, after it is stored and before its terminal event is announced. Must not throw. */
  afterRun?: (outcome: StepOutcome & { input: SubmitInput }) => void;
}

type Listener = (event: RunEvent) => void;

interface Entry {
  run: Run;
  input: SubmitInput;
  events: RunEvent[];
  listeners: Set<Listener>;
  controller: AbortController;
  state: 'queued' | 'running' | 'done';
  /** Project of the run's conversation, or null for a chat with no project (only the global limit applies). */
  projectId: string | null;
}

const TERMINAL = new Set(['end', 'error', 'cancelled']);

/**
 * Simple executor: one user message → one run. Runs wait in a FIFO queue; at most `concurrency` execute
 * at once and never two of the same session (they share the CLI's native session, so `--resume` needs order).
 */
export class Executor {
  private readonly repos: Repos;
  private readonly concurrency: number;
  private readonly projectConcurrency: number;
  private readonly resolveAdapter: (id: string) => ProviderAdapter;
  private readonly keepFinished: number;
  private memory: MemoryProvider | undefined;
  private mcp: McpProvider | undefined;
  private attachments: AttachmentProvider | undefined;
  private afterRun: ExecutorOptions['afterRun'];
  private readonly entries = new Map<string, Entry>();
  private readonly queue: Entry[] = [];
  private readonly activeSessions = new Set<string>();
  private readonly activeByProject = new Map<string, number>();
  private active = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(opts: ExecutorOptions) {
    this.repos = opts.repos;
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    this.projectConcurrency = Math.max(1, opts.projectConcurrency ?? this.concurrency);
    this.resolveAdapter = opts.resolveAdapter ?? getAdapter;
    this.keepFinished = opts.keepFinished ?? 200;
    this.memory = opts.memory;
    this.mcp = opts.mcp;
    this.attachments = opts.attachments;
    this.afterRun = opts.afterRun;
  }

  /** Wires memory and the per-run hook after construction (the memory service needs the executor itself). */
  attach(parts: { memory?: MemoryProvider; mcp?: McpProvider; attachments?: AttachmentProvider; afterRun?: ExecutorOptions['afterRun'] }): void {
    if (parts.memory) this.memory = parts.memory;
    if (parts.mcp) this.mcp = parts.mcp;
    if (parts.attachments) this.attachments = parts.attachments;
    if (parts.afterRun) this.afterRun = parts.afterRun;
  }

  /** Stores the user message, creates the run and queues it. */
  submit(input: SubmitInput): Run {
    const { repos } = this;
    if (input.recordUserMessage !== false) {
      const message = repos.messages.add({ sessionId: input.sessionId, papel: 'usuario', conteudo: input.texto });
      input = { ...input, contextBeforeMessageId: input.contextBeforeMessageId ?? message.id };
      for (const a of input.anexos ?? []) repos.attachments.add({ messageId: message.id, blobHash: a.hash, ...(a.nome ? { nomeOriginal: a.nome } : {}) });
    }
    const run = repos.runs.start({
      provedor: input.provider,
      sessionId: input.sessionId,
      ...(input.model ? { modelo: input.model } : {}),
      ...(input.etapa ? { etapa: input.etapa } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.ticketId ? { ticketId: input.ticketId } : {}),
      ...(input.stateless ? { semEstado: true } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.routing ? { complexidade: input.routing.complexidade, tier: input.routing.tier, roteamento: input.routing.detalhe } : {}),
    });
    const entry: Entry = {
      run,
      input,
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
      state: 'queued',
      projectId: repos.sessions.get(input.sessionId)?.projectId ?? null,
    };
    this.entries.set(run.id, entry);
    this.queue.push(entry);
    this.pump();
    return run;
  }

  /** Replays the events so far and then follows live ones. Undefined when the run is not in memory. */
  subscribe(runId: string, listener: Listener): { history: RunEvent[]; done: boolean; unsubscribe(): void } | undefined {
    const entry = this.entries.get(runId);
    if (!entry) return undefined;
    const history = [...entry.events];
    const done = entry.state === 'done';
    if (!done) entry.listeners.add(listener);
    return { history, done, unsubscribe: () => entry.listeners.delete(listener) };
  }

  /** `cancelled` = stop requested, `finished` = nothing to cancel, `not_found` = unknown run. */
  cancel(runId: string): 'cancelled' | 'finished' | 'not_found' {
    const entry = this.entries.get(runId);
    if (!entry) return this.repos.runs.get(runId) ? 'finished' : 'not_found';
    if (entry.state === 'done') return 'finished';
    if (entry.state === 'queued') {
      this.queue.splice(this.queue.indexOf(entry), 1);
      this.repos.runs.finish(entry.run.id, { status: 'cancelado' });
      this.runAfter(entry, 'cancelado', '', undefined); // callers waiting on this run (e.g. a summary) must hear about it
      this.emit(entry, { type: 'cancelled' });
      this.settle(entry);
      return 'cancelled';
    }
    entry.controller.abort();
    return 'cancelled';
  }

  /** True while a run of this session is queued or executing. */
  hasActive(sessionId: string): boolean {
    for (const e of this.entries.values()) if (e.state !== 'done' && e.input.sessionId === sessionId) return true;
    return false;
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Cancels everything (server shutdown) and waits for the processes to exit. */
  async shutdown(): Promise<void> {
    for (const entry of [...this.queue]) this.cancel(entry.run.id);
    for (const entry of this.entries.values()) if (entry.state === 'running') entry.controller.abort();
    await this.idle();
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const entry = this.queue.find((e) => !this.activeSessions.has(e.input.sessionId) && this.projectHasRoom(e));
      if (!entry) break;
      this.queue.splice(this.queue.indexOf(entry), 1);
      this.active++;
      this.activeSessions.add(entry.input.sessionId);
      if (entry.projectId) this.activeByProject.set(entry.projectId, (this.activeByProject.get(entry.projectId) ?? 0) + 1);
      entry.state = 'running';
      void this.execute(entry).finally(() => {
        this.active--;
        this.activeSessions.delete(entry.input.sessionId);
        if (entry.projectId) this.activeByProject.set(entry.projectId, Math.max(0, (this.activeByProject.get(entry.projectId) ?? 1) - 1));
        this.pump();
        if (this.active === 0 && this.queue.length === 0) {
          for (const resolve of this.idleWaiters.splice(0)) resolve();
        }
      });
    }
  }

  /** The project's own limit (read now, so a change applies to the next run) or the server default. */
  private projectHasRoom(e: Entry): boolean {
    if (!e.projectId) return true;
    const limit = this.repos.projects.get(e.projectId)?.maxConcorrencia ?? this.projectConcurrency;
    return (this.activeByProject.get(e.projectId) ?? 0) < limit;
  }

  private async execute(entry: Entry): Promise<void> {
    const { repos } = this;
    const { run, input } = entry;
    let text = '';
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let cost: number | undefined;
    let terminal: RunEvent | undefined;
    const memoryCalls: Record<string, number> = {};
    let mcp: ReturnType<McpProvider['mcpFor']>;

    try {
      const adapter = this.resolveAdapter(input.provider);
      // Read now, not at submit time: a queued run must see the session id the previous run just stored.
      const session = repos.sessions.get(input.sessionId);
      const resume = !input.stateless && session?.cliProvider === input.provider ? session.cliSessionId : null;
      // Without a native session to resume the CLI knows nothing: give it the memory block. With one, only the news.
      const memory = input.stateless ? undefined : this.memory?.contextFor({
        sessionId: input.sessionId,
        runId: run.id,
        texto: input.texto,
        beforeMessageId: input.contextBeforeMessageId,
        resume: Boolean(resume),
      });
      // Images already described go as text; new ones as files (and get described after the run).
      const att = input.anexos?.length ? this.attachments?.prepare(input.anexos) : undefined;
      const images = [...(input.images ?? []), ...(att?.images ?? [])];
      mcp = this.mcp?.mcpFor({ sessionId: input.sessionId, runId: run.id, provider: input.provider, stateless: Boolean(input.stateless), noTools: Boolean(input.noTools) });
      const allowedTools = [...(input.allowedTools ?? []), ...(mcp?.allowedTools ?? [])];
      const stream = adapter.run(
        {
          prompt: `${memory ?? ''}${att?.note ?? ''}${input.texto}`,
          cwd: input.cwd,
          runId: run.id,
          ...(input.model ? { model: input.model } : {}),
          ...(input.systemAppend ? { systemAppend: input.systemAppend } : {}),
          ...(resume ? { resumeSessionId: resume } : {}),
          ...(allowedTools.length ? { allowedTools } : {}),
          ...(mcp ? { mcpConfigPath: mcp.configPath } : {}),
          ...(input.noTools ? { noTools: true } : {}),
          ...(images.length ? { images } : {}),
        },
        entry.controller.signal,
      );
      for await (const event of stream) {
        if (event.type === 'text') text += event.delta;
        if (event.type === 'tool') {
          const m = /^mcp__owl-memory__(\w+)$/.exec(event.name);
          if (m?.[1]) memoryCalls[m[1]] = (memoryCalls[m[1]] ?? 0) + 1;
        }
        if (event.type === 'usage') {
          tokensIn = (tokensIn ?? 0) + (event.inputTokens ?? 0);
          tokensOut = (tokensOut ?? 0) + (event.outputTokens ?? 0);
          if (event.costUsd !== undefined) cost = (cost ?? 0) + event.costUsd;
        }
        if (terminal) continue; // contract: nothing after the terminal event
        if (TERMINAL.has(event.type)) terminal = event; // emitted only after it is persisted (below)
        else this.emit(entry, event);
      }
    } catch (err) {
      terminal ??= { type: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    terminal ??= { type: 'error', message: 'Provider ended without a result' };
    mcp?.done();

    let status: Exclude<RunStatus, 'rodando'>;
    let erro: string | undefined;
    let result = '';
    if (terminal.type === 'end') {
      status = 'ok';
      result = terminal.result ?? text;
      // An empty reply is not a message: nothing to show, and a pipeline treats it as a failed step.
      if (result.trim() && input.storeAs !== false) {
        repos.messages.add({
          sessionId: input.sessionId,
          runId: run.id,
          papel: input.storeAs ?? 'assistente',
          conteudo: result,
        });
      }
      if (terminal.cliSessionId && !input.stateless) repos.sessions.setCliSession(input.sessionId, input.provider, terminal.cliSessionId);
    } else if (terminal.type === 'cancelled') {
      status = 'cancelado';
    } else {
      status = 'erro';
      erro = terminal.type === 'error' ? terminal.message : undefined;
    }
    repos.runs.finish(run.id, {
      status,
      ...(tokensIn !== undefined ? { tokensIn } : {}),
      ...(tokensOut !== undefined ? { tokensOut } : {}),
      ...(cost !== undefined ? { custoEstimado: cost } : {}),
      ...(erro !== undefined ? { erro } : {}),
    });
    if (Object.keys(memoryCalls).length) repos.runs.setMemoryCalls(run.id, memoryCalls);
    this.runAfter(entry, status, result, erro);
    // Persist first, announce after: a client that reacts to the terminal event must find the final state.
    this.emit(entry, terminal);
    this.settle(entry);
  }

  private runAfter(entry: Entry, status: Exclude<RunStatus, 'rodando'>, result: string, erro: string | undefined): void {
    const { after } = entry.input;
    if (!after && !this.afterRun && !this.attachments) return;
    try {
      const outcome: StepOutcome = { run: this.repos.runs.get(entry.run.id)!, status, result, ...(erro !== undefined ? { error: erro } : {}) };
      after?.(outcome);
      this.attachments?.afterRun({ status, input: entry.input });
      this.afterRun?.({ ...outcome, input: entry.input });
    } catch (err) {
      this.repos.messages.add({
        sessionId: entry.input.sessionId,
        runId: entry.run.id,
        papel: 'sistema',
        conteudo: `Falha ao encadear a próxima etapa: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private emit(entry: Entry, event: RunEvent): void {
    entry.events.push(event);
    for (const listener of entry.listeners) listener(event);
  }

  /** Marks the run done, wakes subscribers and trims the oldest finished runs. */
  private settle(entry: Entry): void {
    entry.state = 'done';
    entry.listeners.clear();
    const finished = [...this.entries.values()].filter((e) => e.state === 'done');
    for (const old of finished.slice(0, Math.max(0, finished.length - this.keepFinished))) {
      this.entries.delete(old.run.id);
    }
  }
}
