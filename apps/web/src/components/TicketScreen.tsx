import { AgentTag, Button, ListAnimated, OwlEyes } from '@owl/ui';
import { ArrowLeft, GitBranch, GitMerge, Play, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { fmtCompact, fmtUsd } from '../lib/format';
import type { BoardData, BranchInfo, TicketDetail, TicketRun, TicketStatus } from '../lib/types';
import { ApprovalGate } from './ApprovalGate';
import { LabelChip, OrganizePanel } from './BoardExtras';
import { Markdown } from './Markdown';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

export const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  pronto: 'Pronto',
  em_andamento: 'Em andamento',
  em_revisao: 'Em revisão',
  aguardando_aprovacao: 'Aguardando aprovação',
  concluido: 'Concluído',
  bloqueado: 'Bloqueado',
};
/** Status shape (text always travels with it). Em andamento is the owl's eyes. */
const STATUS_GLYPH: Record<TicketStatus, { glyph: string; cls: string }> = {
  backlog: { glyph: '○', cls: 'text-muted' },
  pronto: { glyph: '○', cls: 'text-muted' },
  em_andamento: { glyph: '', cls: 'text-fg' },
  em_revisao: { glyph: '◐', cls: 'text-fg' },
  aguardando_aprovacao: { glyph: '▲', cls: 'text-accent' },
  bloqueado: { glyph: '⊘', cls: 'text-muted' },
  concluido: { glyph: '✓', cls: 'text-ok' },
};
const EVENT_LABEL: Record<string, string> = { criado: 'criou', status: 'moveu', atribuido: 'atribuiu', comentario: 'comentou', aprovacao: 'aprovação', execucao: 'executou', roteamento: 'roteou', aviso: 'avisou', etiqueta: 'etiquetou', relacao: 'relacionou', ciclo: 'moveu de ciclo', estimativa: 'estimou', prazo: 'definiu o prazo' };
const RUN_STATE: Record<string, { glyph: string; label: string; cls: string }> = {
  ok: { glyph: '✓', label: 'ok', cls: 'text-ok' },
  erro: { glyph: '✕', label: 'erro', cls: 'text-danger' },
  rodando: { glyph: '', label: 'rodando', cls: 'text-fg' },
  cancelado: { glyph: '—', label: 'cancelado', cls: 'text-muted' },
};
const BRANCH_STATE: Record<NonNullable<BranchInfo['estado']>, string> = {
  ativo: 'worktree aberto',
  removido: 'trabalho guardado na branch',
  mesclado: 'mesclada',
  descartado: 'descartada',
};

/** Ticket priority (1 baixa … 4 urgente) as the design's P1 (most urgent) … P3. */
export const prioCode = (n: number): 'P1' | 'P2' | 'P3' | undefined => (n >= 4 ? 'P1' : n === 3 ? 'P2' : n > 0 ? 'P3' : undefined);

export function StatusGlyph({ status }: { status: TicketStatus }) {
  const g = STATUS_GLYPH[status];
  return status === 'em_andamento' ? <OwlEyes /> : <span aria-hidden="true" className={`w-2.5 text-center font-mono text-[11px] ${g.cls}`}>{g.glyph}</span>;
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, as stored) → local "HH:MM". */
const fmtTime = (criadoEm: string) => {
  const ms = Date.parse(`${criadoEm.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? criadoEm : new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const usage = (tokens: number, cost: number) => `${fmtCompact(tokens)} tok · ${fmtUsd(cost)}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[820px] flex-none flex-col gap-2.5">
      <h2 className="owl-label m-0 font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Long text (ticket descriptions, agent comments) folds to a few lines with a toggle, so the page stays readable. */
function Clamp({ children, lines = 8 }: { children: ReactNode; lines?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > lines * 24 + 8);
  }, [children, lines]);
  return (
    <div className="flex flex-col items-start gap-1">
      <div ref={ref} className="w-full overflow-hidden" style={open || !long ? undefined : { maxHeight: `${lines * 1.5}rem` }}>
        {children}
      </div>
      {long && (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="font-mono text-[11px] text-muted underline hover:text-fg">
          {open ? 'ver menos' : 'ver mais'}
        </button>
      )}
    </div>
  );
}

/** A list from free text: one item per line, without the bullet or number the author typed. */
const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);

interface Props {
  ticketId: string;
  busy: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  /** The board data; the detail reloads whenever it does (new comments from the agents arrive with it). */
  version: BoardData | null;
}

/** Ticket detail (design "Ticket"): description, criteria, gate inline, runs, activity; properties and relations on the right. */
export function TicketScreen({ ticketId, busy, onBack, onOpen, act, version }: Props) {
  const [d, setD] = useState<TicketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [agent, setAgent] = useState('');

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

  const back = (
    <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} style={{ paddingLeft: 0 }}>
      Quadro
    </Button>
  );
  if (!d)
    return (
      <div aria-label="Ticket" className="flex-1 p-10 text-[13px] text-muted">
        {back}
        <p>{err ?? 'Carregando…'}</p>
      </div>
    );

  const t = d.ticket;
  const pending = d.aprovacoes.filter((a) => a.status === 'pendente');
  const running = d.runs.some((r) => r.status === 'rodando');
  const prio = prioCode(t.prioridade);
  const lastRun = d.runs.at(-1);
  const provider = lastRun?.provedor;
  const gateStats = d.uso.runs > 0 ? usage(d.uso.tokensIn + d.uso.tokensOut, d.uso.custoEstimado) : undefined;
  const criteria = t.criteriosAceite ? lines(t.criteriosAceite) : [];
  const provOf = (r: TicketRun) => r.provedor;

  const runsDesc = [...d.runs].reverse();
  const commentsDesc = [...d.comments].reverse();
  const eventsDesc = [...d.events].reverse();

  return (
    <div role="region" aria-label={`Ticket ${t.identificador}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto xl:flex-row xl:overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-5 px-6 pb-10 pt-4 xl:overflow-auto xl:px-8">
        <div className="flex items-center gap-2 text-xs text-muted">
          {back}
          <span>/</span>
          <span className="font-mono">{t.identificador}</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs text-muted">
            <span className="rounded-sm border border-line px-1.5 py-0.5">{t.identificador}</span>
            <span role="status" className="flex h-[22px] items-center gap-1.5 rounded-sm bg-raised px-2 font-sans text-xs text-fg">
              <StatusGlyph status={t.status} />
              <span className={t.status === 'aguardando_aprovacao' ? 'text-accent' : ''}>{STATUS_LABEL[t.status].toLowerCase()}</span>
            </span>
            {prio && <span className={prio === 'P1' ? 'text-fg' : ''}>{prio}</span>}
            {running && <span className="font-sans">agente trabalhando…</span>}
          </div>
          <h1 className="m-0 max-w-[820px] text-xl font-semibold leading-snug">{t.titulo}</h1>
          {d.parent && (
            <p className="m-0 text-xs text-muted">
              Parte de{' '}
              <button type="button" className="font-mono text-fg underline" onClick={() => onOpen(d.parent!.id)}>
                {d.parent.identificador}
              </button>{' '}
              {d.parent.titulo}
            </p>
          )}
        </div>

        {err && (
          <p role="alert" className="m-0 max-w-[820px] rounded-md border border-danger bg-danger-wash p-2.5 text-[13px] text-danger">
            {err}
          </p>
        )}

        {pending.length > 0 && (
          <div className="flex max-w-[820px] flex-none flex-col gap-3">
            {pending.map((a) => (
              <ApprovalGate
                key={a.id}
                approval={{ ...a, ticketIdentificador: a.ticketIdentificador ?? t.identificador }}
                {...(gateStats ? { stats: gateStats } : {})}
                requester={t.responsavel}
                provider={provider}
                onDecide={(dec, c, conf, l) => act(() => api.decideApproval(a.id, dec, c, conf, l))}
              />
            ))}
          </div>
        )}

        <section aria-label="Ações" className="flex max-w-[820px] flex-none flex-col gap-2 rounded-lg border border-line bg-panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="run-agent">
              Agente a executar
            </label>
            <input id="run-agent" value={agent} onChange={(e) => setAgent(e.target.value)} placeholder={t.responsavel ?? 'nome do agente'} className="h-8 w-40 rounded-md border border-line bg-raised px-2.5 font-mono text-xs hover:border-line-strong" />
            <Button icon={Play} disabled={busy || running || pending.length > 0 || !(agent.trim() || t.responsavel)} onClick={() => void act(() => api.runTicket(t.id, agent.trim() || undefined))}>
              Executar agente
            </Button>
            <span className="flex-1" />
            <span className="font-mono text-[11px] tabular-nums text-muted" aria-label="Custo do ticket">
              {d.uso.runs} {d.uso.runs === 1 ? 'execução' : 'execuções'} · {usage(d.uso.tokensIn + d.uso.tokensOut, d.uso.custoEstimado)}
              {t.orcamentoTokens ? ` · teto ${fmtCompact(t.orcamentoTokens)} tok` : ''}
            </span>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const texto = comment.trim();
              if (texto) void act(() => api.commentTicket(t.id, texto)).then(() => setComment(''));
            }}
          >
            <label className="sr-only" htmlFor="new-comment">
              Novo comentário
            </label>
            <input id="new-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comentar como você" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 text-[13px] hover:border-line-strong" />
            <Button type="submit" variant="primary" icon={Send} disabled={busy || !comment.trim()}>
              Comentar
            </Button>
          </form>
        </section>

        <Section title="Descrição">
          {t.descricao ? (
            <Clamp lines={10}>
              <div className="text-[13px] leading-relaxed">
                <Markdown>{t.descricao}</Markdown>
              </div>
            </Clamp>
          ) : (
            <p className="m-0 text-[13px] text-muted">Sem descrição.</p>
          )}
          {criteria.length > 0 && (
            <>
              <h3 className="m-0 mt-2 text-[13px] font-semibold">Critérios de aceite</h3>
              <ul className="m-0 flex flex-col gap-1 pl-[18px] text-[13px] leading-normal">
                {criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {t.resumo && (
            <>
              <h3 className="m-0 mt-2 text-[13px] font-semibold">Resumo</h3>
              <Clamp lines={6}>
                <div className="text-[13px] leading-relaxed">
                  <Markdown>{t.resumo}</Markdown>
                </div>
              </Clamp>
            </>
          )}
        </Section>

        {d.children.length > 0 && (
          <Section title="Subtarefas">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {d.children.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)} className="flex w-full items-center gap-2.5 rounded-md border border-line bg-panel px-3 py-2 text-left text-[13px] hover:border-line-strong hover:bg-raised">
                    <StatusGlyph status={c.status} />
                    <span className="font-mono text-xs">{c.identificador}</span>
                    <span className="min-w-0 flex-1 truncate">{c.titulo}</span>
                    <span className="text-xs text-muted">{STATUS_LABEL[c.status].toLowerCase()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={`Comentários (${d.comments.length})`}>
          <Paged items={commentsDesc} size={5} label="comentários" empty="Nenhum comentário.">
            {(list) => (
              <ListAnimated className="m-0 flex list-none flex-col gap-2 p-0">
                {list.map((c) => (
                  <li key={c.id} className="rounded-md border border-line bg-panel p-3">
                    <p className="m-0 mb-1 text-xs text-muted">
                      <span className="font-mono text-fg">{c.autor}</span>
                      {c.autorTipo === 'agente' ? ' (agente)' : ''} · <span className="font-mono">{fmtTime(c.criadoEm)}</span>
                    </p>
                    <Clamp lines={6}>
                      <div className="text-[13px] leading-normal">
                        <Markdown>{c.texto}</Markdown>
                      </div>
                    </Clamp>
                  </li>
                ))}
              </ListAnimated>
            )}
          </Paged>
        </Section>

        <section className="flex max-w-[820px] flex-none flex-col gap-2.5">
          <h2 className="owl-label m-0 font-medium">Atividade</h2>
          <Paged items={eventsDesc} size={8} label="eventos" empty="Nada ainda.">
            {(list) => (
              <ol aria-label="Atividade" className="m-0 flex list-none flex-col p-0">
                {list.map((e) => (
                  <li key={e.id} className="grid grid-cols-[52px_1fr] gap-3 border-t border-line py-1.5 text-[13px] leading-normal">
                    <span className="pt-0.5 font-mono text-[11px] text-muted">{fmtTime(e.criadoEm)}</span>
                    <span>
                      <span className="font-mono text-xs">{e.autor}</span>{' '}
                      <span className="text-muted">
                        {EVENT_LABEL[e.tipo] ?? e.tipo}
                        {e.de || e.para ? ` ${e.de ? `${STATUS_LABEL[e.de as TicketStatus]?.toLowerCase() ?? e.de} → ` : ''}${STATUS_LABEL[e.para as TicketStatus]?.toLowerCase() ?? e.para ?? ''}` : ''}
                        {e.detalhe ? ` — ${e.detalhe}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Paged>
        </section>
      </div>

      <aside aria-label="Propriedades do ticket" className="flex w-full flex-none flex-col gap-4 border-t border-line bg-panel px-[18px] py-5 xl:w-[340px] xl:overflow-auto xl:border-l xl:border-t-0">
        <div className="flex flex-col gap-2">
          <h2 className="owl-label m-0 font-medium">Execuções</h2>
          <Paged items={runsDesc} size={5} label="execuções" empty="Nenhuma execução ainda.">
            {(list) => (
              <div className="flex flex-col gap-1.5">
                {list.map((r) => {
                  const st = RUN_STATE[r.status] ?? { glyph: '', label: r.status, cls: 'text-muted' };
                  return (
                    <div key={r.id} title={r.erro ?? undefined} className="flex flex-col gap-1 rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <AgentTag name={r.agente ?? '–'} provider={provOf(r)} />
                        <span className={`flex items-center gap-1.5 ${st.cls}`}>
                          {r.status === 'rodando' ? <OwlEyes /> : st.glyph}
                          {st.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-muted">
                        <span className="truncate">{r.etapa ?? r.modelo ?? ''}</span>
                        <span className="tabular-nums">{r.tokensIn == null && r.tokensOut == null ? '–' : usage((r.tokensIn ?? 0) + (r.tokensOut ?? 0), r.custoEstimado ?? 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Paged>
        </div>

        <div className="grid grid-cols-[88px_1fr] items-center gap-x-2 gap-y-2.5 border-t border-line pt-4 text-xs">
          <span className="text-muted">Responsável</span>
          {t.responsavel ? <AgentTag name={t.responsavel} provider={provider} running={running} /> : <span className="font-mono text-[11px] text-muted">sem responsável</span>}
          <span className="text-muted">Prioridade</span>
          <span className="font-mono text-[11px]">{prio ?? '—'}</span>
          <span className="text-muted">Estimativa</span>
          <span className="font-mono text-[11px]">{t.estimativa != null ? `${t.estimativa} pt` : '—'}</span>
          {d.etiquetas.length > 0 && (
            <>
              <span className="text-muted">Etiquetas</span>
              <span className="flex flex-wrap gap-x-2">
                {d.etiquetas.map((l) => (
                  <LabelChip key={l.id} label={l} />
                ))}
              </span>
            </>
          )}
          <span className="text-muted">Uso</span>
          <span className="font-mono text-[11px] tabular-nums">{d.uso.runs > 0 ? usage(d.uso.tokensIn + d.uso.tokensOut, d.uso.custoEstimado) : '—'}</span>
        </div>

        {d.branch?.branch && <BranchPanel ticketId={t.id} branch={d.branch} busy={busy} pending={pending.length > 0} running={running} act={act} />}

        <OrganizePanel detail={d} board={version} busy={busy} act={act} onOpen={onOpen} />
      </aside>
    </div>
  );
}

/** Newest first, a few at a time: the list stays short however long the history is. */
function Paged<T>({ items, size, label, empty, children }: { items: T[]; size: number; label: string; empty: string; children: (page: T[]) => ReactNode }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(page, pages - 1);
  if (items.length === 0) return <p className="m-0 text-[13px] text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-2">
      {children(items.slice(at * size, at * size + size))}
      {pages > 1 && (
        <nav aria-label={`Páginas de ${label}`} className="flex items-center gap-2 font-mono text-[11px] text-muted">
          <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className="rounded-sm border border-line px-2 py-0.5 enabled:hover:text-fg disabled:opacity-40">
            ← mais novos
          </button>
          <span className="tabular-nums">
            {at + 1} / {pages}
          </span>
          <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className="rounded-sm border border-line px-2 py-0.5 enabled:hover:text-fg disabled:opacity-40">
            mais antigos →
          </button>
        </nav>
      )}
    </div>
  );
}

/** The ticket's isolated work: branch, whether the folder is still open, and the two actions that need your approval. */
function BranchPanel({ ticketId, branch, busy, pending, running, act }: { ticketId: string; branch: BranchInfo; busy: boolean; pending: boolean; running: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const open = branch.estado === 'ativo' || branch.estado === 'removido';
  return (
    <div aria-label="Branch do ticket" className="flex flex-col gap-1.5 border-t border-line pt-4">
      <span className="owl-label">Worktree</span>
      <span className="flex items-center gap-1.5 font-mono text-xs">
        <GitBranch size={14} aria-hidden="true" />
        <code>{branch.branch}</code>
      </span>
      <span className="font-mono text-[11px] text-muted">
        {branch.estado ? BRANCH_STATE[branch.estado] : ''}
        {branch.commitsAdiante != null ? ` · ${branch.commitsAdiante} commit(s) à frente de ${branch.base ?? 'a base'}` : ''}
        {branch.alterado ? ' · há alterações ainda sem commit' : ''}
      </span>
      {open && (
        <div className="mt-1 flex flex-col gap-2">
          <Button icon={GitMerge} disabled={busy || running || pending || !branch.commitsAdiante} onClick={() => void act(() => api.requestBranchAction(ticketId, 'merge'))}>
            Pedir mesclagem em {branch.base ?? 'a base'}
          </Button>
          <Button variant="danger" icon={Trash2} disabled={busy || running || pending} onClick={() => void act(() => api.requestBranchAction(ticketId, 'descartar'))}>
            Descartar trabalho
          </Button>
          <p className="m-0 text-xs text-muted">Nada entra na sua branch sem a sua aprovação.</p>
        </div>
      )}
    </div>
  );
}
