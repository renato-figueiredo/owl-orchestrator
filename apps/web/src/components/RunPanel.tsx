import { isOllamaDown, OllamaPanel } from './OllamaPanel';
import { Button, IconButton, ProviderDot, RunStep, StatusPill, Tabs, type RunStatus } from '@owl/ui';
import { PanelRightClose, PanelRightOpen, Square } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fmtClock, fmtCompact, fmtMs, fmtUsd } from '../lib/format';
import type { StreamState } from '../lib/stream';
import type { Run } from '../lib/types';
import { useNow } from '../lib/useNow';

const RUN_STATUS: Record<Run['status'], RunStatus> = { rodando: 'running', ok: 'done', erro: 'failed', cancelado: 'cancelled' };
const STREAM_STATUS: Record<StreamState['phase'], RunStatus> = { connecting: 'running', running: 'running', ended: 'done', error: 'failed', cancelled: 'cancelled' };

/** Wide screens (>= 1280px) keep the panel fixed at 380px; below that it is a drawer over the chat. */
const WIDE = '(min-width: 1280px)';
function useWide(): boolean {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null);
  const [wide, setWide] = useState(() => query()?.matches ?? true);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}

const parse = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

/** One line that says what a tool call is about: the first meaningful string in its input. */
function detailOf(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'string') return input.split('\n')[0];
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) if (typeof o[k] === 'string') return o[k] as string;
  }
  return JSON.stringify(input);
}

interface Line {
  s: '+' | '-' | ' ';
  t: string;
}
const MAX_LINES = 60;
/** The expanded input of a tool: an edit shows as −/+ lines; a diff string is coloured per line; anything else is plain JSON. */
function linesOf(input: unknown): Line[] {
  const split = (text: string, s: Line['s']): Line[] => text.split('\n').map((t) => ({ s, t }));
  let lines: Line[];
  if (typeof input === 'string') {
    lines = input.split('\n').map((t) => ({ s: /^\+(?!\+\+)/.test(t) ? '+' : /^-(?!--)/.test(t) ? '-' : ' ', t: /^[+-](?![+-]{2})/.test(t) ? t.slice(1) : t }));
  } else if (input && typeof input === 'object' && typeof (input as Record<string, unknown>).old_string === 'string' && typeof (input as Record<string, unknown>).new_string === 'string') {
    const o = input as { file_path?: unknown; old_string: string; new_string: string };
    lines = [...(typeof o.file_path === 'string' ? split(o.file_path, ' ') : []), ...split(o.old_string, '-'), ...split(o.new_string, '+')];
  } else {
    lines = split(JSON.stringify(input, null, 2) ?? '', ' ');
  }
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), { s: ' ', t: `… mais ${lines.length - MAX_LINES} linhas` }] : lines;
}

function Lines({ input }: { input: unknown }) {
  return (
    <>
      {linesOf(input).map((l, i) => {
        const style: CSSProperties = { padding: '0 8px', whiteSpace: 'pre', overflow: 'hidden', color: l.s === '+' ? 'var(--c-diff-add)' : l.s === '-' ? 'var(--c-diff-del)' : 'var(--c-muted)', background: l.s === '+' ? 'var(--c-diff-add-bg)' : l.s === '-' ? 'var(--c-diff-del-bg)' : 'transparent' };
        return (
          <div key={i} style={style}>
            {l.s} {l.t}
          </div>
        );
      })}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.06em] text-muted">{label}</div>
      <div className="text-[13px]">{value}</div>
    </div>
  );
}

/** Live timeline of the current run, with the time of each step on the margin (flight log). */
function Timeline({ stream, startedAt, now }: { stream: StreamState; startedAt: number | null; now: number }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  // The stream carries no timestamps: note when each step first shows up here (idempotent, safe to run on every render).
  const arrivals = useRef<number[]>([]);
  const t0 = useRef<number | null>(null);
  const endedAt = useRef<number | null>(null);
  if (stream.tools.length < arrivals.current.length) arrivals.current = [];
  if (t0.current === null) t0.current = startedAt ?? Date.now();
  for (let i = arrivals.current.length; i < stream.tools.length; i++) arrivals.current.push(Date.now());
  const live = stream.phase === 'running' || stream.phase === 'connecting';
  if (!live && endedAt.current === null) endedAt.current = Date.now();
  if (live) endedAt.current = null;
  const origin = startedAt ?? t0.current;
  const at = (ms: number) => fmtClock((ms - origin) / 1000);
  const toggle = (i: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const tools = stream.tools;
  const startDetail = [stream.provider && `adaptador: ${stream.provider}`, stream.model].filter(Boolean).join(' · ');
  const final = !live;
  return (
    <ol aria-label="Linha do tempo" className="m-0 flex flex-1 list-none flex-col overflow-y-auto py-4 pl-0 pr-4">
      <RunStep time={at(origin)} name="início" {...(startDetail ? { detail: startDetail } : {})} status="done" />
      {tools.map((t, i) => {
        const arrive = arrivals.current[i] ?? now;
        const next = arrivals.current[i + 1] ?? (final ? endedAt.current : null);
        const running = live && i === tools.length - 1;
        return (
          <RunStep
            key={i}
            time={at(arrive)}
            name={t.name}
            {...(detailOf(t.input) ? { detail: detailOf(t.input)! } : {})}
            {...(next ? { duration: fmtMs(next - arrive) } : {})}
            status={running ? 'running' : 'done'}
            expanded={open.has(i)}
            onToggle={() => toggle(i)}
          >
            {t.input !== undefined ? <Lines input={t.input} /> : null}
          </RunStep>
        );
      })}
      {live && tools.length === 0 && <RunStep time={at(now)} name="pensando" status="running" last />}
      {final && (
        <RunStep
          time={at(endedAt.current ?? now)}
          name={{ ended: 'concluída', error: 'falhou', cancelled: 'cancelada', running: '', connecting: '' }[stream.phase]}
          {...(stream.phase === 'error' && stream.error ? { detail: stream.error } : {})}
          status={stream.phase === 'error' ? 'failed' : stream.phase === 'cancelled' ? 'think' : 'done'}
          last
        />
      )}
    </ol>
  );
}

interface PanelProps {
  runs: Run[];
  stream: StreamState | null;
  open: boolean;
  onToggle: () => void;
  /** When given, the panel gets a second tab with this content. */
  memory?: ReactNode;
  /** Stops the run that is streaming (the "Cancelar" button, also ⌘.). */
  onCancel?: (() => void) | undefined;
}

export function RunPanel({ runs, stream, open, onToggle, memory, onCancel }: PanelProps) {
  const [tab, setTab] = useState<'run' | 'memory'>('run');
  const wide = useWide();
  const [drawer, setDrawer] = useState(false);
  const shown = wide ? open : drawer;
  const toggle = wide ? onToggle : () => setDrawer((v) => !v);

  const live = stream !== null && (stream.phase === 'running' || stream.phase === 'connecting');
  const current = runs.find((r) => r.status === 'rodando') ?? runs[runs.length - 1] ?? null;
  const now = useNow(live);
  const startedAt = parse(current?.inicio);
  const finishedAt = parse(current?.fim);
  const elapsed = live ? (startedAt !== null ? now - startedAt : null) : startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null;
  const tokIn = stream?.inputTokens ?? current?.tokensIn;
  const tokOut = stream?.outputTokens ?? current?.tokensOut;
  const cost = stream?.costUsd ?? current?.custoEstimado;
  const status: RunStatus | null = stream ? STREAM_STATUS[stream.phase] : current ? RUN_STATUS[current.status] : null;
  const totalIn = runs.reduce((a, r) => a + (r.tokensIn ?? 0), 0);
  const totalOut = runs.reduce((a, r) => a + (r.tokensOut ?? 0), 0);
  const totalCost = runs.reduce((a, r) => a + (r.custoEstimado ?? 0), 0);

  // ⌘. stops the run, Esc closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.' && live && onCancel) {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Escape' && !wide && drawer) setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, onCancel, wide, drawer]);

  if (!shown) {
    return (
      <aside className="flex-none border-l border-line bg-panel p-1">
        <IconButton icon={PanelRightOpen} label="Abrir painel de execução" size={32} aria-expanded={false} onClick={toggle} />
      </aside>
    );
  }
  const onMemory = memory && tab === 'memory';
  return (
    <aside
      aria-label="Execução"
      className={`flex min-h-0 w-[380px] max-w-full flex-none flex-col border-l border-line bg-panel ${wide ? '' : 'fixed bottom-0 right-0 top-[44px] z-30 shadow-[var(--shadow-overlay)]'}`}
      style={wide ? undefined : { animation: 'owl-fade-in var(--dur-slow) var(--ease-out)' }}
    >
      <div className="flex flex-none flex-col gap-3 border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold">Execução</h2>
          {status && <StatusPill status={status} />}
          <span className="flex-1" />
          {live && onCancel && (
            <Button variant="danger" size="sm" icon={Square} kbd="⌘." onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <IconButton icon={PanelRightClose} label="Recolher painel de execução" size={28} aria-expanded onClick={toggle} />
        </div>
        {memory && <Tabs label="Painel lateral" size="sm" items={[{ value: 'run', label: 'Execução' }, { value: 'memory', label: 'Memória' }]} value={tab} onChange={(v) => setTab(v as 'run' | 'memory')} />}
        {!onMemory && (
          <div className="grid grid-cols-4 gap-2 font-mono tabular-nums">
            <Metric label="TEMPO" value={elapsed === null ? '–' : fmtClock(elapsed / 1000)} />
            <Metric label="ENTRADA" value={fmtCompact(tokIn)} />
            <Metric label="SAÍDA" value={fmtCompact(tokOut)} />
            <Metric label="CUSTO" value={fmtUsd(cost)} />
          </div>
        )}
      </div>

      {!onMemory && !live && (isOllamaDown(stream?.phase === 'error' ? stream.error : undefined) || (current?.status === 'erro' && isOllamaDown(current.erro))) && (
        <div className="flex-none border-b border-line px-4 py-3">
          <OllamaPanel quiet reason="esta execução não conseguiu falar com ele" />
        </div>
      )}

      {onMemory ? (
        <div role="tabpanel" aria-label="Memória" className="min-h-0 flex-1 overflow-y-auto">
          {memory}
        </div>
      ) : (
        <>
          {stream ? (
            <Timeline stream={stream} startedAt={startedAt} now={now} />
          ) : (
            <p className="flex-1 px-4 py-4 text-[13px] text-muted">{runs.length === 0 ? 'Nenhuma execução ainda.' : 'Sem execução ao vivo. As anteriores estão listadas abaixo.'}</p>
          )}
          <section className="max-h-[40%] flex-none overflow-y-auto border-t border-line px-4 py-3" aria-label="Histórico de execuções">
            <h3 className="owl-label">Execuções da conversa</h3>
            {runs.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-muted">Nenhuma ainda.</p>
            ) : (
              <>
                <ul className="mt-2 space-y-1.5">
                  {runs.map((r) => (
                    <li key={r.id} className={`rounded-md bg-raised px-2.5 py-2 ${r.parentRunId ? 'ml-4' : ''}`}>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <ProviderDot provider={r.provedor} />
                        {r.etapa && <span className="font-semibold">{r.etapa}</span>}
                        <span className="min-w-0 flex-1 truncate text-muted">
                          {r.provedor}
                          {r.modelo ? ` · ${r.modelo}` : ''}
                        </span>
                        <StatusPill status={RUN_STATUS[r.status]} bare />
                      </div>
                      <div className="mt-1 font-mono text-[11px] tabular-nums text-muted">
                        {fmtCompact(r.tokensIn)} ent · {fmtCompact(r.tokensOut)} saí · {fmtUsd(r.custoEstimado)}
                      </div>
                      {r.memoriaChamadas && (
                        <div className="mt-0.5 font-mono text-[11px] text-muted" data-testid="memory-calls">
                          Memória: {Object.entries(r.memoriaChamadas).map(([name, n]) => `${name} ×${n}`).join(', ')}
                        </div>
                      )}
                      {r.erro && (
                        <div className="mt-1 truncate font-mono text-[11px] text-danger" title={r.erro}>
                          {r.erro}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-line pt-2 font-mono text-[11px] tabular-nums text-muted" data-testid="session-total">
                  Total: {fmtCompact(totalIn)} ent · {fmtCompact(totalOut)} saí · {fmtUsd(totalCost)}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
