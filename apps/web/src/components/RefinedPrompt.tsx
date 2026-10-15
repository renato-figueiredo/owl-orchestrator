import { useState } from 'react';
import type { RefinerInfo } from '../lib/types';
import { Markdown } from './Markdown';

interface ReviewProps {
  /** The refined prompt, as stored. */
  texto: string;
  refiner: RefinerInfo | null;
  onRun: (texto: string) => void;
  onRetry: (via: { provider: string; model?: string }) => void;
  onDiscard: () => void;
  disabled: boolean;
}

/** The refined prompt waiting for the user: editable, with the options to run, retry with another model, or drop. */
export function ReviewCard({ texto, refiner, onRun, onRetry, onDiscard, disabled }: ReviewProps) {
  const [draft, setDraft] = useState(texto);
  const edited = draft.trim() !== texto.trim();
  return (
    <section aria-label="Prompt melhorado, aguardando você" className="rounded-2xl border border-accent bg-panel p-3">
      <h3 className="mb-1 font-semibold">Prompt melhorado</h3>
      <p className="mb-2 text-sm text-muted">Revise e edite se quiser. Só depois de &quot;Executar&quot; ele vai para o agente.</p>
      <label className="sr-only" htmlFor="owl-refined">
        Prompt melhorado (editável)
      </label>
      <textarea
        id="owl-refined"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
        className="w-full resize-y rounded-lg border border-line bg-raised px-3 py-2 font-mono text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || !draft.trim()} onClick={() => onRun(draft)} className="rounded-lg bg-accent px-4 py-1.5 font-medium text-accent-fg disabled:opacity-50">
          {edited ? 'Executar com a minha edição' : 'Executar'}
        </button>
        <RetryButtons refiner={refiner} disabled={disabled} onRetry={onRetry} label="Melhorar de novo" />
        <button type="button" disabled={disabled} onClick={onDiscard} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Descartar
        </button>
      </div>
    </section>
  );
}

interface FailureProps {
  motivo: string;
  refiner: RefinerInfo | null;
  onSkip: () => void;
  onRetry: (via: { provider: string; model?: string }) => void;
  onDiscard: () => void;
  disabled: boolean;
}

/** The refiner failed. Nothing switches on its own: the user picks another model, skips refinement, or gives up. */
export function FailureCard({ motivo, refiner, onSkip, onRetry, onDiscard, disabled }: FailureProps) {
  // Another agent's step (a reviewer...) failed: the refiner's alternatives and "run without improving" do not apply.
  const other = /^Falha na etapa "([^"]+)":\s*/.exec(motivo);
  if (other) {
    return (
      <section role="alert" aria-label={`Falha na etapa ${other[1]}`} className="rounded-2xl border border-danger bg-panel p-3">
        <h3 className="font-semibold text-danger">A etapa “{other[1]}” falhou</h3>
        <p className="mt-1 break-words text-sm">{motivo.slice(other[0].length)}</p>
        <div className="mt-2 flex">
          <button type="button" disabled={disabled} onClick={onDiscard} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised">
            Dispensar
          </button>
        </div>
      </section>
    );
  }
  return (
    <section role="alert" aria-label="Falha ao melhorar o prompt" className="rounded-2xl border border-danger bg-panel p-3">
      <h3 className="font-semibold text-danger">Não consegui melhorar o prompt</h3>
      <p className="mt-1 break-words text-sm">{motivo.replace(/^Falha ao melhorar o prompt:\s*/, '')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <RetryButtons refiner={refiner} disabled={disabled} onRetry={onRetry} label="Tentar com" skipPrimary />
        <button type="button" disabled={disabled} onClick={onSkip} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Executar sem melhorar
        </button>
        <button type="button" disabled={disabled} onClick={onDiscard} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Descartar
        </button>
      </div>
    </section>
  );
}

/** One button per alternative the refiner agent lists (haiku, later Ollama...). */
function RetryButtons({ refiner, onRetry, disabled, label, skipPrimary = false }: { refiner: RefinerInfo | null; onRetry: ReviewProps['onRetry']; disabled: boolean; label: string; skipPrimary?: boolean }) {
  const options = [
    ...(skipPrimary ? [] : refiner ? [{ provedor: refiner.provedor, ...(refiner.modelo ? { modelo: refiner.modelo } : {}) }] : []),
    ...(refiner?.fallback ?? []),
  ];
  return (
    <>
      {options.map((o) => (
        <button
          key={`${o.provedor}:${o.modelo ?? ''}`}
          type="button"
          disabled={disabled}
          onClick={() => onRetry({ provider: o.provedor, ...(o.modelo ? { model: o.modelo } : {}) })}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised"
        >
          {label} {o.modelo ?? o.provedor}
        </button>
      ))}
    </>
  );
}

/** A refined prompt that is already settled (executed or discarded): shown collapsed in the history. */
export function RefinedPromptDone({ texto }: { texto: string }) {
  return (
    <details className="rounded-2xl border border-line bg-panel px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted">Prompt melhorado usado nesta execução</summary>
      <div className="mt-2">
        <Markdown>{texto}</Markdown>
      </div>
    </details>
  );
}
