import { AgentTag, Button, FadeIn, IconButton, StreamCaret, Switch } from '@owl/ui';
import { ArrowUp, Paperclip, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { StreamState } from '../lib/stream';
import type { Approval, Message, ProviderInfo, RefinerInfo, Run, SummarizeResult } from '../lib/types';
import type { SendInput } from '../lib/api';
import { Markdown } from './Markdown';
import { PendingStrip, Thumbs, useComposerImages, ACCEPTED } from './Attachments';
import { FailureCard, FailureShell, RefinedPromptDone, ReviewCard } from './RefinedPrompt';

interface Props {
  hasSession: boolean;
  messages: Message[];
  stream: StreamState | null;
  providers: ProviderInfo[];
  busy: boolean;
  error: string | null;
  onSend: (input: SendInput) => Promise<void>;
  onCancel: () => void;
  refiner: RefinerInfo | null;
  /** Pauses waiting for the user (a refined prompt to review, or a failed refinement). */
  approvals: Approval[];
  /** Name of the step being streamed (`melhorar` shows a different label than a normal reply). */
  streamStep: string | null;
  onContinue: (runId: string, texto?: string) => void;
  onRetry: (runId: string, via: { provider: string; model?: string }) => void;
  onDiscard: (runId: string) => void;
  /** The CLI that owns the conversation's native session (null while it has none). */
  sessionProvider: string | null;
  /** Writes the summary now (used to hand a conversation over to another provider). */
  onSummarize: () => Promise<SummarizeResult | null>;
  /** Top bar: project / conversation title / ticket chip. Each part is optional and hidden when unknown. */
  projectName?: string | null | undefined;
  title?: string | null | undefined;
  ticket?: { id: string; onOpen?: () => void } | null | undefined;
  /** Runs of the conversation: who wrote each reply (agent step, provider, model). */
  runs?: Run[] | undefined;
  /** The conversation is being fetched: shows the loading state instead of the empty one. */
  loading?: boolean | undefined;
}

const MODELS = ['haiku', 'sonnet', 'opus'];

const selectCls = 'h-6 rounded-md border border-line bg-transparent px-1.5 font-mono text-[11px] text-muted hover:border-line-strong hover:text-fg';

/** Quiet owl (design "Estados": the owl only appears here, still when there is nothing, blinking while loading). */
function Empty({ title, children }: { title: string; children: string }) {
  return (
    <FadeIn className="mx-auto mt-16 flex max-w-[280px] flex-col items-center gap-3.5 text-center">
      <img src="/brand/mark.svg" alt="" width={56} height={56} className="opacity-55 saturate-[.4]" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-[13px] leading-normal text-muted">{children}</p>
    </FadeIn>
  );
}

function Loading() {
  return (
    <div role="status" aria-label="Carregando a conversa" className="flex max-w-[420px] flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <img src="/brand/anim-sync.svg" alt="" width={36} height={36} />
        <span className="text-sm text-muted">Abrindo a conversa…</span>
      </div>
      {['80%', '62%', '71%'].map((w) => (
        <div key={w} className="flex flex-col gap-2 rounded-md bg-panel p-3">
          <span className="block h-2 w-16 rounded-xs bg-raised" />
          <span className="block h-2.5 rounded-xs bg-raised" style={{ width: w }} />
        </div>
      ))}
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[520px] self-end rounded-lg bg-user px-3.5 py-3 text-sm leading-[1.55]">{children}</div>;
}

function AgentMessage({ name, provider, model, running = false, children }: { name?: string | null | undefined; provider?: string | null | undefined; model?: string | null | undefined; running?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex max-w-[660px] flex-col gap-2.5">
      <AgentTag name={name ?? 'agente'} provider={provider} model={model} running={running} showProvider />
      {children}
    </div>
  );
}

export function Chat({ hasSession, messages, stream, providers, busy, error, onSend, onCancel, refiner, approvals, streamStep, onContinue, onRetry, onDiscard, sessionProvider, onSummarize, projectName, title, ticket, runs, loading }: Props) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState('claude-cli');
  const [model, setModel] = useState('');
  const [improve, setImprove] = useState(false);
  const [reviewFirst, setReviewFirst] = useState(false);
  const [refinerIdx, setRefinerIdx] = useState(0);
  /** A message waiting for the user's decision about switching provider. */
  const [switching, setSwitching] = useState<{ input: SendInput; working: boolean; problem: string | null } | null>(null);
  const refinerOptions = refiner ? [{ provedor: refiner.provedor, ...(refiner.modelo ? { modelo: refiner.modelo } : {}) }, ...refiner.fallback] : [];
  const images = useComposerImages();
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = stream !== null && (stream.phase === 'running' || stream.phase === 'connecting');
  const runOf = (id: string | null) => (id ? runs?.find((r) => r.id === id) : undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, stream?.text]);

  // Keep the selection valid: if the chosen CLI is not installed, fall back to the first available one.
  useEffect(() => {
    const ok = providers.find((p) => p.id === provider)?.available;
    const first = providers.find((p) => p.available);
    if (!ok && first) setProvider(first.id);
  }, [providers, provider]);

  // The composer grows with the text (up to 192px), like the design's single-row field.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  const buildInput = (texto: string): SendInput => {
    const chosen = refinerOptions[refinerIdx];
    return {
      texto,
      ...(images.ready.length ? { anexos: images.ready } : {}),
      provider,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(improve
        ? {
            melhorarPrompt: true,
            editarAntes: reviewFirst,
            // Index 0 is the agent's own default; only an explicit alternative is sent as an override.
            ...(refinerIdx > 0 && chosen ? { refinador: { provider: chosen.provedor, ...(chosen.modelo ? { model: chosen.modelo } : {}) } } : {}),
          }
        : {}),
    };
  };
  const reallySend = async (input: SendInput) => {
    setSwitching(null);
    setText('');
    images.clear();
    await onSend(input);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const texto = text.trim();
    if ((!texto && images.ready.length === 0) || images.uploading || busy || streaming || !hasSession || switching) return;
    const input = buildInput(texto);
    // The conversation's native CLI session does not follow a change of provider: say so before it happens.
    if (sessionProvider && provider !== sessionProvider) {
      setSwitching({ input, working: false, problem: null });
      return;
    }
    await reallySend(input);
  };

  const summarizeAndSwitch = async () => {
    if (!switching) return;
    setSwitching({ ...switching, working: true, problem: null });
    const r = await onSummarize();
    // "Nothing new to summarize" is fine: the summary is already up to date.
    if (r === null || r.ok || r.code === 'nothing_to_summarize') return reallySend(switching.input);
    setSwitching({ input: switching.input, working: false, problem: r.error });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  // A failed run offers to send the last message again through another installed provider (goes through the switch notice).
  const lastUser = [...messages].reverse().find((m) => m.papel === 'usuario');
  const failedWith = stream?.provider ?? sessionProvider;
  const alternative = providers.find((p) => p.available && p.id !== failedWith);
  const retryElsewhere = () => {
    if (!lastUser || !alternative || busy) return;
    const input: SendInput = { texto: lastUser.conteudo, provider: alternative.id };
    setProvider(alternative.id);
    if (sessionProvider && alternative.id !== sessionProvider) setSwitching({ input, working: false, problem: null });
    else void reallySend(input);
  };

  const showBar = hasSession && !loading && (projectName || title || ticket);

  return (
    <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col bg-bg">
      {showBar && (
        <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line px-4 md:px-8">
          {projectName && <span className="max-w-[200px] truncate text-muted">{projectName}</span>}
          {projectName && title && (
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
          )}
          {title && <h1 className="truncate text-sm font-semibold">{title}</h1>}
          {ticket &&
            (ticket.onOpen ? (
              <button type="button" onClick={ticket.onOpen} aria-label={`Abrir ticket ${ticket.id}`} className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-fg">
                {ticket.id}
              </button>
            ) : (
              <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{ticket.id}</span>
            ))}
        </div>
      )}
      <div role="log" aria-live="polite" aria-relevant="additions text" className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-7 md:px-10">
        {!hasSession && <Empty title="Nenhuma conversa aberta">Crie ou escolha uma conversa para começar.</Empty>}
        {hasSession && loading && <Loading />}
        {hasSession && !loading && messages.length === 0 && !stream && <Empty title="Conversa vazia">Escreva a primeira mensagem abaixo.</Empty>}
        {messages.map((m) => {
          if (m.papel === 'agente') {
            const pending = approvals.find((a) => a.runId === m.runId);
            return pending ? (
              <ReviewCard
                key={m.id}
                texto={m.conteudo}
                refiner={refiner}
                disabled={busy || streaming}
                onRun={(t) => onContinue(pending.runId, t.trim() === m.conteudo.trim() ? undefined : t)}
                onRetry={(via) => onRetry(pending.runId, via)}
                onDiscard={() => onDiscard(pending.runId)}
              />
            ) : (
              <RefinedPromptDone key={m.id} texto={m.conteudo} />
            );
          }
          if (m.papel === 'sistema') {
            return (
              <p key={m.id} className="text-center font-mono text-[11px] text-muted">
                {m.conteudo}
              </p>
            );
          }
          if (m.papel === 'usuario') {
            return (
              <UserBubble key={m.id}>
                {m.anexos?.length ? <Thumbs anexos={m.anexos} /> : null}
                <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
              </UserBubble>
            );
          }
          return (
            <AgentMessage key={m.id} name={runOf(m.runId)?.etapa} provider={runOf(m.runId)?.provedor ?? sessionProvider} model={runOf(m.runId)?.modelo}>
              <Markdown>{m.conteudo}</Markdown>
            </AgentMessage>
          );
        })}
        {approvals
          .filter((a) => !messages.some((m) => m.papel === 'agente' && m.runId === a.runId))
          .map((a) => (
            <FailureCard
              key={a.id}
              motivo={a.motivo}
              refiner={refiner}
              disabled={busy || streaming}
              onSkip={() => onContinue(a.runId)}
              onRetry={(via) => onRetry(a.runId, via)}
              onDiscard={() => onDiscard(a.runId)}
            />
          ))}
        {stream && (stream.phase !== 'ended' || stream.text) && (
          <AgentMessage name={streamStep} provider={stream.provider ?? sessionProvider} model={stream.model} running={streaming}>
            {stream.text ? (
              <Markdown caret={streaming}>{stream.text}</Markdown>
            ) : streaming ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                {streamStep === 'melhorar' ? 'Melhorando o prompt…' : 'Pensando…'}
                <StreamCaret />
              </p>
            ) : null}
            {stream.phase === 'cancelled' && <p className="text-[13px] text-muted">Execução cancelada.</p>}
          </AgentMessage>
        )}
        {stream?.phase === 'error' && (
          <FailureShell
            label="A run falhou"
            title="A run falhou"
            cause={
              <>
                {stream.provider ? <span className="font-mono text-xs">{stream.provider}</span> : 'O agente'} parou antes de responder.
              </>
            }
            suggestion={alternative && lastUser ? <>Tentar de novo com <span className="font-mono text-xs">{alternative.id}</span>.</> : 'Envie a mensagem de novo.'}
            error={stream.error}
            actions={
              alternative && lastUser ? (
                <Button variant="primary" icon={RotateCcw} disabled={busy} onClick={retryElsewhere}>
                  Tentar com {alternative.id}
                </Button>
              ) : null
            }
          />
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => void submit(e)} onDragOver={(e) => e.preventDefault()} onDrop={images.onDrop} className="px-4 pb-5 pt-4 md:px-10">
        {error && (
          <p role="alert" className="mb-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        {images.notice && <p className="mb-2 text-[13px] text-muted">{images.notice}</p>}
        {switching && (
          <section role="alertdialog" aria-label="Troca de provedor" className="mb-2 rounded-lg border border-accent bg-panel p-3.5 text-[13px] leading-normal">
            <p className="font-semibold">
              Trocar de <span className="font-mono text-xs">{sessionProvider}</span> para <span className="font-mono text-xs">{switching.input.provider}</span>?
            </p>
            <p className="mt-1">
              A sessão nativa do {sessionProvider} (o contexto interno da CLI: resultados de ferramentas, cache) <strong>não acompanha</strong> a troca, então
              o {switching.input.provider} começa do zero. O OWL envia a ele os fatos fixados, o resumo da conversa e as últimas mensagens.
            </p>
            <p className="mt-1 text-muted">&quot;Resumir e trocar&quot; deixa esse resumo em dia antes. Sem resumir, vale o resumo que já existe (ou nenhum).</p>
            {switching.problem && (
              <p role="alert" className="mt-1 text-danger">
                Não consegui resumir: {switching.problem}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" disabled={switching.working} onClick={() => void summarizeAndSwitch()}>
                {switching.working ? 'Resumindo…' : 'Resumir e trocar'}
              </Button>
              <Button disabled={switching.working} onClick={() => void reallySend(switching.input)}>
                {switching.problem ? 'Trocar mesmo assim' : 'Trocar sem resumir'}
              </Button>
              <span className="flex-1" />
              <Button variant="ghost" disabled={switching.working} onClick={() => setSwitching(null)}>
                Cancelar
              </Button>
            </div>
          </section>
        )}
        <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-panel px-3 pb-2.5 pt-3 focus-within:border-line-strong">
          <PendingStrip items={images.items} onRemove={images.remove} />
          <label className="sr-only" htmlFor="owl-composer">
            Mensagem
          </label>
          <textarea
            id="owl-composer"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={images.onPaste}
            disabled={!hasSession || switching !== null}
            rows={1}
            placeholder="Responder ao agente…"
            title="Enter envia · Shift+Enter quebra a linha"
            className="max-h-48 min-h-[22px] resize-none border-0 bg-transparent p-0 text-sm leading-normal outline-none focus-visible:outline-none disabled:opacity-50"
          />
          {improve && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              <Switch checked={reviewFirst} onChange={setReviewFirst} label="Editar antes de executar" />
              {refinerOptions.length > 1 && (
                <label className="flex items-center gap-1.5 text-muted">
                  Refinador
                  <select aria-label="Refinador" value={refinerIdx} onChange={(e) => setRefinerIdx(Number(e.target.value))} className={selectCls}>
                    {refinerOptions.map((o, i) => (
                      <option key={i} value={i}>
                        {o.modelo ?? o.provedor}
                        {i === 0 ? ' (padrão)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} multiple hidden aria-label="Escolher imagens" onChange={(e) => { images.add(e.target.files ?? []); e.target.value = ''; }} />
            <IconButton icon={Paperclip} label="Anexar imagem" size={32} disabled={!hasSession} onClick={() => fileInput.current?.click()} />
            <button
              type="button"
              aria-label="Refinar prompt"
              aria-pressed={improve}
              onClick={() => setImprove((v) => !v)}
              className={`flex h-6 items-center rounded-md border px-2 text-xs transition-colors ${improve ? 'border-line-strong bg-raised text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg'}`}
            >
              Refinar prompt
            </button>
            <select aria-label="Provedor" value={provider} onChange={(e) => setProvider(e.target.value)} className={selectCls}>
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.id}
                  {p.available ? '' : ' (indisponível)'}
                </option>
              ))}
            </select>
            <input list="owl-models" aria-label="Modelo" value={model} onChange={(e) => setModel(e.target.value)} placeholder="modelo" className={`${selectCls} w-24 placeholder:text-faint`} />
            <datalist id="owl-models">
              {MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <span className="flex-1" />
            <span aria-hidden="true" className="font-mono text-[11px] text-muted">
              ⌘↵
            </span>
            {streaming ? (
              <IconButton icon={Square} label="Parar execução" size={32} onClick={onCancel} />
            ) : (
              <button
                type="submit"
                aria-label="Enviar"
                title="Enviar"
                disabled={!hasSession || busy || images.uploading || (!text.trim() && images.ready.length === 0)}
                className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg transition-[background-color,transform] hover:bg-accent-hover active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
