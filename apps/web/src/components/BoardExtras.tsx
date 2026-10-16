import { Button, Input } from '@owl/ui';
import { Filter, Link2, Lock, Tag, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { BoardData, Cycle, Label, RelationType, Ticket, TicketDetail } from '../lib/types';

type Act = (fn: () => Promise<unknown>) => Promise<void>;

const REL_LABEL: Record<RelationType, string> = { bloqueia: 'bloqueia', relacionado: 'relacionado a', duplicado: 'duplicado de' };
const REL_BACK: Record<RelationType, string> = { bloqueia: 'bloqueado por', relacionado: 'relacionado a', duplicado: 'duplicado de' };

export const cycleName = (c: Cycle) => `Ciclo ${c.numero}${c.nome ? ` · ${c.nome}` : ''}`;
export const fmtDay = (d: string) => d.split('-').reverse().join('/');

/** Shared look of selects, number and date fields (the text fields use `Input` from @owl/ui). */
export const FIELD = 'h-8 rounded-md border border-line bg-raised px-2 text-[13px] text-fg hover:border-line-strong';
const SMALL_LABEL = 'flex flex-col gap-1.5 text-xs font-medium';

/** A label as the design writes it: `#nome`, mono. The swatch carries the colour the user chose. */
export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
      <span aria-hidden="true" className="inline-block size-2 rounded-sm" style={{ background: label.cor }} />#{label.nome}
    </span>
  );
}

export interface Filters {
  etiqueta: string;
  ciclo: string; // '' = all, 'none' = tickets without a cycle
}
export const NO_FILTER: Filters = { etiqueta: '', ciclo: '' };

export function applyFilters(tickets: Ticket[], f: Filters): Ticket[] {
  return tickets.filter(
    (t) => (!f.etiqueta || (t.etiquetas ?? []).some((l) => l.id === f.etiqueta)) && (!f.ciclo || (f.ciclo === 'none' ? !t.cicloId : t.cicloId === f.ciclo)),
  );
}

/** Filter by label and cycle, with the progress of the chosen cycle and the forms that create labels and cycles. */
export function FilterBar({ projectId, data, filters, onChange, busy, act }: { projectId: string; data: BoardData; filters: Filters; onChange: (f: Filters) => void; busy: boolean; act: Act }) {
  const [managing, setManaging] = useState(false);
  const cycle = data.ciclos.find((c) => c.id === filters.ciclo);
  const inCycle = cycle ? data.tickets.filter((t) => t.cicloId === cycle.id) : [];
  const done = inCycle.filter((t) => t.status === 'concluido');
  const points = inCycle.reduce((s, t) => s + (t.estimativa ?? 0), 0);
  const pointsDone = done.reduce((s, t) => s + (t.estimativa ?? 0), 0);

  const newLabel = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void act(async () => {
      await api.createLabel(projectId, String(f.get('nome') ?? '').trim(), String(f.get('cor') ?? '#8b8b99'));
      form.reset();
    });
  };
  const newCycle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const nome = String(f.get('nome') ?? '').trim();
    void act(async () => {
      await api.createCycle(projectId, { ...(nome ? { nome } : {}), inicio: String(f.get('inicio')), fim: String(f.get('fim')) });
      form.reset();
    });
  };

  return (
    <div className="space-y-3 border-b border-line px-6 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <Filter size={16} className="text-muted" aria-hidden="true" />
        <label className="flex items-center gap-2 text-muted">
          Etiqueta
          <select value={filters.etiqueta} onChange={(e) => onChange({ ...filters, etiqueta: e.target.value })} className={`${FIELD} text-fg`}>
            <option value="">todas</option>
            {data.etiquetas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-muted">
          Ciclo
          <select value={filters.ciclo} onChange={(e) => onChange({ ...filters, ciclo: e.target.value })} className={`${FIELD} text-fg`}>
            <option value="">todos</option>
            <option value="none">sem ciclo</option>
            {data.ciclos.map((c) => (
              <option key={c.id} value={c.id}>
                {cycleName(c)}
              </option>
            ))}
          </select>
        </label>
        {cycle && (
          <span className="font-mono text-[11px] tabular-nums text-muted" aria-label="Progresso do ciclo">
            {fmtDay(cycle.inicio)} a {fmtDay(cycle.fim)} · {done.length}/{inCycle.length} tickets · {pointsDone}/{points} pontos
          </span>
        )}
        <span className="flex-1" />
        <Button size="sm" icon={Tag} aria-expanded={managing} onClick={() => setManaging(!managing)}>
          Etiquetas e ciclos
        </Button>
      </div>

      {managing && (
        <div className="grid gap-6 rounded-lg border border-line bg-panel p-4 md:grid-cols-2" style={{ animation: 'owl-fade-in var(--dur) var(--ease-out)' }}>
          <div className="space-y-3">
            <h3 className="owl-label m-0 font-medium">Etiquetas</h3>
            <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
              {data.etiquetas.length === 0 && <li className="text-muted">Nenhuma ainda.</li>}
              {data.etiquetas.map((l) => (
                <li key={l.id} className="flex items-center gap-1">
                  <LabelChip label={l} />
                  <button type="button" disabled={busy} aria-label={`Apagar etiqueta ${l.nome}`} onClick={() => void act(() => api.deleteLabel(l.id))} className="grid size-6 place-items-center rounded-sm text-muted hover:bg-danger-wash hover:text-danger">
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={newLabel} aria-label="Nova etiqueta" className="flex items-end gap-2">
              <Input label="Nome" name="nome" required />
              <label className={SMALL_LABEL}>
                Cor
                <input name="cor" type="color" defaultValue="#8b8b99" className={`${FIELD} w-12 p-1`} />
              </label>
              <Button type="submit" disabled={busy}>
                Criar etiqueta
              </Button>
            </form>
          </div>
          <div className="space-y-3">
            <h3 className="owl-label m-0 font-medium">Ciclos</h3>
            <ul className="m-0 list-none space-y-1 p-0">
              {data.ciclos.length === 0 && <li className="text-muted">Nenhum ainda.</li>}
              {data.ciclos.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span>
                    {cycleName(c)} <span className="font-mono text-[11px] text-muted">· {fmtDay(c.inicio)} a {fmtDay(c.fim)}</span>
                  </span>
                  <button type="button" disabled={busy} aria-label={`Apagar ${cycleName(c)}`} onClick={() => void act(() => api.deleteCycle(c.id))} className="grid size-6 place-items-center rounded-sm text-muted hover:bg-danger-wash hover:text-danger">
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={newCycle} aria-label="Novo ciclo" className="flex flex-wrap items-end gap-2">
              <Input label="Nome (opcional)" name="nome" />
              <label className={SMALL_LABEL}>
                Início
                <input name="inicio" type="date" required className={FIELD} />
              </label>
              <label className={SMALL_LABEL}>
                Fim
                <input name="fim" type="date" required className={FIELD} />
              </label>
              <Button type="submit" disabled={busy}>
                Criar ciclo
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const SECTION = 'owl-label m-0 font-medium';

/** In the ticket side column: labels, cycle, estimate, due date and relations with other tickets. */
export function OrganizePanel({ detail: d, board, busy, act, onOpen }: { detail: TicketDetail; board: BoardData | null; busy: boolean; act: Act; onOpen: (id: string) => void }) {
  const t = d.ticket;
  const [relTarget, setRelTarget] = useState('');
  const [relType, setRelType] = useState<RelationType>('bloqueia');
  const all = board?.tickets ?? [];
  const find = (id: string) => all.find((k) => k.id === id);
  const mine = new Set(d.etiquetas.map((l) => l.id));

  const saveFields = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const est = String(f.get('estimativa') ?? '').trim();
    const prazo = String(f.get('prazo') ?? '').trim();
    void act(() => api.patchTicket(t.id, { estimativa: est === '' ? null : Number(est), prazo: prazo === '' ? null : prazo }));
  };

  const relRow = (id: string, other: string, kind: string, relId: string) => {
    const x = find(other);
    const label = x ? `${x.identificador} ${x.titulo}` : other;
    return (
      <li key={relId} className="flex items-start gap-1">
        <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left text-fg hover:text-accent" onClick={() => onOpen(other)}>
          <span className="text-[11px] text-muted">{kind}</span>
          <span className="text-xs">
            <span className="font-mono">{x?.identificador ?? other}</span> {x?.titulo ?? ''}
          </span>
          <span className="sr-only">{label}</span>
        </button>
        <button type="button" disabled={busy} aria-label={`Remover relação com ${label}`} onClick={() => void act(() => api.removeRelation(relId))} className="grid size-6 flex-none place-items-center rounded-sm text-muted hover:bg-danger-wash hover:text-danger">
          <X size={12} aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <section aria-label="Organização do ticket" className="flex flex-col gap-4 text-[13px]">
      {d.bloqueadoPor.length > 0 && (
        <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-line bg-raised p-2.5 text-xs text-muted">
          <Lock size={14} className="mt-px flex-none" aria-hidden="true" />
          <span>
            Bloqueado por{' '}
            {d.bloqueadoPor.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ', '}
                <button type="button" className="font-mono text-fg underline" onClick={() => onOpen(b.id)}>
                  {b.identificador}
                </button>
              </span>
            ))}
            . Nenhum agente inicia este ticket até que sejam concluídos.
          </span>
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className={SECTION}>Etiquetas</h3>
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
          {(board?.etiquetas ?? []).length === 0 && <li className="text-xs text-muted">Crie etiquetas em "Etiquetas e ciclos".</li>}
          {(board?.etiquetas ?? []).map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" disabled={busy} checked={mine.has(l.id)} onChange={(e) => void act(() => (e.target.checked ? api.addTicketLabel(t.id, l.id) : api.removeTicketLabel(t.id, l.id)))} className="size-4 accent-[var(--c-accent)]" />
                <LabelChip label={l} />
              </label>
            </li>
          ))}
        </ul>
      </div>

      <label className={SMALL_LABEL}>
        <span className="font-normal text-muted">Ciclo</span>
        <select value={t.cicloId ?? ''} disabled={busy} onChange={(e) => void act(() => api.assignCycle(t.id, e.target.value || null))} className={FIELD}>
          <option value="">sem ciclo</option>
          {(board?.ciclos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {cycleName(c)}
            </option>
          ))}
        </select>
      </label>

      <form key={`${t.estimativa}-${t.prazo}`} onSubmit={saveFields} aria-label="Estimativa e prazo" className="flex flex-wrap items-end gap-2">
        <label className={SMALL_LABEL}>
          <span className="font-normal text-muted">Estimativa (pontos)</span>
          <input name="estimativa" type="number" min={0} max={1000} defaultValue={t.estimativa ?? ''} className={`${FIELD} w-28 font-mono`} />
        </label>
        <label className={SMALL_LABEL}>
          <span className="font-normal text-muted">Prazo</span>
          <input name="prazo" type="date" defaultValue={t.prazo ?? ''} className={`${FIELD} font-mono`} />
        </label>
        <Button type="submit" size="sm" disabled={busy}>
          Salvar
        </Button>
      </form>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className={SECTION}>Relações</h3>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {d.relacoes.saem.length + d.relacoes.entram.length === 0 && <li className="text-xs text-muted">Nenhuma.</li>}
          {d.relacoes.saem.map((r) => relRow(r.id, r.relatedId, REL_LABEL[r.tipo], r.id))}
          {d.relacoes.entram.map((r) => relRow(r.id, r.ticketId, REL_BACK[r.tipo], r.id))}
        </ul>
        <form
          aria-label="Nova relação"
          onSubmit={(e) => {
            e.preventDefault();
            if (relTarget) void act(() => api.addRelation(t.id, relTarget, relType).then(() => setRelTarget('')));
          }}
          className="flex flex-col gap-2"
        >
          <label className={SMALL_LABEL}>
            <span className="font-normal text-muted">Este ticket</span>
            <select value={relType} onChange={(e) => setRelType(e.target.value as RelationType)} className={FIELD}>
              <option value="bloqueia">bloqueia</option>
              <option value="relacionado">é relacionado a</option>
              <option value="duplicado">é duplicado de</option>
            </select>
          </label>
          <label className={SMALL_LABEL}>
            <span className="font-normal text-muted">Ticket</span>
            <select value={relTarget} onChange={(e) => setRelTarget(e.target.value)} className={`${FIELD} w-full`}>
              <option value="">escolha…</option>
              {all
                .filter((k) => k.id !== t.id)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.identificador} {k.titulo}
                  </option>
                ))}
            </select>
          </label>
          <Button type="submit" size="sm" icon={Link2} disabled={busy || !relTarget}>
            Relacionar
          </Button>
        </form>
      </div>
    </section>
  );
}

