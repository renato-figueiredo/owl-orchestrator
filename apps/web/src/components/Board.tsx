import { applyFilters, FilterBar, LabelChip, NO_FILTER, OrganizePanel, type Filters } from './BoardExtras';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { fmtCost, fmtTokens } from '../lib/format';
import { ProjectSwitcher } from './ProjectSwitcher';
import { TICKET_STATUSES, type BoardData, type BranchInfo, type GateKind, type Project, type Ticket, type TicketApproval, type TicketDetail, type TicketStatus } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  pronto: 'Pronto',
  em_andamento: 'Em andamento',
  em_revisao: 'Em revisão',
  aguardando_aprovacao: 'Aguardando aprovação',
  concluido: 'Concluído',
  bloqueado: 'Bloqueado',
};
const GATE_LABEL: Record<GateKind, string> = {
  entrega: 'Entrega',
  custo: 'Custo acima do teto',
  destrutiva: 'Ação destrutiva',
  reprovacao: 'Reprovação do revisor',
  confianca: 'Baixa confiança do roteador',
};
const PRIORITY = ['', 'baixa', 'média', 'alta', 'urgente'];
const EVENT_LABEL: Record<string, string> = { criado: 'criou', status: 'moveu', atribuido: 'atribuiu', comentario: 'comentou', aprovacao: 'aprovação', execucao: 'executou', roteamento: 'roteou', aviso: 'avisou', etiqueta: 'etiquetou', relacao: 'relacionou', ciclo: 'moveu de ciclo' };

interface Props {
  project: Project;
  onClose: () => void;
  /** With these, the header offers the project selector and a link to the team screen. */
  projects?: Project[];
  onSwitch?: (id: string) => void;
  onOpenProject?: (id: string) => void;
  /** Reload interval in ms while the board is open (0 = never; tests). */
  pollMs?: number;
}

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

export function Board({ project, onClose, projects, onSwitch, onOpenProject, pollMs = 3000 }: Props) {
  const [data, setData] = useState<BoardData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<'ticket' | 'goal' | null>(null);
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
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
  const titles = useMemo(() => new Map((data?.tickets ?? []).map((t) => [t.id, t])), [data]);

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
        requerAprovacao: f.get('aprovacao') === 'on',
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

  return (
    <section aria-label={`Quadro de ${project.nome}`} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <h1 className="text-lg font-semibold">Quadro · {project.nome}</h1>
        {projects && onSwitch && projects.length > 1 && <ProjectSwitcher projects={projects} value={project.id} onChange={onSwitch} />}
        <span className="text-sm text-muted">Os agentes se falam por tickets e comentários.</span>
        {onOpenProject && (
          <button type="button" onClick={() => onOpenProject(project.id)} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
            Equipe e configurações
          </button>
        )}
        <button type="button" onClick={() => setCreating(creating === 'goal' ? null : 'goal')} aria-expanded={creating === 'goal'} className="ml-auto rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
          Novo objetivo
        </button>
        <button type="button" onClick={() => setCreating(creating === 'ticket' ? null : 'ticket')} aria-expanded={creating === 'ticket'} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Novo ticket
        </button>
        <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Voltar às conversas
        </button>
      </header>

      {error && (
        <p role="alert" className="m-4 mb-0 rounded border border-danger p-2 text-sm text-danger">
          {error}
        </p>
      )}

      {creating === 'goal' && (
        <form onSubmit={submitGoal} aria-label="Novo objetivo" className="m-4 mb-0 space-y-2 rounded border border-line bg-raised p-3 text-sm">
          <label className="block">
            Objetivo
            <textarea name="objetivo" required maxLength={20000} rows={3} placeholder="Ex.: Quero login com e-mail e senha" className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <p className="text-muted">O product owner escreve o ticket, o tech lead o quebra em subtarefas e os desenvolvedores executam. Você aprova cada entrega.</p>
          <button type="submit" disabled={busy} className="rounded bg-accent px-3 py-1.5 font-medium text-accent-fg disabled:opacity-50">
            Começar
          </button>
        </form>
      )}
      {creating === 'ticket' && (
        <form onSubmit={submitTicket} aria-label="Novo ticket" className="m-4 mb-0 grid gap-2 rounded border border-line bg-raised p-3 text-sm sm:grid-cols-2">
          <label className="block sm:col-span-2">
            Título
            <input name="titulo" required maxLength={200} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Descrição
            <textarea name="descricao" rows={3} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Critérios de aceite
            <textarea name="criterios" rows={3} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Agente responsável (nome do arquivo)
            <input name="responsavel" placeholder="dev-back" className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Teto de tokens (opcional)
            <input name="orcamento" type="number" min={1} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input name="aprovacao" type="checkbox" defaultChecked /> Exigir minha aprovação na entrega
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded bg-accent px-3 py-1.5 font-medium text-accent-fg disabled:opacity-50">
              Criar ticket
            </button>
          </div>
        </form>
      )}

      {data && <FilterBar projectId={project.id} data={data} filters={filters} onChange={setFilters} busy={busy} act={act} />}

      {data && data.aprovacoes.length > 0 && (
        <section aria-label="Fila de aprovações" className="m-4 mb-0 space-y-2 rounded border border-accent p-3">
          <h2 className="text-sm font-semibold">Aguardando você ({data.aprovacoes.length})</h2>
          {data.aprovacoes.map((a) => (
            <Gate key={a.id} approval={a} busy={busy} onOpen={() => setOpenId(a.ticketId)} onDecide={(d, c) => act(() => api.decideApproval(a.id, d, c))} />
          ))}
        </section>
      )}

      <DndContext sensors={sensors} onDragStart={() => (dragging.current = true)} onDragCancel={() => (dragging.current = false)} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4" role="list" aria-label="Colunas">
          {!data && <p className="text-sm text-muted">Carregando…</p>}
          {data &&
            TICKET_STATUSES.map((s) => (
              <Column key={s} status={s} tickets={byStatus.get(s) ?? []} titles={titles} onOpen={setOpenId} />
            ))}
        </div>
      </DndContext>

      {openId && (
        <TicketPanel
          key={openId}
          ticketId={openId}
          busy={busy}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          act={act}
          version={data}
        />
      )}
    </section>
  );
}

function Column({ status, tickets, titles, onOpen }: { status: TicketStatus; tickets: Ticket[]; titles: Map<string, Ticket>; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      aria-label={STATUS_LABEL[status]}
      className={`flex w-64 shrink-0 flex-col rounded border bg-panel ${isOver ? 'border-accent' : 'border-line'}`}
    >
      <h2 className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {STATUS_LABEL[status]}
        <span aria-label={`${tickets.length} tickets`}>{tickets.length}</span>
      </h2>
      <ul className="min-h-16 flex-1 space-y-2 overflow-y-auto p-2">
        {tickets.map((t) => (
          <Card key={t.id} ticket={t} parent={t.parentId ? titles.get(t.parentId) : undefined} onOpen={() => onOpen(t.id)} />
        ))}
      </ul>
    </div>
  );
}

function Card({ ticket: t, parent, onOpen }: { ticket: Ticket; parent: Ticket | undefined; onOpen: () => void }) {
  const drag = useDraggable({ id: t.id });
  const drop = useDroppable({ id: t.id });
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` } : undefined;
  return (
    <li
      ref={(n) => {
        drag.setNodeRef(n);
        drop.setNodeRef(n);
      }}
      style={style}
      className={`rounded border bg-raised text-sm ${drop.isOver ? 'border-accent' : 'border-line'} ${drag.isDragging ? 'z-10 opacity-80 shadow-lg' : ''}`}
    >
      <button type="button" onClick={onOpen} {...drag.attributes} {...drag.listeners} aria-label={`${t.identificador}: ${t.titulo}`} className="block w-full cursor-grab p-2 text-left">
        <span className="flex items-center justify-between text-xs text-muted">
          <span>{t.identificador}</span>
          {t.prioridade > 0 && <span>{PRIORITY[t.prioridade]}</span>}
        </span>
        <span className="mt-0.5 block font-medium">{t.titulo}</span>
        {(t.etiquetas?.length ?? 0) > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {t.etiquetas!.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </span>
        )}
        {(t.bloqueadoPor?.length ?? 0) > 0 && <span className="mt-1 block text-xs text-danger">⛔ bloqueado por {t.bloqueadoPor!.join(', ')}</span>}
        <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
          {t.estimativa != null && <span>{t.estimativa} pt</span>}
          {t.prazo && <span>até {t.prazo.split('-').reverse().join('/')}</span>}
          {parent && <span>↳ {parent.identificador}</span>}
          {t.responsavel && <span>@{t.responsavel}</span>}
          {t.uso && t.uso.runs > 0 && <span>{fmtTokens(t.uso.tokensIn + t.uso.tokensOut)} tokens</span>}
        </span>
      </button>
    </li>
  );
}

/** One approval: what is being asked, a comment box and the two buttons. Rejecting needs a comment (the agent reads it). */
function Gate({ approval: a, busy, onDecide, onOpen }: { approval: TicketApproval; busy: boolean; onDecide: (d: 'aprovado' | 'rejeitado', comentario?: string) => Promise<unknown>; onOpen?: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="rounded border border-line bg-raised p-2 text-sm">
      <p className="flex flex-wrap items-baseline gap-2">
        {a.ticketIdentificador && (
          <button type="button" onClick={onOpen} className="font-medium underline">
            {a.ticketIdentificador} {a.ticketTitulo}
          </button>
        )}
        <span className="rounded bg-user px-1.5 py-0.5 text-xs">{a.tipo ? GATE_LABEL[a.tipo] : 'Aprovação'}</span>
      </p>
      <p className="mt-1">{a.motivo}</p>
      <label className="mt-2 block">
        <span className="sr-only">Comentário da decisão</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Comentário (obrigatório para rejeitar; o agente lê)" className="block w-full rounded border border-line bg-bg px-2 py-1" />
      </label>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void onDecide('aprovado', text.trim() || undefined).then(() => setText(''))} className="rounded bg-ok px-3 py-1 font-medium text-accent-fg disabled:opacity-50">
          Aprovar
        </button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void onDecide('rejeitado', text.trim()).then(() => setText(''))} className="rounded border border-danger px-3 py-1 text-danger disabled:opacity-50">
          Rejeitar
        </button>
      </div>
    </div>
  );
}

function TicketPanel({ ticketId, busy, onClose, onOpen, act, version }: { ticketId: string; busy: boolean; onClose: () => void; onOpen: (id: string) => void; act: (fn: () => Promise<unknown>) => Promise<void>; version: BoardData | null }) {
  const [d, setD] = useState<TicketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [agent, setAgent] = useState('');

  // Reloads whenever the board reloads (new comments from the agents arrive with it).
  useEffect(() => {
    let cancelled = false;
    api
      .ticket(ticketId)
      .then((x) => !cancelled && (setD(x), setErr(null)))
      .catch((e) => !cancelled && setErr(message(e)));
    return () => {
      cancelled = true;
    };
  }, [ticketId, version]);

  if (!d) return <aside aria-label="Ticket" className="border-t border-line p-4 text-sm">{err ?? 'Carregando…'}</aside>;
  const t = d.ticket;
  const pending = d.aprovacoes.filter((a) => a.status === 'pendente');
  const running = d.runs.some((r) => r.status === 'rodando');

  return (
    <aside aria-label={`Ticket ${t.identificador}`} className="max-h-[55%] overflow-y-auto border-t border-line bg-panel p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">
          {t.identificador} · {t.titulo}
        </h2>
        <span className="rounded bg-user px-2 py-0.5 text-xs">{STATUS_LABEL[t.status]}</span>
        {running && <span className="text-xs text-muted">agente trabalhando…</span>}
        <button type="button" onClick={onClose} className="ml-auto rounded border border-line px-2 py-1 hover:bg-raised">
          Fechar
        </button>
      </div>
      {err && <p role="alert" className="mt-2 text-danger">{err}</p>}
      {d.parent && (
        <p className="mt-1 text-muted">
          Parte de{' '}
          <button type="button" className="underline" onClick={() => onOpen(d.parent!.id)}>
            {d.parent.identificador} {d.parent.titulo}
          </button>
        </p>
      )}

      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          {pending.map((a) => (
            <Gate key={a.id} approval={a} busy={busy} onDecide={(dec, c) => act(() => api.decideApproval(a.id, dec, c))} />
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {t.descricao && <Text title="Descrição" text={t.descricao} />}
          {t.criteriosAceite && <Text title="Critérios de aceite" text={t.criteriosAceite} />}
          {t.resumo && <Text title="Resumo" text={t.resumo} />}
          {d.children.length > 0 && (
            <div>
              <h3 className="font-semibold">Subtarefas</h3>
              <ul className="mt-1 space-y-1">
                {d.children.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="underline" onClick={() => onOpen(c.id)}>
                      {c.identificador} {c.titulo}
                    </button>{' '}
                    <span className="text-muted">· {STATUS_LABEL[c.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <OrganizePanel detail={d} board={version} busy={busy} act={act} onOpen={onOpen} />

          {d.branch?.branch && <BranchPanel ticketId={t.id} branch={d.branch} busy={busy} pending={pending.length > 0} running={running} act={act} />}

          <div>
            <h3 className="font-semibold">Execução</h3>
            <p className="text-muted" aria-label="Custo do ticket">
              {d.uso.runs} execução(ões) · {fmtTokens(d.uso.tokensIn + d.uso.tokensOut)} tokens · {fmtCost(d.uso.custoEstimado)}
              {t.orcamentoTokens ? ` · teto ${fmtTokens(t.orcamentoTokens)} tokens` : ''}
            </p>
            {d.runs.length > 0 && (
              <table className="mt-1 w-full text-left text-xs">
                <thead className="text-muted">
                  <tr><th>Agente</th><th>Provedor</th><th>Estado</th><th>Tokens</th><th>Custo</th></tr>
                </thead>
                <tbody>
                  {d.runs.map((r) => (
                    <tr key={r.id} title={r.erro ?? undefined}>
                      <td>{r.agente ?? '–'}</td>
                      <td>{r.provedor}</td>
                      <td>{r.status}</td>
                      <td>{fmtTokens((r.tokensIn ?? 0) + (r.tokensOut ?? 0))}</td>
                      <td>{fmtCost(r.custoEstimado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor="run-agent">Agente a executar</label>
              <input id="run-agent" value={agent} onChange={(e) => setAgent(e.target.value)} placeholder={t.responsavel ?? 'nome do agente'} className="rounded border border-line bg-bg px-2 py-1" />
              <button type="button" disabled={busy || running || pending.length > 0 || !(agent.trim() || t.responsavel)} onClick={() => void act(() => api.runTicket(t.id, agent.trim() || undefined))} className="rounded border border-line px-3 py-1 hover:bg-raised disabled:opacity-50">
                Executar agente
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="font-semibold">Comentários</h3>
            <ul className="mt-1 space-y-2">
              {d.comments.length === 0 && <li className="text-muted">Nenhum comentário.</li>}
              {d.comments.map((c) => (
                <li key={c.id} className="rounded border border-line bg-raised p-2">
                  <p className="text-xs text-muted">
                    {c.autor}
                    {c.autorTipo === 'agente' ? ' (agente)' : ''} · {c.criadoEm}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{c.texto}</p>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const texto = comment.trim();
                if (texto) void act(() => api.commentTicket(t.id, texto)).then(() => setComment(''));
              }}
            >
              <label className="sr-only" htmlFor="new-comment">Novo comentário</label>
              <input id="new-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentar como você" className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1" />
              <button type="submit" disabled={busy || !comment.trim()} className="rounded bg-accent px-3 py-1 font-medium text-accent-fg disabled:opacity-50">
                Comentar
              </button>
            </form>
          </div>

          <div>
            <h3 className="font-semibold">Histórico</h3>
            <ol className="mt-1 space-y-0.5 text-xs" aria-label="Histórico">
              {d.events.map((e) => (
                <li key={e.id}>
                  <span className="text-muted">{e.criadoEm}</span> <strong>{e.autor}</strong> {EVENT_LABEL[e.tipo] ?? e.tipo}
                  {e.de || e.para ? ` ${e.de ? `${STATUS_LABEL[e.de as TicketStatus] ?? e.de} → ` : ''}${STATUS_LABEL[e.para as TicketStatus] ?? e.para ?? ''}` : ''}
                  {e.detalhe ? ` — ${e.detalhe}` : ''}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </aside>
  );
}

const BRANCH_STATE: Record<NonNullable<BranchInfo['estado']>, string> = {
  ativo: 'worktree aberto',
  removido: 'trabalho guardado na branch',
  mesclado: 'mesclada',
  descartado: 'descartada',
};

/** The ticket's isolated work: branch, whether the folder is still open, and the two actions that need your approval. */
function BranchPanel({ ticketId, branch, busy, pending, running, act }: { ticketId: string; branch: BranchInfo; busy: boolean; pending: boolean; running: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const open = branch.estado === 'ativo' || branch.estado === 'removido';
  return (
    <div aria-label="Branch do ticket">
      <h3 className="font-semibold">Trabalho isolado</h3>
      <p className="text-muted">
        <code>{branch.branch}</code> · {branch.estado ? BRANCH_STATE[branch.estado] : ''}
        {branch.commitsAdiante != null ? ` · ${branch.commitsAdiante} commit(s) à frente de ${branch.base ?? 'a base'}` : ''}
        {branch.alterado ? ' · há alterações ainda sem commit' : ''}
      </p>
      {open && (
        <div className="mt-1 flex gap-2">
          <button type="button" disabled={busy || running || pending || !branch.commitsAdiante} onClick={() => void act(() => api.requestBranchAction(ticketId, 'merge'))} className="rounded border border-line px-3 py-1 hover:bg-raised disabled:opacity-50">
            Pedir mesclagem em {branch.base ?? 'a base'}
          </button>
          <button type="button" disabled={busy || running || pending} onClick={() => void act(() => api.requestBranchAction(ticketId, 'descartar'))} className="rounded border border-danger px-3 py-1 text-danger hover:bg-raised disabled:opacity-50">
            Descartar trabalho
          </button>
        </div>
      )}
      {open && <p className="mt-1 text-xs text-muted">Nada entra na sua branch sem a sua aprovação na fila acima.</p>}
    </div>
  );
}

function Text({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
