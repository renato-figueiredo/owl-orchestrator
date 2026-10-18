import { Button } from '@owl/ui';
import { Power } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { OllamaState } from '../lib/types';

/** A run that failed because nothing answered on the local model server's address (the adapter's own wording). */
export const isOllamaDown = (erro: string | null | undefined): boolean => /ollama: could not reach/i.test(erro ?? '');

const VIA: Record<NonNullable<OllamaState['via']>, string> = {
  container: 'O contêiner "ollama" está parado.',
  programa: 'O programa `ollama` está instalado, mas não está rodando.',
};

/**
 * Says whether the local model server (Ollama) is up and, when it is not, why and what OWL can do: turn it on with one
 * click (the stopped container or the installed program), or point to how to set it up. `quiet` shows nothing while it is up
 * (for an error banner); otherwise it also confirms it is up.
 */
export function OllamaPanel({ onUp, quiet = false, reason }: { onUp?: () => void; quiet?: boolean; reason?: string }) {
  const [s, setS] = useState<OllamaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const check = useCallback(() => api.ollama().then(setS).catch(() => undefined), []);
  useEffect(() => {
    void check();
  }, [check]);

  if (!s) return null;
  if (s.disponivel) {
    return quiet ? null : (
      <p className="m-0 text-xs text-muted">
        <span aria-hidden="true" className="font-mono">✓ </span>Ollama no ar com {s.modelos.length} modelo(s).
      </p>
    );
  }
  const turnOn = () => {
    setBusy(true);
    setFailed(null);
    api
      .ollamaStart()
      .then((next) => {
        setS(next);
        if (next.disponivel) onUp?.();
        else setFailed(next.dica ?? 'Ele não respondeu.');
      })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div role="status" aria-label="Ollama desligado" className="flex flex-col gap-2 rounded-md border border-accent bg-raised p-3 text-xs">
      <p className="m-0 font-medium">
        <span aria-hidden="true" className="font-mono">⊘ </span>
        Ollama desligado{reason ? `: ${reason}` : ''}
      </p>
      <p className="m-0 text-muted">
        {s.via ? `${VIA[s.via]} ` : ''}
        {!s.via && s.dica ? s.dica : 'Sem ele, o tier pequeno usa o provedor configurado e as execuções que pedem um modelo local falham.'}
      </p>
      {s.via && (
        <div className="flex items-center gap-2">
          <Button size="sm" icon={Power} disabled={busy} onClick={turnOn}>
            {busy ? 'Ligando… (até 30 s)' : 'Ligar o Ollama'}
          </Button>
        </div>
      )}
      {failed && <p className="m-0 text-danger">{failed}</p>}
    </div>
  );
}
