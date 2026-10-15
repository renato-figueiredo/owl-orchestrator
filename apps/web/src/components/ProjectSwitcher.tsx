import type { Project } from '../lib/types';

/** Picks the project the board or the team screen is about. */
export function ProjectSwitcher({ projects, value, onChange }: { projects: Project[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Projeto</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Projeto" className="rounded border border-line bg-bg px-2 py-1">
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
