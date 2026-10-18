import { Button } from '@owl/ui';
import { ArrowRight, FolderOpen, FolderPlus, GitFork, Link, MessageSquare, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { Project } from '../lib/types';
import { field } from './desk/ScreenHeader';
import { EMPTY_GIT, GitOriginForm, gitReady, type GitOrigin, type GitOriginValue } from './GitOriginForm';

interface Props {
  onClose: () => void;
  onCreated: (project: Project) => void;
  /** After step 3: open the project that was just created. */
  onOpen: (id: string) => void;
}

const ORIGINS: Array<{ id: 'folder' | 'github' | 'url' | 'empty'; icon: LucideIcon; title: string; text: string; off?: string }> = [
  { id: 'folder', icon: FolderOpen, title: 'Pasta no computador', text: 'Um projeto que já está na sua máquina.' },
  { id: 'github', icon: GitFork, title: 'GitHub', text: 'Escolher um repositório e clonar.' },
  { id: 'url', icon: Link, title: 'URL git', text: 'GitLab, Bitbucket, servidor próprio.' },
  { id: 'empty', icon: FolderPlus, title: 'Começar vazio', text: 'Pasta nova com git init.' },
];
const STEPS = ['Origem', 'Configurar', 'Pronto'];
const baseName = (path: string) => path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

/** "Novo projeto" in three steps (design: OWL Projetos): an existing folder, a GitHub repository or git URL to clone, or a new empty folder. */
export function NewProjectModal({ onClose, onCreated, onOpen }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [path, setPath] = useState('');
  const [nome, setNome] = useState('');
  const [instrucoes, setInstrucoes] = useState('');
  const [origin, setOrigin] = useState<'folder' | GitOrigin>('folder');
  const [git, setGit] = useState<GitOriginValue>(EMPTY_GIT);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [created, setCreated] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    dialog.current?.querySelector<HTMLElement>('input,button:not(:disabled)')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const next = async (e?: FormEvent) => {
    e?.preventDefault();
    if (step === 1) {
      if (origin === 'folder') {
        if (!path.trim()) return;
        setNome((n) => n || baseName(path));
        setStep(2);
        return;
      }
      if (!gitReady(origin, git)) return;
      setBusy(true);
      setError(null);
      try {
        const made =
          origin === 'github'
            ? await api.gitClone({ origem: 'github', repo: git.repo, pasta: git.parent, nome: git.nome })
            : origin === 'url'
              ? await api.gitClone({ origem: 'url', url: git.url.trim(), pasta: git.parent, nome: git.nome })
              : await api.gitInit(git.parent, git.nome);
        setPath(made.pasta);
        setNome(made.nome);
        setStep(2);
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
    } else if (step === 2) {
      if (!nome.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const project = await api.createProject({ nome: nome.trim(), pasta: path.trim(), ...(instrucoes.trim() ? { instrucoes: instrucoes.trim() } : {}) });
        setCreated(project);
        onCreated(project);
        // A new folder that should also exist on GitHub: only the request is made here; a person approves it.
        if (origin === 'empty' && git.publicar) {
          try {
            const r = await api.projectGitPublish(project.id, { nome: baseName(path), visibilidade: git.visibilidade });
            setPublishNote(`Pedi a sua aprovação para criar o repositório ${git.visibilidade === 'publico' ? 'público' : 'privado'} no GitHub (${r.ticket.identificador}). Ele só é criado depois que você aprovar.`);
          } catch (err) {
            setPublishNote(`O projeto foi criado, mas não consegui pedir a criação no GitHub: ${message(err)}`);
          }
        }
        setStep(3);
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
    }
  };

  const disabled = (step === 1 && (origin === 'folder' ? !path.trim() : !gitReady(origin, git))) || (step === 2 && !nome.trim());

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-[rgba(0,4,31,0.72)] p-6">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Novo projeto" className="flex h-[min(640px,100%)] w-full max-w-[940px] overflow-hidden rounded-lg border border-line-strong bg-panel [animation:owl-fade-in_250ms_ease-out] [box-shadow:var(--shadow-overlay)]">
        <aside className="hidden w-52 flex-none flex-col gap-[18px] border-r border-line bg-chrome px-4 py-5 sm:flex">
          <span className="text-[15px] font-semibold">Novo projeto</span>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {STEPS.map((t, i) => {
              const k = i + 1;
              const on = k === step;
              const done = k < step;
              return (
                <li key={t} aria-current={on ? 'step' : undefined} className={`flex h-[34px] items-center gap-2.5 rounded-md px-2 ${on ? 'bg-raised text-fg' : done ? 'text-fg' : 'text-muted'}`}>
                  <span className={`grid size-5 place-items-center rounded-sm border font-mono text-[11px] ${on ? 'border-accent text-accent' : done ? 'border-line text-ok' : 'border-line text-muted'}`}>{done ? '✓' : k}</span>
                  {t}
                </li>
              );
            })}
          </ol>
          <span className="flex-1" />
          <div className="flex flex-col gap-1.5 text-xs leading-normal text-muted">
            <span className="owl-label text-[10px]">Raízes permitidas</span>
            <span>OWL_WORKSPACE_ROOTS. Fora delas, nenhum agente escreve.</span>
          </div>
        </aside>

        <form onSubmit={(e) => void next(e)} className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-6 py-[22px]">
            {step === 1 && (
              <>
                <div className="flex flex-col gap-1">
                  <h2 className="m-0 text-lg font-semibold">De onde vem o código?</h2>
                  <p className="m-0 text-muted">O OWL trabalha numa pasta local.</p>
                </div>
                <div role="group" aria-label="Origem" className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
                  {ORIGINS.map((o) => {
                    const on = o.id === origin;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={!!o.off}
                        aria-pressed={on}
                        onClick={() => {
                          setOrigin(o.id);
                          setError(null);
                        }}
                        aria-describedby={o.off ? `origin-${o.id}` : undefined}
                        className={`flex flex-col items-start gap-2 rounded-md border p-3 text-left text-fg transition-colors duration-[120ms] enabled:hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-accent bg-accent-wash' : 'border-line bg-bg'}`}
                      >
                        <o.icon size={18} aria-hidden="true" className={on ? 'text-accent' : 'text-muted'} />
                        <span className="font-semibold">{o.title}</span>
                        <span id={`origin-${o.id}`} className="text-xs leading-snug text-muted">
                          {o.off ?? o.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {origin === 'folder' ? (
                  <label className="flex flex-col gap-1.5 text-xs text-muted">
                    Caminho da pasta
                    <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/code/meu-projeto" autoComplete="off" spellCheck={false} className={`${field} h-9 bg-bg font-mono`} />
                    <span>A pasta precisa existir e estar dentro das raízes permitidas. O servidor confere ao criar.</span>
                  </label>
                ) : (
                  <GitOriginForm origin={origin} value={git} onChange={setGit} />
                )}
                {error && step === 1 && (
                  <p role="alert" className="m-0 text-[13px] text-danger">
                    {error}
                  </p>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-col gap-1">
                  <h2 className="m-0 text-lg font-semibold">Configurar</h2>
                  <p className="m-0 font-mono text-xs text-muted">{path.trim()}</p>
                </div>
                <label className="flex flex-col gap-1.5 text-xs text-muted">
                  Nome
                  <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} required className={`${field} h-9 bg-bg`} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs text-muted">
                  Instruções do projeto
                  <textarea value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} rows={4} className="resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] leading-normal text-fg outline-none focus:border-accent" />
                  <span>Vão no prompt de todas as execuções deste projeto. Opcional.</span>
                </label>
                <p className="m-0 text-xs leading-normal text-muted">Equipe, branch base e execuções simultâneas ficam na tela Equipe do projeto, depois de criar.</p>
                {error && (
                  <p role="alert" className="m-0 text-[13px] text-danger">
                    {error}
                  </p>
                )}
              </>
            )}

            {step === 3 && created && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <img src="/brand/anim-done.svg" alt="" className="size-24" />
                <div className="flex flex-col gap-1.5">
                  <span className="text-xl font-semibold">{created.nome} está no OWL</span>
                  <span className="text-muted">Quadro vazio, memória vazia.</span>
                  {publishNote && <span role="status" className="mx-auto max-w-[460px] text-xs leading-normal text-muted">{publishNote}</span>}
                </div>
                <Button type="button" variant="primary" size="lg" icon={MessageSquare} onClick={() => onOpen(created.id)}>
                  Abrir projeto
                </Button>
              </div>
            )}
          </div>

          {step !== 3 && (
            <div className="flex flex-none items-center gap-2 border-t border-line px-6 py-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <span className="flex-1 text-right text-xs text-muted">{step === 2 ? 'Nada roda até você abrir uma conversa ou mover um ticket.' : ''}</span>
              {step === 2 && (
                <Button type="button" onClick={() => setStep(1)}>
                  Voltar
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={disabled} loading={busy}>
                {step === 2 ? 'Criar projeto' : origin === 'folder' ? 'Continuar' : origin === 'empty' ? 'Criar pasta e continuar' : 'Clonar e continuar'}
                <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
