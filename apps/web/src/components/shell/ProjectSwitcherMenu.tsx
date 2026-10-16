import { Search, LayoutGrid, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../lib/types';
import { mono } from './Vigia';

/** ⌘P overlay under the Vigia: filter, pick a project (or "Sem projeto"), jump to all projects or create one. */
export function ProjectSwitcherMenu({ projects, currentId, onPick, onAll, onNew, onClose }: { projects: Project[]; currentId: string | null; onPick: (id: string | null) => void; onAll: () => void; onNew: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const list = projects.filter((p) => !q.trim() || p.nome.toLowerCase().includes(q.trim().toLowerCase()));
  const row = 'flex items-center gap-2.5 rounded-md p-2 text-left hover:bg-raised';
  return (
    <>
      <div onClick={onClose} className="absolute inset-x-0 bottom-0 top-11 z-[6]" aria-hidden="true" />
      <div role="listbox" aria-label="Trocar de projeto" className="absolute left-[108px] top-12 z-[7] w-[380px] overflow-hidden rounded-lg border border-line-strong bg-overlay" style={{ boxShadow: 'var(--shadow-overlay)', animation: 'owl-fade-in var(--dur) ease-out' }}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search size={14} className="text-muted" aria-hidden="true" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Trocar de projeto…" aria-label="Buscar projeto" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          <kbd className="rounded-sm border border-line px-1.5 text-[10px] text-muted">⌘P</kbd>
        </div>
        <div className="flex flex-col gap-0.5 p-1.5">
          {list.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={p.id === currentId} onClick={() => onPick(p.id)} className={`${row} ${p.id === currentId ? 'bg-raised' : ''}`}>
              <span className="grid size-7 flex-none place-items-center rounded-md border border-line bg-raised font-mono text-[11px] font-semibold">{mono(p.nome)}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{p.nome}</span>
                <span className="truncate font-mono text-[11px] text-muted">{p.pasta}</span>
              </span>
              {i < 9 && <span className="w-[22px] text-right font-mono text-[10px] text-faint">⌘{i + 1}</span>}
            </button>
          ))}
          {!q.trim() && (
            <button type="button" role="option" aria-selected={currentId === null} onClick={() => onPick(null)} className={`${row} ${currentId === null ? 'bg-raised' : ''}`}>
              <span className="grid size-7 flex-none place-items-center rounded-md border border-line bg-raised font-mono text-[11px] font-semibold">—</span>
              <span className="font-medium">Sem projeto</span>
            </button>
          )}
        </div>
        <div className="flex gap-1 border-t border-line p-1.5">
          <button type="button" onClick={onAll} className="flex h-8 flex-1 items-center gap-2 rounded-md px-2.5 hover:bg-raised">
            <LayoutGrid size={14} className="text-muted" aria-hidden="true" />
            Todos os projetos
          </button>
          <button type="button" onClick={onNew} className="flex h-8 flex-1 items-center gap-2 rounded-md px-2.5 hover:bg-raised">
            <Plus size={14} className="text-accent" aria-hidden="true" />
            Novo projeto…
          </button>
        </div>
      </div>
    </>
  );
}
