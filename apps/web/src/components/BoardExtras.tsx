import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { BoardData, Cycle, Label, RelationType, Ticket, TicketDetail } from '../lib/types';

type Act = (fn: () => Promise<unknown>) => Promise<void>;

const REL_LABEL: Record<RelationType, string> = { bloqueia: 'bloqueia', relacionado: 'relacionado a', duplicado: 'duplicado de' };
const REL_BACK: Record<RelationType, string> = { bloqueia: 'bloqueado por', relacionado: 'relacionado a', duplicado: 'duplicado de' };

export const cycleName = (c: Cycle) => `Ciclo ${c.numero}${c.nome ? ` · ${c.nome}` : ''}`;
const fmtDay = (d: string) => d.split('-').reverse().join('/');

/** Black or white text, whichever reads on the label color. */
const inkFor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#111111' : '#ffffff';
};

export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[11px] leading-none" style={{ background: label.cor, color: inkFor(label.cor) }}>
      {label.nome}
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
    <div className="mx-4 mt-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          Etiqueta
          <select value={filters.etiqueta} onChange={(e) => onChange({ ...filters, etiqueta: e.target.value })} className="rounded border border-line bg-bg px-2 py-1">
            <option value="">todas</option>
            {data.etiquetas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Ciclo
          <select value={filters.ciclo} onChange={(e) => onChange({ ...filters, ciclo: e.target.value })} className="rounded border border-line bg-bg px-2 py-1">
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
          <span className="text-muted" aria-label="Progresso do ciclo">
            {fmtDay(cycle.inicio)} a {fmtDay(cycle.fim)} · {done.length}/{inCycle.length} tickets · {pointsDone}/{points} pontos
          </span>
        )}
        <button type="button" onClick={() => setManaging(!managing)} aria-expanded={managing} className="ml-auto rounded border border-line px-3 py-1 hover:bg-raised">
          Etiquetas e ciclos
        </button>
      </div>

      {managing && (
        <div className="grid gap-3 rounded border border-line bg-raised p-3 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold">Etiquetas</h3>
            <ul className="flex flex-wrap gap-2">
              {data.etiquetas.length === 0 && <li className="text-muted">Nenhuma ainda.</li>}
              {data.etiquetas.map((l) => (
                <li key={l.id} className="flex items-center gap-1">
                  <LabelChip label={l} />
                  <button type="button" disabled={busy} aria-label={`Apagar etiqueta ${l.nome}`} onClick={() => void act(() => api.deleteLabel(l.id))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={newLabel} aria-label="Nova etiqueta" className="flex items-end gap-2">
              <label>
                Nome
                <input name="nome" required maxLength={40} className="mt-1 block w-36 rounded border border-line bg-bg px-2 py-1" />
              </label>
              <label>
                Cor
                <input name="cor" type="color" defaultValue="#8b8b99" className="mt-1 block h-8 w-12 rounded border border-line bg-bg" />
              </label>
              <button type="submit" disabled={busy} className="rounded border border-line px-3 py-1 hover:bg-bg disabled:opacity-50">
                Criar etiqueta
              </button>
            </form>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Ciclos</h3>
            <ul className="space-y-1">
              {data.ciclos.length === 0 && <li className="text-muted">Nenhum ainda.</li>}
              {data.ciclos.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span>
                    {cycleName(c)} <span className="text-muted">· {fmtDay(c.inicio)} a {fmtDay(c.fim)}</span>
                  </span>
                  <button type="button" disabled={busy} aria-label={`Apagar ${cycleName(c)}`} onClick={() => void act(() => api.deleteCycle(c.id))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={newCycle} aria-label="Novo ciclo" className="flex flex-wrap items-end gap-2">
              <label>
                Nome (opcional)
                <input name="nome" maxLength={80} className="mt-1 block w-32 rounded border border-line bg-bg px-2 py-1" />
              </label>
              <label>
                Início
                <input name="inicio" type="date" required className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
              </label>
              <label>
                Fim
                <input name="fim" type="date" required className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
              </label>
              <button type="submit" disabled={busy} className="rounded border border-line px-3 py-1 hover:bg-bg disabled:opacity-50">
                Criar ciclo
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** Inside the ticket panel: labels, cycle, estimate, due date and relations with other tickets. */
export function OrganizePanel({ detail: d, board, busy, act, onOpen }: { detail: TicketDetail; board: BoardData | null; busy: boolean; act: Act; onOpen: (id: string) => void }) {
  const t = d.ticket;
  const [relTarget, setRelTarget] = useState('');
  const [relType, setRelType] = useState<RelationType>('bloqueia');
  const all = board?.tickets ?? [];
  const name = (id: string) => {
    const x = all.find((k) => k.id === id);
    return x ? `${x.identificador} ${x.titulo}` : id;
  };
  const mine = new Set(d.etiquetas.map((l) => l.id));

  const saveFields = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const est = String(f.get('estimativa') ?? '').trim();
    const prazo = String(f.get('prazo') ?? '').trim();
    void act(() => api.patchTicket(t.id, { estimativa: est === '' ? null : Number(est), prazo: prazo === '' ? null : prazo }));
  };

  return (
    <section aria-label="Organização do ticket" className="space-y-3">
      <h3 className="font-semibold">Organização</h3>
      {d.bloqueadoPor.length > 0 && (
        <p role="status" className="rounded border border-danger p-2 text-danger">
          Bloqueado por{' '}
          {d.bloqueadoPor.map((b, i) => (
            <span key={b.id}>
              {i > 0 && ', '}
              <button type="button" className="underline" onClick={() => onOpen(b.id)}>
                {b.identificador}
              </button>
            </span>
          ))}
          . Nenhum agente inicia este ticket até que sejam concluídos.
        </p>
      )}

      <div>
        <p className="text-muted">Etiquetas</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {(board?.etiquetas ?? []).length === 0 && <li className="text-muted">Crie etiquetas em "Etiquetas e ciclos".</li>}
          {(board?.etiquetas ?? []).map((l) => (
            <li key={l.id}>
              <label className="flex items-center gap-1">
                <input type="checkbox" disabled={busy} checked={mine.has(l.id)} onChange={(e) => void act(() => (e.target.checked ? api.addTicketLabel(t.id, l.id) : api.removeTicketLabel(t.id, l.id)))} />
                <LabelChip label={l} />
              </label>
            </li>
          ))}
        </ul>
      </div>

      <label className="block">
        Ciclo
        <select value={t.cicloId ?? ''} disabled={busy} onChange={(e) => void act(() => api.assignCycle(t.id, e.target.value || null))} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1">
          <option value="">sem ciclo</option>
          {(board?.ciclos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {cycleName(c)}
            </option>
          ))}
        </select>
      </label>

      <form key={`${t.estimativa}-${t.prazo}`} onSubmit={saveFields} aria-label="Estimativa e prazo" className="flex flex-wrap items-end gap-2">
        <label>
          Estimativa (pontos)
          <input name="estimativa" type="number" min={0} max={1000} defaultValue={t.estimativa ?? ''} className="mt-1 block w-28 rounded border border-line bg-bg px-2 py-1" />
        </label>
        <label>
          Prazo
          <input name="prazo" type="date" defaultValue={t.prazo ?? ''} className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
        </label>
        <button type="submit" disabled={busy} className="rounded border border-line px-3 py-1 hover:bg-raised disabled:opacity-50">
          Salvar
        </button>
      </form>

      <div>
        <p className="text-muted">Relações</p>
        <ul className="mt-1 space-y-1">
          {d.relacoes.saem.length + d.relacoes.entram.length === 0 && <li className="text-muted">Nenhuma.</li>}
          {d.relacoes.saem.map((r) => (
            <li key={r.id}>
              {REL_LABEL[r.tipo]}{' '}
              <button type="button" className="underline" onClick={() => onOpen(r.relatedId)}>
                {name(r.relatedId)}
              </button>{' '}
              <button type="button" disabled={busy} aria-label={`Remover relação com ${name(r.relatedId)}`} onClick={() => void act(() => api.removeRelation(r.id))} className="text-muted hover:text-danger">
                ×
              </button>
            </li>
          ))}
          {d.relacoes.entram.map((r) => (
            <li key={r.id}>
              {REL_BACK[r.tipo]}{' '}
              <button type="button" className="underline" onClick={() => onOpen(r.ticketId)}>
                {name(r.ticketId)}
              </button>{' '}
              <button type="button" disabled={busy} aria-label={`Remover relação com ${name(r.ticketId)}`} onClick={() => void act(() => api.removeRelation(r.id))} className="text-muted hover:text-danger">
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          aria-label="Nova relação"
          onSubmit={(e) => {
            e.preventDefault();
            if (relTarget) void act(() => api.addRelation(t.id, relTarget, relType).then(() => setRelTarget('')));
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <label>
            Este ticket
            <select value={relType} onChange={(e) => setRelType(e.target.value as RelationType)} className="mt-1 block rounded border border-line bg-bg px-2 py-1">
              <option value="bloqueia">bloqueia</option>
              <option value="relacionado">é relacionado a</option>
              <option value="duplicado">é duplicado de</option>
            </select>
          </label>
          <label className="min-w-0 flex-1">
            Ticket
            <select value={relTarget} onChange={(e) => setRelTarget(e.target.value)} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1">
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
          <button type="submit" disabled={busy || !relTarget} className="rounded border border-line px-3 py-1 hover:bg-raised disabled:opacity-50">
            Relacionar
          </button>
        </form>
      </div>
    </section>
  );
}
