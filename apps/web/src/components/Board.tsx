import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Button, Input, LayoutGroup, motion, Switch, TicketCard, useMotionPreference } from '@owl/ui';
import { Plus, Settings, Target } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { fmtDay, applyFilters, cycleName, FilterBar, FIELD, NO_FILTER, type Filters } from './BoardExtras';
import { Logo } from './Logo';
import { GATE_KIND_LABEL } from './ApprovalGate';
import { prioCode, TicketScreen } from './TicketScreen';
import { TICKET_STATUSES, type BoardData, type Project, type Ticket, type TicketApproval, type TicketStatus } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

interface Props {
  project: Project;
  onClose: () => void;
  /** Kept for the callers; the project selector lives in the Vigia bar now. */
  projects?: Project[];
  onSwitch?: (id: string) => void;
  /** With this, the header offers a link to the team screen. */
  onOpenProject?: (id: string) => void;
  /** Reload interval in ms while the board is open (0 = never; tests). */
  pollMs?: number;
}

/**
 * The board in three zones by who holds the ball. The app's seven statuses map onto them: `pronto`, `em_andamento`,
 * `em_revisao` are with the agents (plus `backlog`, not started yet); `aguardando_aprovacao` (a gate waits for the human)
 * and `bloqueado` (needs unblocking by the human) are with you; `concluido` is done.
 */
const ZONES: Array<{ key: string; label: string; cols: Array<{ status: TicketStatus; label: string }> }> = [
  {
    key: 'agentes',
    label: 'Com os agentes',
    cols: [
      { status: 'backlog', label: 'Backlog' },
      { status: 'pronto', label: 'Pronto' },
      { status: 'em_andamento', label: 'Em andamento' },
      { status: 'em_revisao', label: 'Revisão' },
    ],
  },
  {
    key: 'voce',
    label: 'Com você',
    cols: [
      { status: 'aguardando_aprovacao', label: 'Aprovar' },
      { status: 'bloqueado', label: 'Destravar' },
    ],
  },
  { key: 'feito', label: 'Feito', cols: [{ status: 'concluido', label: 'Concluído' }] },
];

/** Where a card dropped on `over` goes: the column, and a float position between its neighbours (like Linear's sortOrder). */
export function dropTarget(tickets: Ticket[], dragged: string, over: string): { status: TicketStatus; ordem: number } | null {
  const rest = tickets.filter((t) => t.id !== dragged);
  const column = (s: TicketStatus) => rest.filter((t) => t.status === s).sort((a, b) => a.ordem - b.ordem);
  if (over.startsWith('col:')) {
    const status = over.slice(4) as TicketStatus;
    if (!TICKET_STATUSES.includes(status)) return null;
    const last = column(status).at(-1);
    return { status, ordem: last ? last.ordem + 1 : 1 };
  }
  const target = rest.find((t) => t.id === over);
  if (!target) return null;
  const cards = column(target.status);
  const i = cards.findIndex((t) => t.id === target.id);
  const prev = cards[i - 1];
  return { status: target.status, ordem: prev ? (prev.ordem + target.ordem) / 2 : target.ordem - 1 };
}

export function Board({ project, onOpenProject, pollMs = 3000 }: Props) {
  const [data, setData] = useState<BoardData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<'ticket' | 'goal' | null>(null);
  const [needsApproval, setNeedsApproval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const dragging = useRef(false);

  const load = useCallback(async () => {
    if (dragging.current) return; // a reload in the middle of a drag would drop the card back
    try {
      setData(await api.board(project.id));
      setError((e) => (e && e.startsWith('Não foi possível atualizar') ? null : e));
    } catch (e) {
      setError(`Não foi possível atualizar o quadro: ${message(e)}`);
    }
  }, [project.id]);

  useEffect(() => {
    setData(null);
    void load();
    if (!pollMs) return;
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space lifts a card; Enter is left to open it.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );
  const onDragEnd = (ev: DragEndEvent) => {
    dragging.current = false;
    if (!data || !ev.over) return;
    const id = String(ev.active.id);
    const to = dropTarget(data.tickets, id, String(ev.over.id));
    const card = data.tickets.find((t) => t.id === id);
    if (!to || !card || (to.status === card.status && to.ordem === card.ordem)) return;
    setData({ ...data, tickets: data.tickets.map((t) => (t.id === id ? { ...t, ...to } : t)) }); // optimistic; load() below settles it
    void act(() => api.moveTicket(id, to.status, to.ordem));
  };

  const byStatus = useMemo(() => {
    const m = new Map<TicketStatus, Ticket[]>(TICKET_STATUSES.map((s) => [s, []]));
    for (const t of applyFilters(data?.tickets ?? [], filters)) m.get(t.status)?.push(t);
    for (const list of m.values()) list.sort((a, b) => a.ordem - b.ordem);
    return m;
  }, [data, filters]);
  const byId = useMemo(() => new Map((data?.tickets ?? []).map((t) => [t.id, t])), [data]);
  const gates = useMemo(() => new Map<string, TicketApproval>((data?.aprovacoes ?? []).map((a) => [a.ticketId, a])), [data]);
  const subtasks = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of data?.tickets ?? []) {
      if (!t.parentId) continue;
      const s = m.get(t.parentId) ?? { done: 0, total: 0 };
      s.total += 1;
      if (t.status === 'concluido') s.done += 1;
      m.set(t.parentId, s);
    }
    return m;
  }, [data]);

  const submitTicket = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const budget = Number(get('orcamento'));
    void act(async () => {
      const t = await api.createTicket(project.id, {
        titulo: get('titulo'),
        ...(get('descricao') ? { descricao: get('descricao') } : {}),
        ...(get('criterios') ? { criteriosAceite: get('criterios') } : {}),
        ...(get('responsavel') ? { responsavel: get('responsavel') } : {}),
        ...(budget > 0 ? { orcamentoTokens: Math.floor(budget) } : {}),
        requerAprovacao: needsApproval,
        status: 'pronto',
      });
      setCreating(null);
      setOpenId(t.id);
    });
  };
  const submitGoal = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const objetivo = String(new FormData(e.currentTarget).get('objetivo') ?? '').trim();
    void act(async () => {
      await api.startGoal(project.id, objetivo);
      setCreating(null);
    });
  };

  const cycle = data?.ciclos.find((c) => c.id === filters.ciclo);
  const cycleDone = cycle && data ? data.tickets.filter((t) => t.cicloId === cycle.id && t.status === 'concluido').length : 0;
  const cycleTotal = cycle && data ? data.tickets.filter((t) => t.cicloId === cycle.id).length : 0;

  const errorBanner = error && (
    <p role="alert" className="mx-6 mt-4 rounded-md border border-danger bg-danger-wash p-2.5 text-[13px] text-danger">
      {error}
    </p>
  );

  if (openId)
    return (
      <section aria-label={`Quadro de ${project.nome}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {errorBanner}
        <TicketScreen key={openId} ticketId={openId} busy={busy} onBack={() => setOpenId(null)} onOpen={setOpenId} act={act} version={data} />
      </section>
    );

  return (
    <section aria-label={`Quadro de ${project.nome}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pb-3.5 pt-5">
        <div className="flex flex-col gap-1.5">
          <div className="owl-label tabular-nums">
            {cycle ? `${cycleName(cycle)} · ${fmtDay(cycle.inicio)} → ${fmtDay(cycle.fim)} · ${cycleDone}/${cycleTotal}` : project.nome}
          </div>
          <h1 className="m-0 text-2xl font-semibold leading-tight">Quadro</h1>
        </div>
        <span className="flex-1" />
        {onOpenProject && (
          <Button icon={Settings} onClick={() => onOpenProject(project.id)}>
            Equipe e configurações
          </Button>
        )}
        <Button icon={Target} aria-expanded={creating === 'goal'} onClick={() => setCreating(creating === 'goal' ? null : 'goal')}>
          Novo objetivo
        </Button>
        <Button icon={Plus} aria-expanded={creating === 'ticket'} onClick={() => setCreating(creating === 'ticket' ? null : 'ticket')}>
          Novo ticket
        </Button>
      </header>

      {errorBanner}

      {creating === 'goal' && (
        <form onSubmit={submitGoal} aria-label="Novo objetivo" className="mx-6 mt-4 flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 text-[13px]" style={{ animation: 'owl-fade-in var(--dur) var(--ease-out)' }}>
          <Input label="Objetivo" name="objetivo" multiline rows={3} required autoFocus placeholder="Ex.: Quero login com e-mail e senha" />
          <p className="m-0 text-muted">O product owner escreve o ticket, o tech lead o quebra em subtarefas e os desenvolvedores executam. Você aprova cada entrega.</p>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              Começar
            </Button>
          </div>
        </form>
      )}
      {creating === 'ticket' && (
        <form onSubmit={submitTicket} aria-label="Novo ticket" className="mx-6 mt-4 grid gap-3 rounded-lg border border-line bg-panel p-4 text-[13px] sm:grid-cols-2" style={{ animation: 'owl-fade-in var(--dur) var(--ease-out)' }}>
          <div className="sm:col-span-2">
            <Input label="Título" name="titulo" required autoFocus />
          </div>
          <Input label="Descrição" name="descricao" multiline rows={3} />
          <Input label="Critérios de aceite" name="criterios" multiline rows={3} />
          <Input label="Agente responsável (nome do arquivo)" name="responsavel" placeholder="dev-back" mono />
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Teto de tokens (opcional)
            <input name="orcamento" type="number" min={1} className={`${FIELD} h-[var(--h-ctl)] font-mono`} />
          </label>
          <div className="sm:col-span-2">
            <Switch checked={needsApproval} onChange={setNeedsApproval} label="Exigir minha aprovação na entrega" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Criar ticket
            </Button>
          </div>
        </form>
      )}

      {data && <FilterBar projectId={project.id} data={data} filters={filters} onChange={setFilters} busy={busy} act={act} />}

      <DndContext sensors={sensors} onDragStart={() => (dragging.current = true)} onDragCancel={() => (dragging.current = false)} onDragEnd={onDragEnd}>
        {!data && (
          <p className="m-6 flex items-center gap-2 text-[13px] text-muted">
            <Logo size={24} blink /> Carregando…
          </p>
        )}
        {data && (
          <LayoutGroup>
            <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-auto px-5 py-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(150px,170px)]">
              {ZONES.map((z) => {
                const count = z.cols.reduce((n, c) => n + (byStatus.get(c.status)?.length ?? 0), 0);
                const mine = z.key === 'voce';
                return (
                  <section
                    key={z.key}
                    aria-label={z.label}
                    className={`flex min-w-0 flex-col gap-3 rounded-lg border p-3 ${mine ? 'order-first border-accent bg-accent-wash xl:order-none' : 'border-line'}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <h2 className={`m-0 text-base font-semibold ${mine ? 'text-accent' : z.key === 'feito' ? 'text-ok' : ''}`}>{z.label}</h2>
                      <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
                    </div>
                    {z.key === 'feito' ? (
                      <DoneColumn tickets={byStatus.get('concluido') ?? []} onOpen={setOpenId} />
                    ) : (
                      <div className="flex min-h-0 flex-1 gap-2.5">
                        {z.cols.map((c) => (
                          <Column
                            key={c.status}
                            status={c.status}
                            label={c.label}
                            tickets={byStatus.get(c.status) ?? []}
                            byId={byId}
                            gates={gates}
                            subtasks={subtasks}
                            onOpen={setOpenId}
                          />
                        ))}
                      </div>
                    )}
                    {mine && count === 0 && <p className="m-0 text-[13px] text-muted">Nada esperando você</p>}
                  </section>
                );
              })}
            </div>
          </LayoutGroup>
        )}
      </DndContext>
    </section>
  );
}

function Column({
  status,
  label,
  tickets,
  byId,
  gates,
  subtasks,
  onOpen,
}: {
  status: TicketStatus;
  label: string;
  tickets: Ticket[];
  byId: Map<string, Ticket>;
  gates: Map<string, TicketApproval>;
  subtasks: Map<string, { done: number; total: number }>;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <div ref={setNodeRef} role="group" aria-label={label} className={`flex min-w-0 flex-1 flex-col gap-2 rounded-md ${isOver ? 'outline outline-1 outline-offset-2 outline-accent' : ''}`}>
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">
        {label} <span aria-label={`${tickets.length} tickets`} className="font-mono font-normal tabular-nums">{tickets.length}</span>
      </h3>
      <ul className="m-0 flex min-h-16 flex-1 list-none flex-col gap-2 p-0">
        {tickets.map((t) => (
          <Card key={t.id} ticket={t} parent={t.parentId ? byId.get(t.parentId) : undefined} gate={gates.get(t.id)} sub={subtasks.get(t.id)} onOpen={() => onOpen(t.id)} />
        ))}
      </ul>
    </div>
  );
}

function Card({ ticket: t, parent, gate, sub, onOpen }: { ticket: Ticket; parent: Ticket | undefined; gate: TicketApproval | undefined; sub: { done: number; total: number } | undefined; onOpen: () => void }) {
  const drag = useDraggable({ id: t.id });
  const drop = useDroppable({ id: t.id });
  const { reduced } = useMotionPreference();
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` } : undefined;
  const prio = prioCode(t.prioridade);
  const meta = [
    sub ? `${sub.done}/${sub.total} sub` : '',
    parent ? `↳ ${parent.identificador}` : '',
    t.estimativa != null ? `${t.estimativa} pt` : '',
    t.prazo ? `até ${t.prazo.split('-').reverse().join('/')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const { onKeyDown: dragKeyDown, ...listeners } = drag.listeners ?? {};
  // The <li> carries Motion's shared-layout travel between columns (layoutId); the inner box carries dnd-kit's drag
  // transform, so the two never fight over the same `transform`. Reduced motion: the card just appears in place.
  return (
    <motion.li
      {...(reduced ? { layout: false } : { layoutId: t.id, layout: 'position' as const })}
      transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.8 }}
    >
      <div
        ref={(n) => {
          drag.setNodeRef(n);
          drop.setNodeRef(n);
        }}
        style={style}
        aria-roledescription="item arrastável"
        aria-describedby={drag.attributes['aria-describedby']}
        {...listeners}
        onKeyDown={(e) => {
          dragKeyDown?.(e);
          if (e.key === 'Enter') onOpen();
        }}
        className={`touch-none rounded-md ${drop.isOver ? 'outline outline-1 outline-offset-2 outline-accent' : ''} ${drag.isDragging ? 'relative z-10 opacity-80' : ''}`}
      >
        <TicketCard
          id={t.identificador}
          title={t.titulo}
          {...(prio ? { priority: prio } : {})}
          labels={(t.etiquetas ?? []).map((l) => l.nome)}
          agent={t.responsavel}
          running={t.status === 'em_andamento'}
          {...(meta ? { subtasks: meta } : {})}
          {...(gate ? { gate: gate.tipo ? GATE_KIND_LABEL[gate.tipo] : 'Aprovação' } : {})}
          {...((t.bloqueadoPor?.length ?? 0) > 0 ? { blockedBy: t.bloqueadoPor!.join(', ') } : {})}
          onClick={onOpen}
        />
      </div>
    </motion.li>
  );
}

/** The done zone: a compact list, and the place to drop a card to finish it. */
function DoneColumn({ tickets, onOpen }: { tickets: Ticket[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'col:concluido' });
  return (
    <div ref={setNodeRef} role="group" aria-label="Concluído" className={`flex min-h-16 flex-1 flex-col gap-1 rounded-md font-mono text-[11px] text-muted ${isOver ? 'outline outline-1 outline-offset-2 outline-accent' : ''}`}>
      {tickets.length === 0 && <span className="font-sans text-[13px]">Nada concluído ainda.</span>}
      {tickets.map((t) => (
        <button key={t.id} type="button" onClick={() => onOpen(t.id)} aria-label={`${t.identificador}: ${t.titulo}`} title={t.titulo} className="flex gap-1.5 bg-transparent py-[3px] text-left text-muted hover:text-fg">
          <span aria-hidden="true" className="text-ok">
            ✓
          </span>
          {t.identificador}
        </button>
      ))}
    </div>
  );
}
