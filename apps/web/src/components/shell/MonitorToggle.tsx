import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type MonitorStatus } from '../../lib/api';

/** The backlog monitor's switch in the Vigia bar: stop/start, plus a warning when the day's budget passes the warning share. */
export function MonitorToggle() {
  const [s, setS] = useState<MonitorStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .monitor()
        .then((x) => alive && setS(x))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!s) return null;
  const on = s.config.ativo;
  const pct = s.dia.percentual;
  const warn = pct !== null && pct >= s.config.avisoPct;
  const last = s.estado.avisos[0];
  const detail = [
    on ? (s.estado.parado ? `parado: ${s.estado.parado}` : 'vigiando o backlog') : 'desligado',
    pct !== null ? `uso do dia ${Math.floor(pct * 100)}%` : null,
    last ? last.texto : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const toggle = () => void (on ? api.monitorStop() : api.monitorStart()).then(setS).catch(() => undefined);
  return (
    <button
      type="button"
      onClick={toggle}
      title={detail}
      aria-label={on ? 'Parar o monitor do backlog' : 'Ligar o monitor do backlog'}
      className={`flex h-7 flex-none items-center gap-2 rounded-md border px-2.5 font-mono text-[11px] hover:border-line-strong ${warn ? 'border-accent text-accent' : 'border-line text-muted'}`}
    >
      {on ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
      Monitor {on ? (s.estado.parado ? 'parado' : 'ligado') : 'off'}
      {warn && pct !== null && <span>{Math.floor(pct * 100)}%</span>}
    </button>
  );
}
