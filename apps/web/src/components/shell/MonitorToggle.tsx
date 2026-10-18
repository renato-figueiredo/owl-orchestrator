import { ChevronDown, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type MonitorStatus } from '../../lib/api';

/** "YYYY-MM-DD HH:MM:SS" (UTC, as stored) → local "HH:MM". */
const clock = (s: string) => {
  const ms = Date.parse(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? s : new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
const pct = (n: number) => `${Math.floor(n * 100)}%`;

/** The backlog monitor in the Vigia bar: stop/start, the plan's usage, and (opened) where it has been looking and what it did. */
export function MonitorToggle() {
  const [s, setS] = useState<MonitorStatus | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .monitor()
        .then((x) => alive && setS(x))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), open ? 5_000 : 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);
  if (!s) return null;
  const on = s.config.ativo;
  const plan = s.plano ? Math.max(s.plano.sessao, s.plano.semana) : null;
  const day = s.dia.percentual ?? null;
  const shown = plan ?? day;
  const warn = shown !== null && shown >= s.config.avisoPct;
  const look = s.estado.olhando;
  const toggle = () => void (on ? api.monitorStop() : api.monitorStart()).then(setS).catch(() => undefined);
  return (
    <div className="relative flex-none">
      <div className={`flex h-7 items-center overflow-hidden rounded-md border font-mono text-[11px] ${warn ? 'border-accent text-accent' : 'border-line text-muted'}`}>
        <button
          type="button"
          onClick={toggle}
          aria-label={on ? 'Parar o monitor do backlog' : 'Ligar o monitor do backlog'}
          className="flex h-full items-center gap-2 px-2.5 hover:bg-raised hover:text-fg"
        >
          {on ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
          Monitor {on ? (s.estado.parado ? 'parado' : 'ligado') : 'off'}
          {on && look && !s.estado.parado && <span className="max-w-[160px] truncate text-muted">· {look.ticket ?? look.projeto}</span>}
          {shown !== null && <span>{pct(shown)}</span>}
        </button>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Ver o que o monitor está olhando" className="grid h-full w-6 place-items-center border-l border-line hover:bg-raised hover:text-fg">
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div role="dialog" aria-label="Atividade do monitor" className="absolute right-0 top-9 z-30 flex max-h-[70vh] w-[400px] flex-col gap-3 overflow-auto rounded-lg border border-line bg-panel p-4 text-xs shadow-lg">
          <div className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1.5">
            <span className="text-muted">Estado</span>
            <span>{on ? (s.estado.parado ? `parado: ${s.estado.parado}` : 'vigiando e iniciando tickets') : 'desligado'}</span>
            <span className="text-muted">Plano Claude</span>
            <span className="font-mono">
              {s.plano ? `sessão ${pct(s.plano.sessao)} · semana ${pct(s.plano.semana)}` : (s.estado.planoErro ?? 'ainda não lido')}
            </span>
            <span className="text-muted">Orçamento</span>
            <span className="font-mono">{day !== null ? `${pct(day)} dos tokens do dia` : 'sem teto de tokens'}</span>
            <span className="text-muted">Avisa / para</span>
            <span className="font-mono">
              {pct(s.config.avisoPct)} / {pct(s.config.paradaPct)}
            </span>
            <span className="text-muted">Último ciclo</span>
            <span className="font-mono">{s.estado.ultimoCiclo ? clock(s.estado.ultimoCiclo) : '—'}</span>
            <span className="text-muted">Iniciou</span>
            <span className="font-mono">{s.estado.iniciados} ticket(s)</span>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line p-2.5">
            <input
              type="checkbox"
              checked={s.config.autoSequencia === true}
              onChange={(e) => void api.monitorConfig({ autoSequencia: e.target.checked }).then(setS).catch(() => undefined)}
              className="mt-0.5"
              aria-label="Auto-sequência"
            />
            <span>
              <span className="font-medium">Auto-sequência</span>
              <span className="block text-muted">Quando um agente propõe a continuação de um ticket, o monitor a inicia sozinho assim que o ticket anterior fecha. Desligado, ela espera no backlog por você.</span>
            </span>
          </label>
          <div>
            <h3 className="owl-label m-0 mb-1.5 font-medium">Onde olhou</h3>
            <ol aria-label="Atividade do monitor" className="m-0 flex list-none flex-col p-0">
              {(s.estado.atividade ?? []).length === 0 && <li className="text-muted">Nada ainda: ligue o monitor.</li>}
              {(s.estado.atividade ?? []).map((a, i) => (
                <li key={i} className="grid grid-cols-[40px_64px_1fr] gap-2 border-t border-line py-1">
                  <span className="font-mono text-[11px] text-muted">{clock(a.em)}</span>
                  <span className="font-mono">{a.ticket ?? a.projeto}</span>
                  <span className="text-muted">{a.acao}</span>
                </li>
              ))}
            </ol>
          </div>
          {s.estado.avisos.length > 0 && (
            <div>
              <h3 className="owl-label m-0 mb-1.5 font-medium">Avisos</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {s.estado.avisos.slice(0, 5).map((a, i) => (
                  <li key={i} className={a.nivel === 'info' ? 'text-muted' : 'text-accent'}>
                    <span className="font-mono">{clock(a.em)}</span> {a.texto}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
