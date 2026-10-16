import { Button } from '@owl/ui';
import { Play, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RefinerInfo } from '../lib/types';
import { Markdown } from './Markdown';

type Via = { provider: string; model?: string };

interface ReviewProps {
  /** The refined prompt, as stored. */
  texto: string;
  refiner: RefinerInfo | null;
  onRun: (texto: string) => void;
  onRetry: (via: Via) => void;
  onDiscard: () => void;
  disabled: boolean;
}

/** The refined prompt waiting for the user: amber frame (it waits for the human), editable, run / refine again / drop. */
export function ReviewCard({ texto, refiner, onRun, onRetry, onDiscard, disabled }: ReviewProps) {
  const [draft, setDraft] = useState(texto);
  const edited = draft.trim() !== texto.trim();
  return (
    <section aria-label="Prompt melhorado, aguardando você" className="max-w-[660px] overflow-hidden rounded-lg border border-accent bg-panel">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[13px]">
          <span aria-hidden="true" className="font-mono text-accent">▲</span>
          <h3 className="font-semibold text-accent">Prompt melhorado</h3>
          <span className="text-muted">aguardando você</span>
        </div>
        <p className="text-[13px] text-muted">Revise e edite se quiser. Só depois de &quot;Executar&quot; ele vai para o agente.</p>
        <label className="sr-only" htmlFor="owl-refined">
          Prompt melhorado (editável)
        </label>
        <textarea
          id="owl-refined"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
          className="w-full resize-y rounded-md border border-line bg-raised px-2.5 py-2 font-mono text-xs leading-[1.6] focus:border-accent"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <Button variant="primary" icon={Play} disabled={disabled || !draft.trim()} onClick={() => onRun(draft)}>
          {edited ? 'Executar com a minha edição' : 'Executar'}
        </Button>
        <RetryButtons refiner={refiner} disabled={disabled} onRetry={onRetry} label="Melhorar de novo" />
        <span className="flex-1" />
        <Button variant="ghost" disabled={disabled} onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </section>
  );
}

interface FailureProps {
  motivo: string;
  refiner: RefinerInfo | null;
  onSkip: () => void;
  onRetry: (via: Via) => void;
  onDiscard: () => void;
  disabled: boolean;
}

/** Shared shell of the design's FailureCard: red frame, "Causa" / "Sugestão" rows, the raw error in mono, then the actions. */
export function FailureShell({ label, title, cause, suggestion, error, actions, meta }: { label: string; title: string; cause: ReactNode; suggestion: ReactNode; error?: string | undefined; actions: ReactNode; meta?: string | undefined }) {
  return (
    <section role="alert" aria-label={label} className="max-w-[660px] overflow-hidden rounded-lg border border-danger bg-panel">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex items-center gap-2 text-[13px]">
          <span aria-hidden="true" className="font-mono text-danger">✕</span>
          <h3 className="font-semibold text-danger">{title}</h3>
          <span className="flex-1" />
          {meta && <span className="font-mono text-[11px] tabular-nums text-muted">{meta}</span>}
        </div>
        <dl className="grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1.5 text-[13px] leading-normal">
          <dt className="text-muted">Causa</dt>
          <dd>{cause}</dd>
          <dt className="text-muted">Sugestão</dt>
          <dd>{suggestion}</dd>
        </dl>
        {error && <div className="break-words rounded-sm bg-bg px-2.5 py-2 font-mono text-[11px] leading-normal text-muted">{error}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">{actions}</div>
    </section>
  );
}

const mono = (s: string) => <span className="font-mono text-xs">{s}</span>;

/** The refiner failed. Nothing switches on its own: the user picks another model, skips refinement, or gives up. */
export function FailureCard({ motivo, refiner, onSkip, onRetry, onDiscard, disabled }: FailureProps) {
  // Another agent's step (a reviewer...) failed: the refiner's alternatives and "run without improving" do not apply.
  const other = /^Falha na etapa "([^"]+)":\s*/.exec(motivo);
  if (other) {
    return (
      <FailureShell
        label={`Falha na etapa ${other[1]}`}
        title={`A etapa “${other[1]}” falhou`}
        cause={<>A etapa {mono(other[1]!)} parou antes de terminar.</>}
        suggestion="Leia o erro abaixo e dispense para seguir; o resto da conversa não muda."
        error={motivo.slice(other[0].length)}
        actions={
          <Button variant="secondary" disabled={disabled} onClick={onDiscard}>
            Dispensar
          </Button>
        }
      />
    );
  }
  const alternatives = refiner?.fallback ?? [];
  const first = alternatives[0];
  return (
    <FailureShell
      label="Falha ao melhorar o prompt"
      title="Não consegui melhorar o prompt"
      cause={<>O refinador {refiner ? mono(refiner.modelo ?? refiner.provedor) : null} não devolveu um prompt.</>}
      suggestion={first ? <>Tentar com {mono(first.modelo ?? first.provedor)}, executar o seu texto como está, ou descartar.</> : 'Executar o seu texto como está, ou descartar.'}
      error={motivo.replace(/^Falha ao melhorar o prompt:\s*/, '')}
      actions={
        <>
          <RetryButtons refiner={refiner} disabled={disabled} onRetry={onRetry} label="Tentar com" skipPrimary primaryFirst />
          <Button variant={first ? 'secondary' : 'primary'} disabled={disabled} onClick={onSkip}>
            Executar sem melhorar
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" disabled={disabled} onClick={onDiscard}>
            Descartar
          </Button>
        </>
      }
    />
  );
}

/** One button per alternative the refiner agent lists (haiku, later Ollama...). */
function RetryButtons({ refiner, onRetry, disabled, label, skipPrimary = false, primaryFirst = false }: { refiner: RefinerInfo | null; onRetry: ReviewProps['onRetry']; disabled: boolean; label: string; skipPrimary?: boolean; primaryFirst?: boolean }) {
  const options = [
    ...(skipPrimary ? [] : refiner ? [{ provedor: refiner.provedor, ...(refiner.modelo ? { modelo: refiner.modelo } : {}) }] : []),
    ...(refiner?.fallback ?? []),
  ];
  return (
    <>
      {options.map((o, i) => (
        <Button
          key={`${o.provedor}:${o.modelo ?? ''}`}
          variant={primaryFirst && i === 0 ? 'primary' : 'secondary'}
          icon={RotateCcw}
          disabled={disabled}
          onClick={() => onRetry({ provider: o.provedor, ...(o.modelo ? { model: o.modelo } : {}) })}
        >
          {label} {o.modelo ?? o.provedor}
        </Button>
      ))}
    </>
  );
}

/** A refined prompt that is already settled (executed or discarded): shown collapsed in the history. */
export function RefinedPromptDone({ texto }: { texto: string }) {
  return (
    <details className="max-w-[660px] rounded-md border border-line bg-panel px-3.5 py-2 text-[13px]">
      <summary className="cursor-pointer text-muted hover:text-fg">Prompt melhorado usado nesta execução</summary>
      <div className="mt-2">
        <Markdown>{texto}</Markdown>
      </div>
    </details>
  );
}
