import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { AgentFact, AgentSummary, Project, ProjectView, Team } from '../lib/types';
import { ProjectSwitcher } from './ProjectSwitcher';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

interface Props {
  projects: Project[];
  projectId: string;
  onSwitch: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
  onOpenBoard: (id: string) => void;
}

/** A project's settings, its teams (who works on it, and in which role) and what each agent remembers in it. */
export function ProjectScreen({ projects, projectId, onSwitch, onClose, onChanged, onOpenBoard }: Props) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memoryOf, setMemoryOf] = useState<{ agente: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.projectView(projectId));
    } catch (e) {
      setError(message(e));
    }
  }, [projectId]);

  useEffect(() => {
    setView(null);
    setMemoryOf(null);
    setNotice(null);
    void load();
  }, [load]);
  useEffect(() => {
    void api.agents().then((l) => setAgents(l.agents)).catch((e) => setError(message(e)));
  }, []);

  /** Runs a change, then reloads what it may have touched. */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setError(message(e));
    } finally {
      await load();
    }
  };

  const saveSettings = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const limit = text('limite');
    void act(async () => {
      await api.updateProject(projectId, {
        nome: text('nome'),
        instrucoes: text('instrucoes') || null,
        branchBase: text('branch') || null,
        maxConcorrencia: limit ? Number(limit) : null,
      });
      onChanged();
    }, 'Projeto salvo.');
  };

  const removeProject = () => {
    if (!view) return;
    const typed = window.prompt(`Remove "${view.project.nome}" do OWL (conversas, tickets, equipes e memória). Os arquivos da pasta não são tocados.\nDigite o nome do projeto para confirmar:`);
    if (typed === null) return;
    void act(async () => {
      await api.deleteProject(projectId, typed);
      onChanged();
      onClose();
    });
  };

  const submitTeam = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const nome = String(new FormData(form).get('equipe') ?? '').trim();
    if (nome) void act(async () => { await api.createTeam(projectId, nome); form.reset(); });
  };

  if (!view) {
    return <section aria-label="Projeto" className="flex-1 p-4 text-sm">{error ?? 'Carregando…'}</section>;
  }
  const p = view.project;

  return (
    <section aria-label={`Projeto ${p.nome}`} className="min-w-0 flex-1 overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <h1 className="text-lg font-semibold">Projeto · {p.nome}</h1>
        <ProjectSwitcher projects={projects} value={projectId} onChange={onSwitch} />
        <button type="button" onClick={() => onOpenBoard(projectId)} className="ml-auto rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Abrir quadro
        </button>
        <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Voltar às conversas
        </button>
      </header>

      <div className="space-y-6 p-4 text-sm">
        {error && <p role="alert" className="rounded border border-danger p-2 text-danger">{error}</p>}
        {notice && <p role="status" className="rounded border border-line p-2 text-muted">{notice}</p>}

        <form onSubmit={saveSettings} aria-label="Configurações do projeto" className="grid gap-3 rounded border border-line bg-raised p-3 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Configurações</h2>
          <label className="block">
            Nome
            <input name="nome" required defaultValue={p.nome} maxLength={200} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <div>
            <p className="text-muted">Pasta</p>
            <p className="mt-1 break-all font-mono text-xs">{p.pasta}</p>
            <p className="mt-1 text-xs text-muted">
              {view.git ? `Repositório git · branch atual: ${view.branchAtual ?? 'HEAD solto'}` : 'Não é um repositório git: agentes que escrevem não podem trabalhar aqui (rode "git init").'}
            </p>
          </div>
          <label className="block sm:col-span-2">
            Instruções do projeto (vão no prompt de todas as execuções)
            <textarea name="instrucoes" rows={3} defaultValue={view.instrucoes ?? ''} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Branch base dos tickets
            <input name="branch" defaultValue={p.branchBase ?? ''} placeholder={view.branchAtual ?? 'main'} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
            <span className="text-xs text-muted">Vazio = a branch em uso na pasta. É nela que as mesclagens aprovadas entram.</span>
          </label>
          <label className="block">
            Execuções simultâneas neste projeto
            <input name="limite" type="number" min={1} max={16} defaultValue={p.maxConcorrencia ?? ''} placeholder={String(view.concorrencia.padraoDoServidor)} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
            <span className="text-xs text-muted">
              Vazio = padrão do servidor ({view.concorrencia.padraoDoServidor}). O limite global é {view.concorrencia.global} (OWL_CONCURRENCY) e vale para todos os projetos. Agora: {view.concorrencia.emExecucao} em execução.
            </span>
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="rounded bg-accent px-3 py-1.5 font-medium text-accent-fg">Salvar</button>
            <button type="button" onClick={removeProject} className="ml-auto rounded border border-danger px-3 py-1.5 text-danger">
              Remover projeto…
            </button>
          </div>
        </form>

        <section aria-label="Equipes" className="space-y-3">
          <h2 className="font-semibold">Equipes</h2>
          <p className="text-muted">
            Enquanto o projeto não tem ninguém em equipe nenhuma, qualquer agente da biblioteca pode trabalhar nos tickets. Com ao menos um membro, só os membros trabalham. O papel na equipe vale só neste projeto.
          </p>
          {view.equipes.length === 0 && <p className="text-muted">Nenhuma equipe ainda.</p>}
          {view.equipes.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              agents={agents}
              onRename={(nome) => act(() => api.renameTeam(t.id, nome))}
              onDelete={() => act(() => api.deleteTeam(t.id))}
              onAdd={(agente, papel) => act(() => api.setMember(t.id, agente, papel))}
              onRole={(agente, papel) => act(() => api.setMember(t.id, agente, papel))}
              onRemove={(agente) => act(() => api.removeMember(t.id, agente))}
              onMemory={(agente) => setMemoryOf({ agente })}
            />
          ))}
          <form onSubmit={submitTeam} aria-label="Nova equipe" className="flex gap-2">
            <label className="sr-only" htmlFor="new-team">Nome da equipe</label>
            <input id="new-team" name="equipe" required maxLength={100} placeholder="Nome da nova equipe" className="rounded border border-line bg-bg px-2 py-1" />
            <button type="submit" className="rounded border border-line px-3 py-1 hover:bg-raised">Criar equipe</button>
          </form>
        </section>

        {memoryOf && <AgentMemory key={memoryOf.agente} projectId={projectId} projectName={p.nome} agente={memoryOf.agente} onClose={() => setMemoryOf(null)} />}
      </div>
    </section>
  );
}

function TeamCard(props: {
  team: Team;
  agents: AgentSummary[];
  onRename: (nome: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onAdd: (agente: string, papel: string | null) => Promise<void>;
  onRole: (agente: string, papel: string | null) => Promise<void>;
  onRemove: (agente: string) => Promise<void>;
  onMemory: (agente: string) => void;
}) {
  const { team, agents } = props;
  const [name, setName] = useState(team.nome);
  const [pick, setPick] = useState('');
  const free = agents.filter((a) => !team.membros.some((m) => m.agente === a.nome));
  return (
    <div aria-label={`Equipe ${team.nome}`} className="rounded border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`team-${team.id}`}>Nome da equipe</label>
        <input id={`team-${team.id}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== team.nome && void props.onRename(name.trim())} className="rounded border border-line bg-bg px-2 py-1 font-medium" />
        <button type="button" onClick={() => void props.onDelete()} className="ml-auto rounded border border-line px-2 py-1 text-xs hover:bg-raised">
          Apagar equipe
        </button>
      </div>
      <table className="mt-2 w-full text-left">
        <thead className="text-xs text-muted">
          <tr><th>Agente</th><th>Papel nesta equipe</th><th /></tr>
        </thead>
        <tbody>
          {team.membros.length === 0 && (
            <tr><td colSpan={3} className="py-1 text-muted">Ninguém ainda.</td></tr>
          )}
          {team.membros.map((m) => {
            const own = agents.find((a) => a.nome === m.agente);
            return (
              <tr key={m.agentId}>
                <td className="py-1">
                  {m.agente}
                  {own?.papel && <span className="text-xs text-muted"> · papel do agente: {own.papel}</span>}
                </td>
                <td>
                  <label className="sr-only" htmlFor={`role-${team.id}-${m.agente}`}>Papel de {m.agente}</label>
                  <input
                    id={`role-${team.id}-${m.agente}`}
                    defaultValue={m.papel ?? ''}
                    placeholder={own?.papel ?? 'papel'}
                    onBlur={(e) => (e.target.value.trim() || null) !== m.papel && void props.onRole(m.agente, e.target.value.trim() || null)}
                    className="w-40 rounded border border-line bg-bg px-2 py-1"
                  />
                </td>
                <td className="text-right">
                  <button type="button" onClick={() => props.onMemory(m.agente)} className="rounded px-2 py-1 text-xs underline">
                    Memória
                  </button>
                  <button type="button" onClick={() => void props.onRemove(m.agente)} aria-label={`Remover ${m.agente}`} className="rounded px-2 py-1 text-xs text-danger">
                    Remover
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (pick) void props.onAdd(pick, null).then(() => setPick(''));
        }}
      >
        <label className="sr-only" htmlFor={`add-${team.id}`}>Adicionar agente</label>
        <select id={`add-${team.id}`} value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border border-line bg-bg px-2 py-1">
          <option value="">Adicionar agente…</option>
          {free.map((a) => (
            <option key={a.nome} value={a.nome}>
              {a.nome}
              {a.papel ? ` (${a.papel})` : ''}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!pick} className="rounded border border-line px-3 py-1 hover:bg-raised disabled:opacity-50">Adicionar</button>
      </form>
    </div>
  );
}

/** What one agent remembers inside this project; the same agent's memory in another project is a different list. */
function AgentMemory({ projectId, projectName, agente, onClose }: { projectId: string; projectName: string; agente: string; onClose: () => void }) {
  const [facts, setFacts] = useState<AgentFact[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.agentFacts(projectId, agente).then(setFacts).catch((e) => setError(message(e))), [projectId, agente]);
  useEffect(() => void load(), [load]);
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e) => setError(message(e))).finally(() => void load());
  };
  return (
    <section aria-label={`Memória de ${agente}`} className="rounded border border-line p-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Memória de {agente} em {projectName}</h2>
        <button type="button" onClick={onClose} className="ml-auto rounded border border-line px-2 py-1 text-xs hover:bg-raised">Fechar</button>
      </div>
      <p className="text-muted">Só este agente, só neste projeto. Fatos fixados entram no prompt dele quando trabalha num ticket daqui.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <ul className="mt-2 space-y-1">
        {facts?.length === 0 && <li className="text-muted">Nada guardado.</li>}
        {facts?.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={f.fixado} onChange={(e) => run(() => api.updateFact(f.id, { fixado: e.target.checked }))} aria-label={`Fixar: ${f.texto}`} />
              <span>{f.texto}</span>
            </label>
            <button type="button" onClick={() => run(() => api.deleteFact(f.id))} aria-label={`Apagar: ${f.texto}`} className="rounded px-2 text-xs text-danger">
              Apagar
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) run(() => api.addAgentFact(projectId, agente, t, true).then(() => setText('')));
        }}
      >
        <label className="sr-only" htmlFor="new-agent-fact">Novo fato</label>
        <input id="new-agent-fact" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Algo que este agente deve lembrar neste projeto" className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1" />
        <button type="submit" disabled={!text.trim()} className="rounded bg-accent px-3 py-1 font-medium text-accent-fg disabled:opacity-50">Guardar</button>
      </form>
    </section>
  );
}
