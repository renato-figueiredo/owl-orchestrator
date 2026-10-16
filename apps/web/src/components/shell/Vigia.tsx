import { OwlEyes, ProviderDot } from '@owl/ui';
import { ChevronsUpDown, ShieldCheck, ShieldAlert } from 'lucide-react';
import { fmtClock } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { Logo } from '../Logo';
import { MonitorToggle } from './MonitorToggle';

export interface LiveRun {
  id: string;
  agent: string;
  provider: string | null;
  /** Ticket identifier or conversation title, shown muted after the agent. */
  label: string;
  startedAt: number;
  status: 'running' | 'queued';
  onOpen: () => void;
}

interface Props {
  project: { nome: string; branch?: string | null } | null;
  onOpenSwitcher: () => void;
  switcherOpen: boolean;
  live: LiveRun[];
  pending: number;
  onOpenQueue: () => void;
}

/** The "Vigia" bar (44px): the owl's watch over everything alive, plus the amber button for what waits for you (⌘A). */
export function Vigia({ project, onOpenSwitcher, switcherOpen, live, pending, onOpenQueue }: Props) {
  const now = useNow(live.length > 0);
  return (
    <header className="flex h-11 flex-none items-center gap-3 border-b border-line bg-chrome pl-4 pr-3">
      <Logo size={24} />
      <span className="font-mono text-xs font-semibold tracking-[0.14em]">OWL</span>
      <span className="h-5 w-px bg-line" />
      <button
        type="button"
        onClick={onOpenSwitcher}
        aria-haspopup="listbox"
        aria-expanded={switcherOpen}
        aria-label="Trocar de projeto"
        className="flex h-[30px] flex-none items-center gap-2 rounded-md border border-line bg-panel pl-1 pr-2 text-[13px] font-medium hover:border-line-strong hover:bg-raised"
      >
        <span className="grid size-[22px] place-items-center rounded-sm bg-raised font-mono text-[10px] font-semibold">{project ? mono(project.nome) : '—'}</span>
        <span>{project?.nome ?? 'Sem projeto'}</span>
        {project?.branch && <span className="font-mono text-[11px] font-normal text-muted">{project.branch}</span>}
        <ChevronsUpDown size={14} className="text-muted" aria-hidden="true" />
      </button>
      <span className="owl-label flex-none">Vigia</span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-hidden" aria-live="polite">
        {live.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={r.onOpen}
            className="flex h-7 flex-none items-center gap-2 rounded-md border border-line bg-panel px-2.5 font-mono text-[11px] hover:border-line-strong"
          >
            {r.status === 'running' ? <OwlEyes /> : <span aria-hidden="true" className="box-border size-2 rounded-full border-[1.5px] border-muted" />}
            <ProviderDot provider={r.provider} />
            <span>{r.agent}</span>
            <span className="text-muted">{r.label}</span>
            <span className="tabular-nums text-muted">{fmtClock((now - r.startedAt) / 1000)}</span>
          </button>
        ))}
      </div>
      <MonitorToggle />
      {pending > 0 ? (
        <button
          type="button"
          onClick={onOpenQueue}
          className="flex h-7 flex-none items-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <ShieldAlert size={14} aria-hidden="true" />
          {pending === 1 ? '1 esperando você' : `${pending} esperando você`}
          <span className="font-mono text-[10px] opacity-75">⌘A</span>
        </button>
      ) : (
        <button type="button" onClick={onOpenQueue} className="flex h-7 flex-none items-center gap-2 rounded-md border border-line px-3 text-xs text-muted hover:text-fg">
          <ShieldCheck size={14} aria-hidden="true" />
          Nada esperando você
        </button>
      )}
    </header>
  );
}

/** Two-letter monogram: "owl-site" → "OS", "owl" → "OW" (initials of the first two words, else the first two letters). */
export const mono = (nome: string) => {
  const words = nome.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || '—';
};
