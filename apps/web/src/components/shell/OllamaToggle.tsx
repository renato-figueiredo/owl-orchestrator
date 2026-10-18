import { Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { OllamaState } from '../../lib/types';

/**
 * The local model server in the Vigia bar, as a single icon beside the monitor: lit when Ollama answers, dim when it does
 * not. A click turns it on when OWL can (the stopped container or the installed program); otherwise the tooltip says why not.
 */
export function OllamaToggle() {
  const [s, setS] = useState<OllamaState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.ollama().then((x) => alive && setS(x)).catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!s) return null;
  const up = s.disponivel;
  const canStart = !up && s.via !== null;
  const label = busy
    ? 'Ligando o Ollama… (até 30 s)'
    : up
      ? `Ollama no ar com ${s.modelos.length} modelo(s)`
      : canStart
        ? 'Ollama desligado: clique para ligar'
        : `Ollama desligado. ${s.dica ?? ''}`.trim();
  const turnOn = () => {
    if (!canStart || busy) return;
    setBusy(true);
    api
      .ollamaStart()
      .then(setS)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      onClick={turnOn}
      aria-label={label}
      title={label}
      aria-pressed={up}
      className={`grid h-7 w-7 flex-none place-items-center rounded-md border border-line transition-opacity duration-[160ms] ${up ? 'text-ok' : 'text-muted opacity-40'} ${canStart ? 'cursor-pointer hover:opacity-100 hover:text-fg' : 'cursor-default'} ${busy ? 'animate-pulse opacity-100' : ''}`}
    >
      <Cpu size={14} aria-hidden="true" />
    </button>
  );
}
