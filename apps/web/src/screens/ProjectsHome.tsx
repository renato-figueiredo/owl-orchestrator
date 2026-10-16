import { OwlEyes } from '@owl/ui';
import { GitBranch, Brain, ChartColumn, Bot, HardDrive, Kanban, MessageSquare, Plus, ShieldAlert, Users, Workflow, Folder, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NewProjectModal } from '../components/NewProjectModal';
import { mono } from '../components/shell/Vigia';
import { api } from '../lib/api';
import type { Project } from '../lib/types';

interface Props {
  projects: Project[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onCreated: (project: Project) => void;
}

/** What the server can tell about one project without opening it: open tickets, work in progress, gates waiting, git. */
interface Stats {
  open: number;
  inProgress: number;
  pending: number;
  git: boolean | null;
  branch: string | null;
}

const OWN_PROJECT: Array<{ icon: LucideIcon; t: string; d: string }> = [
  { icon: MessageSquare, t: 'Conversas', d: 'cada run roda na pasta do projeto' },
  { icon: Kanban, t: 'Quadro e tickets', d: 'ids próprios (OWL-, SITE-)' },
  { icon: Users, t: 'Equipes e papéis', d: 'o mesmo agente pode ser front aqui e revisor ali' },
  { icon: Brain, t: 'Memória', d: 'fatos de um projeto nunca vazam para outro' },
  { icon: GitBranch, t: 'Branch base e concorrência', d: 'worktrees em .owl/wt/' },
];
const OWN_DESK: Array<{ icon: LucideIcon; t: string; d: string }> = [
  { icon: Bot, t: 'Agentes', d: 'biblioteca única, convocados por projeto' },
  { icon: Workflow, t: 'Pipelines', d: 'modelos reutilizáveis' },
  { icon: ShieldAlert, t: 'Aprovações', d: 'a fila ⌘A junta todos os projetos' },
  { icon: ChartColumn, t: 'Métricas', d: 'filtráveis por projeto' },
  { icon: HardDrive, t: 'Armazenamento e backup', d: 'um SQLite para a mesa' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The "Projetos" home: one card per project, what belongs to a project and what belongs to the desk, and the "Novo projeto" flow. */
export function ProjectsHome({ projects, currentId, onOpen, onCreated }: Props) {
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [creating, setCreating] = useState(false);

  // Real counts only: from each project's board and project view. A failure leaves that card without numbers.
  useEffect(() => {
    let cancelled = false;
    for (const p of projects) {
      void Promise.all([api.board(p.id).catch(() => null), api.projectView(p.id).catch(() => null)]).then(([board, view]) => {
        if (cancelled || (!board && !view)) return;
        setStats((s) => ({
          ...s,
          [p.id]: {
            open: board ? board.tickets.filter((t) => t.status !== 'concluido').length : 0,
            inProgress: board ? board.tickets.filter((t) => t.status === 'em_andamento').length : 0,
            pending: board ? board.aprovacoes.filter((a) => a.status === 'pendente').length : 0,
            git: view ? view.git : null,
            branch: view ? (view.branchBase ?? view.branchAtual) : (p.branchBase ?? null),
          },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main aria-label="Projetos" className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-7 px-8 pb-12 pt-7">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <h1 className="m-0 text-2xl font-semibold">
              Projetos <span className="font-mono text-[13px] font-normal text-muted">{projects.length}</span>
            </h1>
            <p className="m-0 max-w-[64ch] text-sm leading-normal text-muted [text-wrap:pretty]">
              Cada projeto é uma pasta com conversas, quadro, equipes e memória próprios. Agentes, pipelines e métricas são da sua mesa toda.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-accent-fg transition-colors duration-[120ms] hover:bg-[var(--c-accent-hover)] active:translate-y-px"
          >
            <Plus size={16} aria-hidden="true" />
            Novo projeto
            <span className="font-mono text-[10px] opacity-70">⌘⇧N</span>
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-line p-6 text-muted">
            <img src="/brand/anim-idle.svg" alt="" className="size-12" />
            Nenhum projeto ainda. Crie o primeiro a partir de uma pasta.
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 p-0">
            {projects.map((p) => {
              const s = stats[p.id];
              const cur = p.id === currentId;
              const waiting = (s?.pending ?? 0) > 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    aria-label={`Abrir ${p.nome}`}
                    aria-current={cur || undefined}
                    className={`flex h-full w-full flex-col gap-3.5 rounded-lg border p-4 text-left text-fg transition-colors duration-[120ms] hover:border-line-strong ${waiting ? 'border-accent bg-accent-wash' : 'border-line bg-panel'}`}
                  >
                    <span className="flex w-full items-center gap-3">
                      <span className="grid size-10 flex-none place-items-center rounded-md border border-line bg-raised font-mono text-[13px] font-semibold">{mono(p.nome)}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className="truncate text-[15px] font-semibold">{p.nome}</span>
                        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted">
                          <Folder size={12} aria-hidden="true" className="flex-none" />
                          <span className="truncate">{p.pasta}</span>
                        </span>
                      </span>
                      {cur && <span className="owl-label text-[10px]">Aberto</span>}
                    </span>
                    <span className="flex flex-wrap gap-x-3.5 gap-y-1.5 font-mono text-[11px] text-muted">
                      {s?.git !== false && s?.branch && (
                        <span className="flex items-center gap-1">
                          <GitBranch size={12} aria-hidden="true" />
                          {s.branch}
                        </span>
                      )}
                      {s && <span>{plural(s.open, 'aberto', 'abertos')}</span>}
                    </span>
                    <span className="flex min-h-[18px] w-full items-center gap-3 border-t border-line pt-3 text-xs">
                      {!s && <span className="text-muted">…</span>}
                      {s && s.inProgress > 0 && (
                        <span className="flex items-center gap-1.5">
                          <OwlEyes />
                          {s.inProgress} em andamento
                        </span>
                      )}
                      {s && s.pending > 0 && <span className="font-semibold text-accent">▲ {s.pending === 1 ? '1 esperando você' : `${s.pending} esperando você`}</span>}
                      {s && s.git === false && <span className="text-muted">⊘ sem git · só leitura</span>}
                      {s && s.git !== false && s.inProgress === 0 && s.pending === 0 && <span className="text-muted">○ Nada rodando</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <section aria-label="O que é de cada projeto" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
          <Explainer title="DO PROJETO · TROCA COM ⌘P" rows={OWN_PROJECT} />
          <Explainer title="DA MESA · VALE PARA TODOS" rows={OWN_DESK} />
        </section>
      </div>

      {creating && (
        <NewProjectModal
          onClose={() => setCreating(false)}
          onCreated={onCreated}
          onOpen={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}
    </main>
  );
}

function Explainer({ title, rows }: { title: string; rows: Array<{ icon: LucideIcon; t: string; d: string }> }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line p-4">
      <span className="owl-label">{title}</span>
      {rows.map((o) => (
        <div key={o.t} className="flex items-baseline gap-2.5">
          <o.icon size={16} aria-hidden="true" className="flex-none self-center text-muted" />
          <span className="flex-none font-medium">{o.t}</span>
          <span className="text-xs text-muted">{o.d}</span>
        </div>
      ))}
    </div>
  );
}
