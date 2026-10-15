import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { StreamState } from '../lib/stream';
import type { Approval, Message, ProviderInfo, RefinerInfo, SummarizeResult } from '../lib/types';
import type { SendInput } from '../lib/api';
import { FadeIn, StreamCaret } from '@owl/ui';
import { Logo } from './Logo';
import { Markdown } from './Markdown';
import { PendingStrip, Thumbs, useComposerImages, ACCEPTED } from './Attachments';
import { FailureCard, RefinedPromptDone, ReviewCard } from './RefinedPrompt';

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
}

const MODELS = ['haiku', 'sonnet', 'opus'];

function Bubble({ papel, children }: { papel: Message['papel']; children: React.ReactNode }) {
  const mine = papel === 'usuario';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-user' : 'border border-line bg-panel'}`}>{children}</div>
    </div>
  );
}

export function Chat({ hasSession, messages, stream, providers, busy, error, onSend, onCancel, refiner, approvals, streamStep, onContinue, onRetry, onDiscard, sessionProvider, onSummarize }: Props) {
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
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = stream !== null && (stream.phase === 'running' || stream.phase === 'connecting');

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, stream?.text]);

  // Keep the selection valid: if the chosen CLI is not installed, fall back to the first available one.
  useEffect(() => {
    const ok = providers.find((p) => p.id === provider)?.available;
    const first = providers.find((p) => p.available);
    if (!ok && first) setProvider(first.id);
  }, [providers, provider]);

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

  return (
    <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
      <div role="log" aria-live="polite" aria-relevant="additions text" className="flex-1 space-y-4 overflow-y-auto p-4">
        {!hasSession && (
          <FadeIn className="mt-24 flex flex-col items-center gap-3 text-muted">
            <Logo size={56} blink />
            <p>Crie ou escolha uma conversa para começar.</p>
          </FadeIn>
        )}
        {hasSession && messages.length === 0 && !stream && (
          <FadeIn className="mt-24 flex flex-col items-center gap-3 text-muted">
            <Logo size={56} blink />
            <p>Escreva a primeira mensagem abaixo.</p>
          </FadeIn>
        )}
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
              <p key={m.id} className="text-center text-xs text-muted">
                {m.conteudo}
              </p>
            );
          }
          return (
            <Bubble key={m.id} papel={m.papel}>
              {m.anexos?.length ? <Thumbs anexos={m.anexos} /> : null}
              {m.papel === 'usuario' ? <p className="whitespace-pre-wrap break-words">{m.conteudo}</p> : <Markdown>{m.conteudo}</Markdown>}
            </Bubble>
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
          <Bubble papel="assistente">
            {stream.text ? (
              <div className={streaming ? 'owl-caret' : undefined}>
                <Markdown>{stream.text}</Markdown>
              </div>
            ) : streaming ? (
              <span className="flex items-center gap-2 text-muted">
                <Logo size={20} blink /> {streamStep === 'melhorar' ? 'Melhorando o prompt…' : 'Pensando…'}<StreamCaret />
              </span>
            ) : null}
            {stream.phase === 'cancelled' && <p className="mt-2 text-sm text-muted">Execução cancelada.</p>}
            {stream.phase === 'error' && (
              <p role="alert" className="mt-2 text-sm text-danger">
                Erro: {stream.error}
              </p>
            )}
          </Bubble>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => void submit(e)} onDragOver={(e) => e.preventDefault()} onDrop={images.onDrop} className="border-t border-line bg-panel p-3">
        {error && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
        )}
        {images.notice && <p className="mb-2 text-sm text-muted">{images.notice}</p>}
        <PendingStrip items={images.items} onRemove={images.remove} />
        {switching && (
          <section role="alertdialog" aria-label="Troca de provedor" className="mb-2 rounded-lg border border-accent bg-raised p-3 text-sm">
            <p className="font-semibold">
              Trocar de {sessionProvider} para {provider}?
            </p>
            <p className="mt-1">
              A sessão nativa do {sessionProvider} (o contexto interno da CLI: resultados de ferramentas, cache) <strong>não acompanha</strong> a troca, então
              o {provider} começa do zero. O OWL envia a ele os fatos fixados, o resumo da conversa e as últimas mensagens.
            </p>
            <p className="mt-1 text-muted">
              &quot;Resumir e trocar&quot; deixa esse resumo em dia antes. Sem resumir, vale o resumo que já existe (ou nenhum).
            </p>
            {switching.problem && (
              <p role="alert" className="mt-1 text-danger">
                Não consegui resumir: {switching.problem}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={switching.working} onClick={() => void summarizeAndSwitch()} className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-fg disabled:opacity-50">
                {switching.working ? 'Resumindo…' : 'Resumir e trocar'}
              </button>
              <button type="button" disabled={switching.working} onClick={() => void reallySend(switching.input)} className="rounded-lg border border-line px-3 py-1.5 hover:bg-panel disabled:opacity-50">
                {switching.problem ? 'Trocar mesmo assim' : 'Trocar sem resumir'}
              </button>
              <button type="button" disabled={switching.working} onClick={() => setSwitching(null)} className="ml-auto rounded-lg border border-line px-3 py-1.5 hover:bg-panel disabled:opacity-50">
                Cancelar
              </button>
            </div>
          </section>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-muted">Provedor</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded border border-line bg-raised px-2 py-1">
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.id}
                  {p.available ? '' : ' (indisponível)'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={improve} onChange={(e) => setImprove(e.target.checked)} />
            Melhorar prompt
          </label>
          {improve && (
            <>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={reviewFirst} onChange={(e) => setReviewFirst(e.target.checked)} />
                Editar antes de executar
              </label>
              {refinerOptions.length > 1 && (
                <label className="flex items-center gap-1">
                  <span className="text-muted">Refinador</span>
                  <select value={refinerIdx} onChange={(e) => setRefinerIdx(Number(e.target.value))} className="rounded border border-line bg-raised px-2 py-1">
                    {refinerOptions.map((o, i) => (
                      <option key={i} value={i}>
                        {o.modelo ?? o.provedor}
                        {i === 0 ? ' (padrão)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <label className="flex items-center gap-1">
            <span className="text-muted">Modelo</span>
            <input list="owl-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="padrão" className="w-28 rounded border border-line bg-raised px-2 py-1" />
            <datalist id="owl-models">
              {MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="owl-composer">
            Mensagem
          </label>
          <textarea
            id="owl-composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={images.onPaste}
            disabled={!hasSession || switching !== null}
            rows={2}
            placeholder="Enter envia · Shift+Enter quebra a linha"
            className="max-h-48 min-h-[2.75rem] flex-1 resize-y rounded-lg border border-line bg-raised px-3 py-2 disabled:opacity-50"
          />
          <input ref={fileInput} type="file" accept={ACCEPTED.join(',')} multiple hidden aria-label="Escolher imagens" onChange={(e) => { images.add(e.target.files ?? []); e.target.value = ''; }} />
          <button type="button" aria-label="Anexar imagem" title="Anexar imagem (ou cole / arraste)" disabled={!hasSession} onClick={() => fileInput.current?.click()} className="rounded-lg border border-line px-3 py-2 disabled:opacity-50">
            📎
          </button>
          {streaming ? (
            <button type="button" onClick={onCancel} className="rounded-lg border border-danger px-4 py-2 font-medium text-danger">
              Cancelar
            </button>
          ) : (
            <button type="submit" disabled={!hasSession || busy || images.uploading || (!text.trim() && images.ready.length === 0)} className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg disabled:opacity-50">
              Enviar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
