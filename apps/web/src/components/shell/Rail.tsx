import { IconButton } from '@owl/ui';
import { Bot, Brain, ChartLine, HardDrive, LayoutGrid, MessageSquare, Moon, Smartphone, SquareKanban, ShieldCheck, Sun, Users, Workflow, type LucideIcon } from 'lucide-react';

export type View = 'projects' | 'chat' | 'board' | 'queue' | 'team' | 'memory' | 'agents' | 'pipelines' | 'metrics' | 'storage' | 'pair';

interface Item {
  view: View;
  icon: LucideIcon;
  label: string;
  badge?: number;
}

/** The 56px rail. Project items change with the open project; MESA items belong to the whole desk (design: "OWL Projetos"). */
export function Rail({ view, onGo, projectMono, pending, theme, onToggleTheme }: { view: View; onGo: (v: View) => void; projectMono: string; pending: number; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const project: Item[] = [
    { view: 'chat', icon: MessageSquare, label: 'Conversas' },
    { view: 'board', icon: SquareKanban, label: 'Quadro' },
    { view: 'queue', icon: ShieldCheck, label: 'Aprovações (⌘A)', ...(pending ? { badge: pending } : {}) },
    { view: 'team', icon: Users, label: 'Equipe do projeto' },
    { view: 'memory', icon: Brain, label: 'Memória' },
  ];
  const desk: Item[] = [
    { view: 'agents', icon: Bot, label: 'Agentes' },
    { view: 'pipelines', icon: Workflow, label: 'Pipelines' },
    { view: 'metrics', icon: ChartLine, label: 'Métricas e roteador' },
  ];
  const bottom: Item[] = [
    { view: 'storage', icon: HardDrive, label: 'Lixeira e armazenamento' },
    { view: 'pair', icon: Smartphone, label: 'Pareamento' },
  ];
  const btn = (i: Item) => <IconButton key={i.view} icon={i.icon} label={i.label} active={view === i.view} {...(i.badge ? { badge: i.badge } : {})} onClick={() => onGo(i.view)} />;
  const sep = <span aria-hidden="true" className="my-1.5 h-px w-6 bg-line" />;
  const tag = (t: string) => (
    <span aria-hidden="true" className="font-mono text-[9px] tracking-[0.08em] text-faint">
      {t}
    </span>
  );
  return (
    <nav aria-label="Seções" className="flex w-14 flex-none flex-col items-center gap-1 border-r border-line bg-chrome py-2.5">
      <IconButton icon={LayoutGrid} label="Projetos" active={view === 'projects'} onClick={() => onGo('projects')} />
      {sep}
      {tag(projectMono)}
      {project.map(btn)}
      {sep}
      {tag('MESA')}
      {desk.map(btn)}
      <span className="flex-1" />
      {bottom.map(btn)}
      <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'} onClick={onToggleTheme} />
    </nav>
  );
}
