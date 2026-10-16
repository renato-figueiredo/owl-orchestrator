import { ListAnimated } from '@owl/ui';
import { Plus, X } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import type { Session } from '../../lib/types';

/** Conversations of the open project (or of "Sem projeto"): a 248px panel on the chrome surface, beside the chat. */
export function ConversationList({ projectName, sessions, selectedId, onSelect, onNew, onDelete }: { projectName: string; sessions: Session[]; selectedId: string | null; onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void }) {
  const listRef = useRef<HTMLElement>(null);
  // Arrow keys move between conversations; Tab still leaves the list (roving tabindex).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-session-item]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  const firstTabbable = selectedId ?? sessions[0]?.id;
  return (
    <aside aria-label="Conversas" className="flex w-[248px] flex-none flex-col border-r border-line bg-chrome">
      <div className="flex h-[52px] flex-none items-center gap-2 border-b border-line px-3">
        <h2 className="owl-label min-w-0 flex-1 truncate">{projectName}</h2>
        <button type="button" onClick={onNew} className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover">
          <Plus size={14} aria-hidden="true" />
          Nova conversa
        </button>
      </div>
      <section ref={listRef} onKeyDown={onKeyDown} className="flex-1 overflow-y-auto p-2" aria-label="Lista de conversas">
        <ListAnimated className="space-y-0.5">
          {sessions.length === 0 && <li className="px-2 py-1 text-[13px] text-muted">Nenhuma conversa</li>}
          {sessions.map((s) => (
            <li key={s.id} className="group relative">
              <button
                type="button"
                data-session-item
                tabIndex={s.id === firstTabbable ? 0 : -1}
                aria-current={s.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(s.id)}
                className={`w-full truncate rounded-md px-2 py-1.5 pr-7 text-left text-[13px] ${s.id === selectedId ? 'bg-raised font-medium' : 'text-muted hover:bg-panel hover:text-fg'}`}
              >
                {s.titulo ?? 'Nova conversa'}
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                aria-label={`Mover para a lixeira: ${s.titulo ?? 'Nova conversa'}`}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-sm text-muted opacity-0 hover:bg-bg hover:text-danger focus:opacity-100 group-hover:opacity-100"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ListAnimated>
      </section>
    </aside>
  );
}
