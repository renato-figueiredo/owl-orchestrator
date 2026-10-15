import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSummaryPrompt,
  montarContexto,
  parseSummaryOutput,
  renderSummary,
  SUMMARY_SYSTEM,
  type ContextMessage,
} from '@owl/core';
import type { createRepos, Message, Session } from '@owl/db';
import { z } from 'zod';
import type { Executor, MemoryProvider, StepOutcome } from './executor.js';

type Repos = ReturnType<typeof createRepos>;

const modelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/);

const fields = {
  /** How many of the latest messages go into the memory block. */
  ultimasN: z.number().int().min(0).max(50),
  /** Summarize after this many new messages. */
  resumirACada: z.number().int().min(2).max(200),
  /** Ceiling of the memory block, in estimated tokens. */
  orcamentoTokens: z.number().int().min(200).max(50_000),
  /** Update the summary on its own after `resumirACada` messages. Off: only when you ask. */
  resumoAutomatico: z.boolean(),
  /** Add related snippets from earlier messages (full-text search) when the request matches them. */
  trechosFts: z.boolean(),
  /** Who writes the summaries. */
  resumidor: z.object({ provider: z.string().min(1).max(64), model: modelId.optional() }),
};
export const memorySettingsSchema = z.object(fields);
/** A partial update: only the given fields change (no defaults are applied to the missing ones). */
export const memorySettingsPatchSchema = memorySettingsSchema.partial();

/** Haiku by default for the summarizer: it runs often and must not eat a low Codex limit. */
export const DEFAULT_MEMORY_SETTINGS: z.infer<typeof memorySettingsSchema> = {
  ultimasN: 8,
  resumirACada: 10,
  orcamentoTokens: 4000,
  resumoAutomatico: true,
  trechosFts: true,
  resumidor: { provider: 'claude-cli', model: 'haiku' },
};
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

const SETTINGS_KEY = 'memory';
/** At most this many characters of new messages go into one summarizer call. */
const SUMMARY_INPUT_CHARS = 60_000;
const SNIPPET_CHARS = 400;

const chat = (m: Message): m is Message & { papel: 'usuario' | 'assistente' } => m.papel === 'usuario' || m.papel === 'assistente';
const toContext = (m: Message & { papel: 'usuario' | 'assistente' }): ContextMessage => ({ papel: m.papel, conteudo: m.conteudo });

export type SummarizeResult =
  | { ok: true; runId: string; resumo: string; fatosNovos: number }
  | { ok: false; runId?: string; error: string; code: 'nothing_to_summarize' | 'invalid_output' | 'run_failed' };

export class MemoryService implements MemoryProvider {
  private readonly summarizing = new Set<string>();
  /** Sessions whose last summary attempt failed: how many chat messages were pending then. See `maybeSummarize`. */
  private readonly failedAt = new Map<string, number>();
  private scratch: string | undefined;

  constructor(
    private readonly deps: { repos: Repos; executor: Executor },
  ) {
    deps.executor.attach({
      memory: this,
      afterRun: (o) => this.maybeSummarize(o),
    });
  }

  // ---- settings -----------------------------------------------------------------------------------------------

  settings(): MemorySettings {
    const stored = this.deps.repos.settings.get(SETTINGS_KEY);
    const base = typeof stored === 'object' && stored !== null ? (stored as object) : {};
    // A stored value that no longer validates falls back to the defaults instead of breaking every run.
    const parsed = memorySettingsSchema.safeParse({ ...DEFAULT_MEMORY_SETTINGS, ...base });
    return parsed.success ? parsed.data : DEFAULT_MEMORY_SETTINGS;
  }

  save(patch: z.infer<typeof memorySettingsPatchSchema>): MemorySettings {
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = memorySettingsSchema.parse({ ...this.settings(), ...given });
    this.deps.repos.settings.set(SETTINGS_KEY, next);
    return next;
  }

  // ---- the memory block ---------------------------------------------------------------------------------------

  /** Facts live in the project; a conversation with no project keeps them for itself (no project, no sharing). */
  private scope(session: Session) {
    return { projectId: session.projectId };
  }

  contextFor(i: { sessionId: string; runId: string; texto: string; beforeMessageId: number | undefined; resume: boolean }): string | undefined {
    const { repos } = this.deps;
    const session = repos.sessions.get(i.sessionId);
    if (!session) return undefined;
    const cfg = this.settings();

    if (i.resume) {
      // The CLI still has the conversation. Only tell it about pinned facts created since its previous run.
      const since = repos.runs.previousStart(i.sessionId, i.runId);
      if (!since) return undefined;
      const news = repos.facts.listScope({ ...this.scope(session), apenasFixados: true, desde: since });
      if (news.length === 0) return undefined;
      const lines = news.map((f) => `- ${f.texto}`).join('\n');
      return `[Novos fatos fixados desde a sua última resposta]\n${lines}\n\n`;
    }

    const history = repos.messages
      .list(i.sessionId)
      .filter((m) => chat(m) && (i.beforeMessageId === undefined || m.id < i.beforeMessageId));
    const recent = cfg.ultimasN > 0 ? history.slice(-cfg.ultimasN) : [];
    const facts = repos.facts.listScope({ ...this.scope(session), apenasFixados: true }).map((f) => f.texto);
    const trechos = cfg.trechosFts ? this.snippets(session, i.texto, new Set(recent.map((m) => m.id)), i.beforeMessageId) : [];

    const out = montarContexto(
      { fatos: facts, resumo: session.resumo, mensagens: history.filter(chat).map(toContext), trechos },
      { orcamentoTokens: cfg.orcamentoTokens, ultimasN: cfg.ultimasN },
    );
    return out.texto || undefined;
  }

  /**
   * Related older messages, only when the request really matches them: the search finds messages with ANY of the
   * request's longest words, and a message is kept only if at least TWO distinct ones occur in it (a single shared word
   * is coincidence). A request with fewer than two such words adds nothing.
   */
  private snippets(session: Session, texto: string, alreadyShown: Set<number>, before: number | undefined): string[] {
    const words = [...new Set(texto.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) ?? [])]
      .sort((a, b) => b.length - a.length)
      .slice(0, 6);
    if (words.length < 2) return [];
    const scope = session.projectId ? { projectId: session.projectId } : { sessionId: session.id };
    return this.deps.repos
      .searchMessages(words.join(' '), scope, 20, 'qualquer')
      .filter((h) => chat(h) && !alreadyShown.has(h.id) && (before === undefined || h.sessionId !== session.id || h.id < before))
      .filter((h) => words.filter((w) => h.conteudo.toLowerCase().includes(w)).length >= 2)
      .slice(0, 3)
      .map((h) => `${h.papel === 'usuario' ? 'Usuário' : 'Assistente'}: ${h.conteudo.slice(0, SNIPPET_CHARS)}${h.conteudo.length > SNIPPET_CHARS ? '…' : ''}`);
  }

  // ---- summaries ----------------------------------------------------------------------------------------------

  /** Messages the summary does not cover yet (chat roles only), oldest first. */
  private pending(session: Session): Array<Message & { papel: 'usuario' | 'assistente' }> {
    return this.deps.repos.messages.list(session.id, { afterId: session.resumoAteMessageId ?? 0 }).filter(chat);
  }

  /** Summarizes on its own once enough new messages piled up. Never throws, never blocks the run that triggered it. */
  maybeSummarize(o: StepOutcome & { input: { sessionId: string; stateless?: boolean; etapa?: string } }): void {
    if (o.status !== 'ok' || o.input.stateless || o.input.etapa === 'resumo') return;
    const cfg = this.settings();
    if (!cfg.resumoAutomatico) return;
    const session = this.deps.repos.sessions.get(o.input.sessionId);
    if (!session || session.deletedAt || this.summarizing.has(session.id)) return;
    const pending = this.pending(session).length;
    if (pending < cfg.resumirACada) return;
    // Backoff: after a failed attempt (invalid JSON, CLI error) wait for another full batch of new messages. Each try
    // is a paid call, and retrying on every run would repeat the same failure.
    const failedWith = this.failedAt.get(session.id);
    if (failedWith !== undefined && pending < failedWith + cfg.resumirACada) return;
    void this.summarize(session.id, { auto: true }).catch(() => undefined);
  }

  /** Runs the summarizer now. Resolves when it finished; on any failure the existing summary stays as it was. */
  summarize(sessionId: string, opts: { auto?: boolean } = {}): Promise<SummarizeResult> {
    const { repos, executor } = this.deps;
    const session = repos.sessions.get(sessionId);
    if (!session) return Promise.resolve({ ok: false, error: 'Session not found', code: 'run_failed' });
    if (this.summarizing.has(sessionId)) return Promise.resolve({ ok: false, error: 'A summary is already being written', code: 'run_failed' });

    // Only the messages after the marker, capped so one call cannot grow without bound.
    const batch: Array<Message & { papel: 'usuario' | 'assistente' }> = [];
    let chars = 0;
    for (const m of this.pending(session)) {
      if (batch.length > 0 && chars + m.conteudo.length > SUMMARY_INPUT_CHARS) break;
      batch.push(m);
      chars += m.conteudo.length;
    }
    if (batch.length === 0) return Promise.resolve({ ok: false, error: 'Nothing new to summarize', code: 'nothing_to_summarize' });
    const upTo = batch[batch.length - 1]!.id;
    const pendingNow = this.pending(session).length;
    const cfg = this.settings();

    this.summarizing.add(sessionId);
    return new Promise<SummarizeResult>((resolve) => {
      const finish = (r: SummarizeResult) => {
        this.summarizing.delete(sessionId);
        if (r.ok) this.failedAt.delete(sessionId);
        else this.failedAt.set(sessionId, pendingNow);
        resolve(r);
      };
      try {
        executor.submit({
          sessionId,
          texto: buildSummaryPrompt({ resumoAnterior: session.resumo, mensagens: batch.map(toContext) }),
          provider: cfg.resumidor.provider,
          ...(cfg.resumidor.model ? { model: cfg.resumidor.model } : {}),
          cwd: this.scratchDir(),
          systemAppend: SUMMARY_SYSTEM,
          etapa: 'resumo',
          recordUserMessage: false,
          storeAs: false,
          stateless: true,
          noTools: true,
          after: (outcome) => finish(this.apply(sessionId, upTo, outcome, opts.auto === true)),
        });
      } catch (e) {
        finish({ ok: false, error: e instanceof Error ? e.message : String(e), code: 'run_failed' });
      }
    });
  }

  private apply(sessionId: string, upTo: number, o: StepOutcome, auto: boolean): SummarizeResult {
    const { repos } = this.deps;
    // The session may have changed (project, deletion) while the summarizer ran: use its current state.
    const session = repos.sessions.get(sessionId);
    if (!session) return { ok: false, runId: o.run.id, error: 'Session not found', code: 'run_failed' };
    if (o.status !== 'ok') {
      return { ok: false, runId: o.run.id, error: o.error ?? 'The summarizer did not finish', code: 'run_failed' };
    }
    const out = parseSummaryOutput(o.result);
    if (!out) {
      // An automatic attempt fails silently (it would otherwise litter the conversation); the user who asked sees it.
      if (!auto) {
        repos.messages.add({
          sessionId: session.id,
          runId: o.run.id,
          papel: 'sistema',
          conteudo: 'Não consegui atualizar o resumo: a resposta do resumidor não era válida. O resumo anterior foi mantido.',
        });
      }
      return { ok: false, runId: o.run.id, error: 'The summarizer answered with invalid JSON; the previous summary was kept', code: 'invalid_output' };
    }
    const resumo = renderSummary(out);
    repos.sessions.setSummary(session.id, resumo, upTo);

    // Decisions become facts (not pinned: the user decides which ones to keep sending). Never duplicate one.
    const scope = { projectId: session.projectId };
    const known = new Set(repos.facts.listScope(scope).map((f) => f.texto.trim().toLowerCase()));
    let added = 0;
    for (const texto of out.fatos_novos) {
      if (known.has(texto.toLowerCase())) continue;
      repos.facts.add({ texto, ...(session.projectId ? { projectId: session.projectId } : {}), origemRunId: o.run.id });
      known.add(texto.toLowerCase());
      added++;
    }
    return { ok: true, runId: o.run.id, resumo, fatosNovos: added };
  }

  private scratchDir(): string {
    // The summarizer needs no files. An empty folder, private and unpredictable, keeps it away from any project.
    this.scratch ??= mkdtempSync(join(tmpdir(), 'owl-summarizer-'));
    return this.scratch;
  }
}
