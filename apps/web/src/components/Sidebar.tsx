import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Project, Session } from '../lib/types';
import { Logo } from './Logo';
import { StorageSettings } from './StorageSettings';
import { TrashPanel } from './TrashPanel';

interface Props {
  projects: Project[];
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSession: (projectId?: string) => void;
  onDeleteSession: (id: string) => void;
  /** Bumped when a conversation went to the trash, so the trash list reloads. */
  trashVersion: number;
  onRestored: () => void;
  onCreateProject: (input: { nome: string; pasta: string; instrucoes?: string }) => Promise<void>;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenAgents: () => void;
}

export function Sidebar({ projects, sessions, selectedId, onSelect, onNewSession, onDeleteSession, trashVersion, onRestored, onCreateProject, theme, onToggleTheme, onOpenAgents }: Props) {
  const listRef = useRef<HTMLElement>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arrow keys move between sessions; Tab still leaves the list (roving tabindex).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-session-item]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const instrucoes = String(f.get('instrucoes') ?? '').trim();
    try {
      await onCreateProject({
        nome: String(f.get('nome') ?? '').trim(),
        pasta: String(f.get('pasta') ?? '').trim(),
        ...(instrucoes ? { instrucoes } : {}),
      });
      setAdding(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o projeto');
    }
  };

  const groups: { key: string; title: string; projectId?: string; items: Session[] }[] = [
    ...projects.map((p) => ({ key: p.id, title: p.nome, projectId: p.id, items: sessions.filter((s) => s.projectId === p.id) })),
    { key: 'none', title: 'Sem projeto', items: sessions.filter((s) => !s.projectId || !projects.some((p) => p.id === s.projectId)) },
  ];
  const firstTabbable = selectedId ?? sessions[0]?.id;

  return (
    <nav aria-label="Projetos e conversas" className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 p-3">
        <Logo />
        <span className="text-lg font-semibold tracking-wide">OWL</span>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          className="ml-auto rounded border border-line px-2 py-1 text-sm hover:bg-raised"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div className="flex gap-2 px-3 pb-2">
        <button type="button" onClick={() => onNewSession()} className="flex-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
          Nova conversa
        </button>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Projeto +
        </button>
      </div>

      {adding && (
        <form onSubmit={(e) => void submit(e)} className="mx-3 mb-2 space-y-2 rounded border border-line bg-raised p-2 text-sm">
          <label className="block">
            Nome
            <input name="nome" required maxLength={200} className="mt-1 w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Pasta do projeto
            <input name="pasta" required placeholder="/home/…/meu-projeto" className="mt-1 w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Instruções (opcional)
            <textarea name="instrucoes" rows={3} className="mt-1 w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <button type="submit" className="rounded bg-accent px-3 py-1 font-medium text-accent-fg">
            Criar projeto
          </button>
        </form>
      )}

      <section ref={listRef} onKeyDown={onKeyDown} className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversas">
        {groups.map((g) =>
          g.key === 'none' && g.items.length === 0 ? null : (
            <div key={g.key} className="mt-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
                {g.projectId && (
                  <button type="button" onClick={() => onNewSession(g.projectId)} aria-label={`Nova conversa em ${g.title}`} className="rounded px-1.5 text-muted hover:bg-raised hover:text-fg">
                    +
                  </button>
                )}
              </div>
              <ul className="mt-1 space-y-0.5">
                {g.items.length === 0 && <li className="px-2 py-1 text-sm text-muted">Nenhuma conversa</li>}
                {g.items.map((s) => (
                  <li key={s.id} className="group relative">
                    <button
                      type="button"
                      data-session-item
                      tabIndex={s.id === firstTabbable ? 0 : -1}
                      aria-current={s.id === selectedId ? 'true' : undefined}
                      onClick={() => onSelect(s.id)}
                      className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${s.id === selectedId ? 'bg-raised font-medium ring-1 ring-line' : 'hover:bg-raised'}`}
                    >
                      {s.titulo ?? 'Nova conversa'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(s.id)}
                      aria-label={`Mover para a lixeira: ${s.titulo ?? 'Nova conversa'}`}
                      className="absolute right-1 top-1 rounded px-1.5 text-muted opacity-0 hover:bg-bg hover:text-danger focus:opacity-100 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </section>
      <div className="border-t border-line px-3 py-2">
        <button type="button" onClick={onOpenAgents} className="w-full rounded border border-line px-3 py-1.5 text-left text-sm hover:bg-raised">
          Agentes
        </button>
      </div>
      <TrashPanel version={trashVersion} onRestored={onRestored} />
      <StorageSettings />
    </nav>
  );
}
