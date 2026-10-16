import { AgentTag, Button, ProviderDot } from '@owl/ui';
import { Check, Coins, Gauge, PackageCheck, RotateCcw, ShieldAlert, Trash2, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GATE_KIND_HINT, gateAction, fmtAgo, kindLabel, kindRisk, ReworkGate } from '../components/ApprovalGate';
import { api } from '../lib/api';
import { fmtCompact, fmtUsd } from '../lib/format';
import type { GateKind, Project, TicketApproval, TicketDetail } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

const KIND_ICON: Record<GateKind, LucideIcon> = { entrega: PackageCheck, custo: Coins, destrutiva: Trash2, reprovacao: RotateCcw, confianca: Gauge };
const iconOf = (a: Pick<TicketApproval, 'tipo'>): LucideIcon => (a.tipo ? KIND_ICON[a.tipo] : ShieldAlert);

/** A pending gate with the project it belongs to. */
interface Item extends TicketApproval {
  projectId: string;
  projeto: string;
}
/** A gate decided in this session (the backend lists only pending ones, so the history lives here, in memory). */
interface Decided extends Item {
  decisao: 'aprovado' | 'rejeitado';
  nota: string | null;
  em: number;
}

interface Props {
  projects: Project[];
  currentId: string | null;
  /** Called after every decision so the Vigia counter refreshes. */
  onChanged: () => void;
  /** Reload interval in ms (0 = never; tests). */
  pollMs?: number;
}

/** Below 768px the queue becomes a stack of full cards with 48px buttons. */
function useNarrow() {
  const query = '(max-width: 767px)';
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

const usage = (tokens: number, cost: number) => `${fmtCompact(tokens)} tok · ${fmtUsd(cost)}`;

function RiskBars({ risk }: { risk: 'baixo' | 'médio' | 'alto' }) {
  const n = { baixo: 1, médio: 2, alto: 3 }[risk];
  return (
    <span className={`flex items-center gap-2 text-xs ${n === 3 ? 'text-danger' : ''}`}>
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className="h-2.5 w-1 rounded-[1px]" style={{ background: i <= n ? (n === 3 ? 'var(--c-danger)' : 'var(--c-fg)') : 'var(--c-line)' }} />
        ))}
      </span>
      {risk}
    </span>
  );
}

const pendingColor = (a: Pick<TicketApproval, 'tipo'>) => (a.tipo === 'destrutiva' ? 'text-danger' : 'text-accent');

export function ApprovalsQueue({ projects, currentId, onChanged, pollMs = 4000 }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [history, setHistory] = useState<Decided[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const narrow = useNarrow();

  const load = useCallback(async () => {
    try {
      const lists = await Promise.all(projects.map((p) => api.projectApprovals(p.id).then((l) => l.map((a): Item => ({ ...a, projectId: p.id, projeto: p.nome })))));
      const all = lists.flat().sort((a, b) => Number(b.projectId === currentId) - Number(a.projectId === currentId));
      setItems(all);
      setError((e) => (e && e.startsWith('Não foi possível atualizar') ? null : e));
      // Gates that appear after the first load pulse once; the ones already there just sit.
      if (seen.current) {
        const added = all.filter((a) => !seen.current!.has(a.id)).map((a) => a.id);
        if (added.length) setFresh((f) => new Set([...f, ...added]));
      }
      seen.current = new Set(all.map((a) => a.id));
    } catch (e) {
      setError(`Não foi possível atualizar as aprovações: ${message(e)}`);
    }
  }, [projects, currentId]);

  useEffect(() => {
    void load();
    if (!pollMs) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  const pending = items ?? [];
  const sel = pending.find((a) => a.id === selId) ?? history.find((h) => h.id === selId) ?? pending[0] ?? null;
  const selDecided = sel ? history.find((h) => h.id === sel.id) : undefined;
  const selPending = sel && !selDecided ? pending.find((a) => a.id === sel.id) : undefined;

  const decide = useCallback(
    async (a: Item, decisao: 'aprovado' | 'rejeitado', comentario?: string) => {
      setBusy(true);
      setError(null);
      try {
        await api.decideApproval(a.id, decisao, comentario);
        const next = pending.find((p) => p.id !== a.id);
        setHistory((h) => [{ ...a, decisao, nota: comentario ?? null, em: Date.now() }, ...h.filter((x) => x.id !== a.id)]);
        setItems((cur) => (cur ?? []).filter((p) => p.id !== a.id));
        seen.current?.delete(a.id);
        setSelId(next?.id ?? a.id);
        onChanged();
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
        await load();
      }
    },
    [pending, load, onChanged],
  );

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    setRejecting(false);
    setReason('');
  }, [sel?.id]);

  // Keyboard: J/K walk the list, A approves, R starts a rejection (not on the "reprovacao" kind, which has its own answers).
  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        const i = pending.findIndex((a) => a.id === sel?.id);
        const n = pending[Math.min(pending.length - 1, Math.max(0, i + (k === 'j' ? 1 : -1)))];
        if (n) setSelId(n.id);
      } else if (selPending && selPending.tipo !== 'reprovacao' && !busy) {
        if (k === 'a') void decide(selPending, 'aprovado');
        if (k === 'r') setRejecting(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrow, pending, sel?.id, selPending, busy, decide]);

  const count = pending.length;
  const history3 = useMemo(() => history.slice(0, 20), [history]);

  const header = (
    <div className={`flex items-baseline gap-2.5 border-b border-line ${narrow ? 'px-4 pb-3.5 pt-4' : 'px-[18px] pb-3.5 pt-5'}`}>
      <h1 className={`m-0 font-semibold ${narrow ? 'text-xl' : 'text-xl'}`}>Aprovações</h1>
      <span className="font-mono text-xs tabular-nums text-accent" aria-label={`${count} pendentes`}>
        {count}
      </span>
      <span className="flex-1" />
      {!narrow && <span className="font-mono text-[11px] text-muted">J/K navegar</span>}
    </div>
  );

  const errorBanner = error && (
    <p role="alert" className="m-3 rounded-md border border-danger bg-danger-wash p-2.5 text-[13px] text-danger">
      {error}
    </p>
  );

  if (items && count === 0 && history.length === 0)
    return (
      <main aria-label="Aprovações" className="flex min-w-0 flex-1 flex-col">
        {header}
        {errorBanner}
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-6 text-center">
          <img src="/brand/mark.svg" alt="" className="size-14 opacity-55 saturate-[0.4]" />
          <div className="text-lg font-semibold">Nada esperando você</div>
          <div className="max-w-[280px] text-[13px] leading-normal text-muted">Quando um agente pedir push, merge, deploy ou exclusão, aparece aqui.</div>
        </div>
      </main>
    );

  if (narrow)
    return (
      <main aria-label="Aprovações" className="flex min-w-0 flex-1 flex-col">
        {header}
        {errorBanner}
        <div className="flex flex-1 flex-col gap-3 overflow-auto p-3.5">
          {!items && <p className="m-0 text-[13px] text-muted">Carregando…</p>}
          {pending.map((a) => (
            <MobileGate key={a.id} item={a} busy={busy} pulse={fresh.has(a.id)} onDecide={(d, c) => decide(a, d, c)} />
          ))}
          {history3.length > 0 && <History items={history3} selId={null} onSelect={() => {}} />}
        </div>
      </main>
    );

  return (
    <main aria-label="Aprovações" className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-[340px] flex-none flex-col border-r border-line">
        {header}
        {errorBanner}
        <div className="flex flex-1 flex-col gap-1.5 overflow-auto p-2.5">
          {!items && <p className="m-2 text-[13px] text-muted">Carregando…</p>}
          <ul aria-label="Pendentes" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {pending.map((a) => {
              const Icon = iconOf(a);
              const on = sel?.id === a.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => setSelId(a.id)}
                    style={fresh.has(a.id) ? { animation: 'owl-pulse 0.9s var(--ease-out) 1' } : undefined}
                    className={`flex w-full flex-col gap-1.5 rounded-md border p-3 text-left hover:bg-raised ${on ? 'border-accent bg-panel' : 'border-line'}`}
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <Icon size={14} className={pendingColor(a)} aria-hidden="true" />
                      <span className={`font-semibold ${pendingColor(a)}`}>{kindLabel(a)}</span>
                      <span className="flex-1" />
                      <span className="font-mono text-[11px] text-muted">{fmtAgo(a.criadoEm)}</span>
                    </span>
                    <span className="text-[13px] font-medium leading-snug">{a.ticketTitulo ?? a.motivo}</span>
                    <span className="font-mono text-[11px] text-muted">
                      {a.ticketIdentificador} · {a.projeto}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {items && count === 0 && <p className="m-2 text-[13px] text-muted">Nada esperando você</p>}
          {history3.length > 0 && <History items={history3} selId={sel?.id ?? null} onSelect={setSelId} />}
        </div>
      </div>

      {sel && (
        <Detail
          key={sel.id}
          item={sel}
          decided={selDecided}
          busy={busy}
          rejecting={rejecting}
          setRejecting={setRejecting}
          reason={reason}
          setReason={setReason}
          fresh={fresh.has(sel.id)}
          onDecide={(d, c) => decide(sel, d, c)}
        />
      )}
    </main>
  );
}

function History({ items, selId, onSelect }: { items: Decided[]; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-label="Decididas nesta sessão" className="mt-3 flex flex-col gap-1.5">
      <h2 className="owl-label m-0 px-1 font-medium">Decididas nesta sessão</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((h) => (
          <li key={h.id}>
            <button type="button" aria-current={selId === h.id || undefined} onClick={() => onSelect(h.id)} className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-raised ${selId === h.id ? 'border-line-strong bg-panel' : 'border-transparent'}`}>
              <span aria-hidden="true" className={`font-mono ${h.decisao === 'aprovado' ? 'text-ok' : 'text-danger'}`}>
                {h.decisao === 'aprovado' ? '✓' : '✕'}
              </span>
              <span className="font-mono text-[11px] text-muted">{h.ticketIdentificador}</span>
              <span className="min-w-0 flex-1 truncate">{kindLabel(h)}</span>
              <span>{h.decisao}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-panel px-3.5 py-3">
      <span className="owl-label text-[10px]">{label}</span>
      {children}
    </div>
  );
}

/** Ticket data the gate lacks by itself: who asked, what it cost so far, what the delivery should meet. */
function useTicketDetail(ticketId: string): TicketDetail | null {
  const [d, setD] = useState<TicketDetail | null>(null);
  useEffect(() => {
    let cancelled = false;
    setD(null);
    api
      .ticket(ticketId)
      .then((x) => !cancelled && setD(x))
      .catch(() => undefined); // the gate still works without it
    return () => {
      cancelled = true;
    };
  }, [ticketId]);
  return d;
}

function Detail({
  item: a,
  decided,
  busy,
  rejecting,
  setRejecting,
  reason,
  setReason,
  fresh,
  onDecide,
}: {
  item: Item;
  decided: Decided | undefined;
  busy: boolean;
  rejecting: boolean;
  setRejecting: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
  fresh: boolean;
  onDecide: (d: 'aprovado' | 'rejeitado', c?: string) => Promise<unknown>;
}) {
  const d = useTicketDetail(a.ticketId);
  const Icon = iconOf(a);
  const action = gateAction(a);
  const requester = d?.ticket.responsavel ?? null;
  const provider = d?.runs.at(-1)?.provedor;
  const stats = d && d.uso.runs > 0 ? `${usage(d.uso.tokensIn + d.uso.tokensOut, d.uso.custoEstimado)} · ${d.uso.runs} ${d.uso.runs === 1 ? 'execução' : 'execuções'}` : null;
  const criteria = d?.ticket.criteriosAceite?.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean) ?? [];
  const color = decided ? (decided.decisao === 'aprovado' ? 'text-ok' : 'text-danger') : pendingColor(a);

  return (
    <section aria-label="Aprovação selecionada" className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-10 py-7">
      <div className="flex max-w-[820px] flex-col gap-2.5" style={fresh ? { animation: 'owl-pulse 0.9s var(--ease-out) 1' } : undefined}>
        <div className="flex items-center gap-2.5 text-[13px]">
          <Icon size={16} className={color} aria-hidden="true" />
          <span className={`font-semibold ${color}`}>{kindLabel(a)}</span>
          <span className="text-muted">{decided ? decided.decisao : 'pendente'}</span>
          <span className="flex-1" />
          <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{a.ticketIdentificador}</span>
        </div>
        <h2 className="m-0 text-2xl font-semibold leading-tight">{a.ticketTitulo ?? a.motivo}</h2>
        <p className="m-0 text-sm leading-relaxed text-muted">{a.motivo}</p>
        {a.tipo && <p className="m-0 text-xs text-muted">{GATE_KIND_HINT[a.tipo]}</p>}
      </div>

      <div className="grid max-w-[820px] grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <Cell label="Pedido por">{requester ? <AgentTag name={requester} provider={provider} /> : <span className="font-mono text-xs text-muted">não informado</span>}</Cell>
        <Cell label="Alvo">
          <span className="truncate font-mono text-xs">{d?.branch?.branch ?? a.projeto}</span>
        </Cell>
        <Cell label="Risco">
          <RiskBars risk={kindRisk(a)} />
        </Cell>
      </div>

      <div className="flex max-w-[820px] flex-col gap-2">
        <h3 className="owl-label m-0 font-medium">{action ? 'O que será executado' : 'O que está sendo pedido'}</h3>
        <div className="break-all rounded-md border border-line bg-chrome px-3.5 py-3 font-mono text-sm">
          {action ? (
            <>
              <span className="text-muted">$ </span>
              {action}
            </>
          ) : (
            a.motivo
          )}
        </div>
        {stats && <div className="font-mono text-[11px] text-muted">{stats}</div>}
        <p className="m-0 rounded-md border border-line bg-chrome px-3 py-2 font-mono text-[11px] text-muted">Diff indisponível: o pedido ainda não traz as mudanças. Abra o worktree do ticket para revisar antes de decidir.</p>
        {criteria.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h4 className="m-0 text-[13px] font-semibold">Critérios de aceite do ticket</h4>
            <ul className="m-0 flex flex-col gap-1 pl-[18px] text-[13px] leading-normal">
              {criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!decided && a.tipo === 'reprovacao' && (
        <div className="max-w-[820px]">
          <ReworkGate approval={a} large onDecide={onDecide} />
        </div>
      )}
      {!decided && a.tipo !== 'reprovacao' && (
        <div className="sticky bottom-0 flex max-w-[820px] flex-none flex-col gap-2.5 border-t border-line bg-bg pb-1 pt-3">
          {rejecting && (
            <textarea
              autoFocus
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Motivo da reprovação"
              placeholder="Motivo da reprovação — o agente recebe isto e tenta de novo"
              className="resize-y rounded-md border border-line-strong bg-raised px-3 py-2.5 text-sm"
            />
          )}
          <div className="flex items-center gap-2">
            {rejecting ? (
              <>
                <Button variant="danger" size="lg" icon={X} disabled={busy || !reason.trim()} style={{ height: 40, color: 'var(--c-danger)', background: 'var(--c-danger-wash)', borderColor: 'var(--c-danger)' }} onClick={() => void onDecide('rejeitado', reason.trim())}>
                  Reprovar
                </Button>
                <Button variant="ghost" size="lg" style={{ height: 40 }} onClick={() => setRejecting(false)}>
                  Voltar
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="lg" icon={Check} kbd="A" disabled={busy} style={{ height: 40 }} onClick={() => void onDecide('aprovado')}>
                  Aprovar
                </Button>
                <Button size="lg" kbd="R" style={{ height: 40 }} onClick={() => setRejecting(true)}>
                  Reprovar com motivo
                </Button>
              </>
            )}
            <span className="flex-1" />
            <span className="text-xs text-muted">Nada roda até você decidir.</span>
          </div>
        </div>
      )}
      {decided && (
        <div className="flex max-w-[820px] flex-none items-center gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-3 text-[13px]">
          {decided.decisao === 'aprovado' ? <Check size={16} className="text-ok" aria-hidden="true" /> : <X size={16} className="text-danger" aria-hidden="true" />}
          <span>
            {decided.decisao === 'aprovado' ? 'Você aprovou.' : 'Você reprovou.'}
            {decided.nota ? ` “${decided.nota}”` : ''}
          </span>
        </div>
      )}
    </section>
  );
}

/** Narrow screens: the whole gate on one card, 48px buttons. Reprovar asks for the reason in place. */
function MobileGate({ item: a, busy, pulse, onDecide }: { item: Item; busy: boolean; pulse: boolean; onDecide: (d: 'aprovado' | 'rejeitado', c?: string) => Promise<unknown> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const d = useTicketDetail(a.ticketId);
  const Icon = iconOf(a);
  const action = gateAction(a);
  const requester = d?.ticket.responsavel;
  const rework = a.tipo === 'reprovacao';
  const big = { height: 48, flex: 1, fontSize: 15 } as const;
  return (
    <section aria-label={`Aprovação: ${kindLabel(a)} ${a.ticketIdentificador ?? ''}`} className="overflow-hidden rounded-lg border border-accent bg-panel" style={pulse ? { animation: 'owl-pulse 0.9s var(--ease-out) 1' } : undefined}>
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-center gap-2 text-[13px]">
          <Icon size={16} className={pendingColor(a)} aria-hidden="true" />
          <span className={`font-semibold ${pendingColor(a)}`}>{kindLabel(a)}</span>
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-muted">{a.ticketIdentificador}</span>
        </div>
        <div className="text-base font-semibold leading-snug">{a.ticketTitulo ?? a.motivo}</div>
        <div className="break-all rounded-sm bg-bg px-2.5 py-2 font-mono text-xs leading-normal">
          {action ? (
            <>
              <span className="text-muted">$ </span>
              {action}
            </>
          ) : (
            a.motivo
          )}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          {requester && (
            <>
              <ProviderDot provider={d?.runs.at(-1)?.provedor} />
              {requester} ·{' '}
            </>
          )}
          risco {kindRisk(a)}
        </div>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line p-3.5">
        {(rejecting || rework) && (
          <textarea
            rows={2}
            value={rework ? comment : reason}
            onChange={(e) => (rework ? setComment(e.target.value) : setReason(e.target.value))}
            aria-label={rework ? 'Comentário da decisão' : 'Motivo da reprovação'}
            placeholder={rework ? 'Comentário para o autor' : 'Motivo da reprovação — o agente recebe isto'}
            className="resize-y rounded-md border border-line-strong bg-raised px-3 py-2.5 text-[15px]"
          />
        )}
        <div className="flex gap-2">
          {rework ? (
            <>
              <Button variant="primary" icon={Check} disabled={busy} style={big} onClick={() => void onDecide('aprovado', comment.trim() || undefined)}>
                Confirmar e refazer
              </Button>
              <Button disabled={busy || !comment.trim()} style={big} onClick={() => void onDecide('rejeitado', comment.trim())}>
                Refazer do meu jeito
              </Button>
            </>
          ) : rejecting ? (
            <>
              <Button variant="danger" icon={X} disabled={busy || !reason.trim()} style={{ ...big, color: 'var(--c-danger)', background: 'var(--c-danger-wash)', borderColor: 'var(--c-danger)' }} onClick={() => void onDecide('rejeitado', reason.trim())}>
                Reprovar
              </Button>
              <Button variant="ghost" style={{ height: 48 }} onClick={() => setRejecting(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" icon={Check} disabled={busy} style={big} onClick={() => void onDecide('aprovado')}>
                Aprovar
              </Button>
              <Button style={big} onClick={() => setRejecting(true)}>
                Reprovar…
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
