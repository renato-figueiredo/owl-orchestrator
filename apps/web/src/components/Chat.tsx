import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { StreamState } from '../lib/stream';
import type { Approval, Message, ProviderInfo, RefinerInfo } from '../lib/types';
import type { SendInput } from '../lib/api';
import { Logo } from './Logo';
import { Markdown } from './Markdown';
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

export function Chat({ hasSession, messages, stream, providers, busy, error, onSend, onCancel, refiner, approvals, streamStep, onContinue, onRetry, onDiscard }: Props) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState('claude-cli');
  const [model, setModel] = useState('');
  const [improve, setImprove] = useState(false);
  const [reviewFirst, setReviewFirst] = useState(false);
  const [refinerIdx, setRefinerIdx] = useState(0);
  const refinerOptions = refiner ? [{ provedor: refiner.provedor, ...(refiner.modelo ? { modelo: refiner.modelo } : {}) }, ...refiner.fallback] : [];
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

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const texto = text.trim();
    if (!texto || busy || streaming || !hasSession) return;
    setText('');
    const chosen = refinerOptions[refinerIdx];
    await onSend({
      texto,
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
    });
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
          <div className="mt-24 flex flex-col items-center gap-3 text-muted">
            <Logo size={56} blink />
            <p>Crie ou escolha uma conversa para começar.</p>
          </div>
        )}
        {hasSession && messages.length === 0 && !stream && (
          <div className="mt-24 flex flex-col items-center gap-3 text-muted">
            <Logo size={56} blink />
            <p>Escreva a primeira mensagem abaixo.</p>
          </div>
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
          return (
            <Bubble key={m.id} papel={m.papel}>
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
                <Logo size={20} blink /> {streamStep === 'melhorar' ? 'Melhorando o prompt…' : 'Pensando…'}
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

      <form onSubmit={(e) => void submit(e)} className="border-t border-line bg-panel p-3">
        {error && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
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
            disabled={!hasSession}
            rows={2}
            placeholder="Enter envia · Shift+Enter quebra a linha"
            className="max-h-48 min-h-[2.75rem] flex-1 resize-y rounded-lg border border-line bg-raised px-3 py-2 disabled:opacity-50"
          />
          {streaming ? (
            <button type="button" onClick={onCancel} className="rounded-lg border border-danger px-4 py-2 font-medium text-danger">
              Cancelar
            </button>
          ) : (
            <button type="submit" disabled={!hasSession || busy || !text.trim()} className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg disabled:opacity-50">
              Enviar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
