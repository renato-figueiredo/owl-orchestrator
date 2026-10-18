import { useTabStatus } from './lib/tab-status';
import { useCallback, useEffect, useState } from 'react';
import { parseHash, pushView } from './lib/nav';
import { AgentLibrary } from './components/AgentLibrary';
import { Board } from './components/Board';
import { Pairing } from './components/Pairing';
import { Chat } from './components/Chat';
import { MemoryPanel } from './components/MemoryPanel';
import { MetricsPanel } from './components/MetricsPanel';
import { ProjectScreen } from './components/ProjectScreen';
import { RunPanel } from './components/RunPanel';
import { ConversationList } from './components/shell/ConversationList';
import { ProjectSwitcherMenu } from './components/shell/ProjectSwitcherMenu';
import { Rail, type View } from './components/shell/Rail';
import { Vigia, mono, type LiveRun } from './components/shell/Vigia';
import { ApprovalsQueue } from './screens/ApprovalsQueue';
import { MemoryScreen } from './screens/MemoryScreen';
import { PairScreen } from './screens/PairScreen';
import { PipelinesScreen } from './screens/PipelinesScreen';
import { ProjectsHome } from './screens/ProjectsHome';
import { StorageScreen } from './screens/StorageScreen';
import { api, type SendInput } from './lib/api';
import type { LiveRunInfo, Fact, MemorySettings, Project, ProviderInfo, RefinerInfo, Session, SessionDetail, SummarizeResult } from './lib/types';
import { useRunStream } from './lib/useRunStream';
import { useTheme } from './lib/useTheme';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

/** Opens the app once the server accepts this browser (see `SessionAuth`); servers without auth open at once. */
export function App() {
  const [needsPairing, setNeedsPairing] = useState<boolean | null>(null);
  useEffect(() => {
    void api.authNeeded().then(setNeedsPairing);
  }, []);
  if (needsPairing === null) return null;
  if (needsPairing) return <Pairing onDone={() => setNeedsPairing(false)} />;
  return <Workspace />;
}

function Workspace() {
  const [theme, toggleTheme] = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [refiner, setRefiner] = useState<RefinerInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [memSettings, setMemSettings] = useState<MemorySettings | null>(null);
  const [memBusy, setMemBusy] = useState(false);
  const [memMessage, setMemMessage] = useState<string | null>(null);
  const [trashVersion, setTrashVersion] = useState(0);
  const [view, setView] = useState<View>('chat');
  // The browser's Back/Forward walk the screens: each change of view is a history entry, and a pop sets the view from the address.
  useEffect(() => pushView(view), [view]);
  useEffect(() => {
    const onPop = () => setView(parseHash().view ?? 'chat');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  /** The open project (null = "Sem projeto"). Conversations, board, team and memory all follow it. */
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [approvalsVersion, setApprovalsVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    const d = await api.session(id);
    setDetail(d);
    return d;
  }, []);
  const refreshSessions = useCallback(() => api.sessions().then(setSessions), []);

  useEffect(() => {
    Promise.all([api.projects(), api.sessions(), api.providers()])
      .then(([p, s, pr]) => {
        setProjects(p);
        setSessions(s);
        setProviders(pr);
      })
      .then(() => api.refiner().then(setRefiner).catch(() => setRefiner(null))) // optional: chat works without it
      .then(() => api.settings().then(setMemSettings).catch(() => setMemSettings(null)))
      .catch((e) => setError(message(e)));
  }, []);

  // Open a session: load its history and, if a run is still going (e.g. after a page reload), follow it again.
  useEffect(() => {
    setDetail(null);
    setActiveRunId(null);
    if (!selectedId) return;
    let cancelled = false;
    loadDetail(selectedId)
      .then((d) => {
        if (cancelled) return;
        const running = d.runs.find((r) => r.status === 'rodando');
        if (running) setActiveRunId(running.id);
      })
      .catch((e) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadDetail]);

  // Facts belong to the project of the open conversation (or to "no project").
  const selectedSession = sessions.find((x) => x.id === selectedId) ?? null;
  const factsScope = selectedSession?.projectId ?? null;
  const loadFacts = useCallback(() => api.facts(factsScope, selectedId ?? undefined).then(setFacts), [factsScope, selectedId]);
  useEffect(() => {
    setMemMessage(null);
    if (!selectedId) return setFacts([]);
    void loadFacts().catch((e) => setError(message(e)));
  }, [selectedId, loadFacts]);

  /** Runs a memory action, then refreshes what it may have changed. */
  const memAction = async (action: () => Promise<string | void>) => {
    setMemBusy(true);
    setMemMessage(null);
    try {
      const note = await action();
      if (note) setMemMessage(note);
      if (selectedId) await loadDetail(selectedId);
      await loadFacts();
    } catch (e) {
      setMemMessage(message(e));
    } finally {
      setMemBusy(false);
    }
  };
  const describe = (r: SummarizeResult): string =>
    r.ok
      ? `Resumo atualizado${r.fatosNovos ? ` e ${r.fatosNovos} fato(s) novo(s) para você revisar` : ''}.`
      : r.code === 'nothing_to_summarize'
        ? 'Não há mensagens novas para resumir.'
        : r.code === 'invalid_output'
          ? 'O resumidor respondeu algo inválido; o resumo anterior foi mantido.'
          : `Não foi possível resumir: ${r.error}`;
  /** Summarizes now; the result is also returned so a caller (the provider switch) can decide what to do. */
  const summarizeNow = async (): Promise<SummarizeResult | null> => {
    if (!selectedId) return null;
    let result: SummarizeResult | null = null;
    await memAction(async () => {
      result = await api.summarize(selectedId);
      return describe(result);
    });
    return result;
  };

  const stream = useRunStream(activeRunId, () => {
    // The server stores the reply before it announces the end, so a reload now returns the final state.
    // A pipeline creates its next run before announcing this one's end: follow it.
    if (selectedId) {
      void loadDetail(selectedId)
        .then((d) => {
          const next = d.runs.find((r) => r.status === 'rodando' && r.parentRunId === activeRunId); // ours, not another tab's
          if (next) setActiveRunId(next.id);
        })
        .catch((e) => setError(message(e)));
    }
    void refreshSessions();
  });
  const liveStream = activeRunId ? stream : null;
  const finished = liveStream && liveStream.phase !== 'running' && liveStream.phase !== 'connecting';
  // Once the stored reply is on screen, drop the live bubble (an error or a cancellation stays visible).
  const storedReply = finished && liveStream.phase === 'ended' && detail?.runs.some((r) => r.id === activeRunId && r.status === 'ok');
  const shownStream = storedReply ? null : liveStream;

  const newSession = async (projectId?: string) => {
    try {
      const s = await api.createSession(projectId ? { projectId } : {});
      await refreshSessions();
      setSelectedId(s.id);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const trashSession = async (id: string) => {
    try {
      await api.trashSession(id);
      if (id === selectedId) setSelectedId(null);
      await refreshSessions();
      setTrashVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };

  const send = async (input: SendInput) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const runId = await api.send(selectedId, input);
      await loadDetail(selectedId); // the user message is stored at submit time
      setActiveRunId(runId);
      void refreshSessions(); // auto-title from the first message
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  /** Runs a decision on a paused pipeline, then follows the run it started (if any). */
  const decide = async (action: () => Promise<string | void>) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const runId = await action();
      await loadDetail(selectedId);
      if (runId) setActiveRunId(runId);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (activeRunId) void api.cancel(activeRunId).catch((e) => setError(message(e)));
  };

  // ---- shell: current project, approvals count, global shortcuts
  const currentProject = projects.find((p) => p.id === boardProjectId) ?? null;
  const projectSessions = sessions.filter((x) => (currentProject ? x.projectId === currentProject.id : !x.projectId || !projects.some((p) => p.id === x.projectId)));

  // First load: open the project of the latest conversation, else the first project.
  const [startedAt] = useState(() => ({ done: false }));
  useEffect(() => {
    if (startedAt.done || (projects.length === 0 && sessions.length === 0)) return;
    startedAt.done = true;
    setBoardProjectId(sessions.length > 0 ? (sessions[0]!.projectId ?? null) : (projects[0]?.id ?? null));
  }, [projects, sessions, startedAt]);

  const refreshApprovals = useCallback(() => setApprovalsVersion((v) => v + 1), []);
  useEffect(() => {
    if (projects.length === 0) return setPending(0);
    let cancelled = false;
    const load = () =>
      Promise.all(projects.map((p) => api.projectApprovals(p.id)))
        .then((all) => !cancelled && setPending(all.reduce((n, list) => n + list.length, 0)))
        .catch(() => undefined); // the badge is a hint; the queue screen shows real errors
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projects, approvalsVersion, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const typing = tag === 'textarea' || tag === 'input';
      const k = e.key.toLowerCase();
      if (k === 'a' && !typing) {
        e.preventDefault();
        setView('queue');
      } else if (k === 'p') {
        e.preventDefault();
        setSwitcherOpen((v) => !v);
      } else if (/^[1-9]$/.test(k) && projects[Number(k) - 1]) {
        e.preventDefault();
        setBoardProjectId(projects[Number(k) - 1]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projects]);

  // Every run in progress on the server (tickets run on their own, outside the open conversation).
  const [serverLive, setServerLive] = useState<LiveRunInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .liveRuns()
        .then((r) => !cancelled && setServerLive(r))
        .catch(() => undefined); // the bar is a hint; a failure must not disturb the screen
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  const toLive = (r: LiveRunInfo): LiveRun => ({
    id: r.id,
    agent: r.agente ?? r.etapa ?? 'agente',
    provider: r.provedor || null,
    label: r.ticket?.identificador ?? sessions.find((x) => x.id === r.sessionId)?.titulo ?? 'conversa',
    // SQLite stores UTC without a zone mark
    startedAt: Date.parse(`${r.inicio.replace(' ', 'T')}Z`) || Date.now(),
    status: 'running',
    onOpen: () => {
      if (r.projectId) setBoardProjectId(r.projectId);
      if (r.ticket) setView('board');
      else {
        if (r.sessionId) setSelectedId(r.sessionId);
        setView('chat');
      }
    },
  });
  const activeRun = detail?.runs.find((r) => r.id === activeRunId) ?? null;
  const ownLive: LiveRun[] =
    activeRun && liveStream && (liveStream.phase === 'running' || liveStream.phase === 'connecting') && !serverLive.some((r) => r.id === activeRun.id)
      ? [{ id: activeRun.id, agent: activeRun.etapa ?? 'agente', provider: activeRun.provedor || null, label: selectedSession?.titulo ?? 'Nova conversa', startedAt: Date.parse(activeRun.inicio) || Date.now(), status: 'running', onOpen: () => setView('chat') }]
      : [];
  const live: LiveRun[] = [...serverLive.map(toLive), ...ownLive];
  useTabStatus(pending, live.map((r) => ({ agent: r.agent, label: r.label })));

  return (
    <div className="relative flex h-full flex-col">
      <Vigia
        project={currentProject ? { nome: currentProject.nome, branch: currentProject.branchBase ?? null } : null}
        onOpenSwitcher={() => setSwitcherOpen((v) => !v)}
        switcherOpen={switcherOpen}
        live={live}
        pending={pending}
        onOpenQueue={() => setView('queue')}
      />
      {switcherOpen && (
        <ProjectSwitcherMenu
          projects={projects}
          currentId={boardProjectId}
          onPick={(id) => {
            setBoardProjectId(id);
            setSelectedId(null);
            setSwitcherOpen(false);
          }}
          onAll={() => {
            setSwitcherOpen(false);
            setView('projects');
          }}
          onNew={() => {
            setSwitcherOpen(false);
            setView('projects');
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <Rail view={view} onGo={setView} projectMono={currentProject ? mono(currentProject.nome) : '—'} pending={pending} theme={theme} onToggleTheme={toggleTheme} />
        {view === 'projects' && (
          <ProjectsHome
            projects={projects}
            currentId={boardProjectId}
            onOpen={(id: string) => {
              setBoardProjectId(id);
              setSelectedId(null);
              setView('chat');
            }}
            onCreated={(p: Project) => {
              setProjects((list) => [p, ...list]);
              setBoardProjectId(p.id);
            }}
          />
        )}
        {view === 'agents' && <AgentLibrary onClose={() => setView('chat')} />}
        {view === 'pipelines' && <PipelinesScreen />}
        {view === 'memory' && <MemoryScreen projects={projects} projectId={boardProjectId} />}
        {view === 'metrics' && <MetricsPanel projects={projects} providers={providers} initialProjectId={boardProjectId} onClose={() => setView('chat')} />}
        {view === 'queue' && <ApprovalsQueue projects={projects} currentId={boardProjectId} onChanged={refreshApprovals} />}
        {view === 'storage' && <StorageScreen trashVersion={trashVersion} onRestored={() => void refreshSessions().catch((e) => setError(message(e)))} />}
        {view === 'pair' && <PairScreen />}
        {view === 'board' && currentProject && (
          <Board project={currentProject} projects={projects} onSwitch={setBoardProjectId} onOpenProject={() => setView('team')} onClose={() => setView('chat')} />
        )}
        {view === 'team' && currentProject && (
          <ProjectScreen
            projects={projects}
            projectId={currentProject.id}
            onSwitch={setBoardProjectId}
            onClose={() => setView('chat')}
            onOpenBoard={() => setView('board')}
            onChanged={() => void api.projects().then(setProjects).catch((e) => setError(message(e)))}
          />
        )}
        {(view === 'board' || view === 'team') && !currentProject && (
          <main className="flex flex-1 items-center justify-center text-muted">Escolha um projeto para ver {view === 'board' ? 'o quadro' : 'a equipe'}.</main>
        )}
      {/* Kept mounted while the library or the board is open, so a stream or a draft in progress is not lost. */}
      <div className={view === 'chat' ? 'contents' : 'hidden'}>
      <ConversationList
        projectName={currentProject?.nome ?? 'Sem projeto'}
        sessions={projectSessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => void newSession(currentProject?.id)}
        onDelete={(id) => void trashSession(id)}
      />
      <Chat
        projectName={currentProject?.nome ?? 'Sem projeto'}
        title={selectedSession?.titulo ?? 'Nova conversa'}
        runs={detail?.runs ?? []}
        loading={selectedId !== null && !detail}
        hasSession={selectedId !== null}
        messages={detail?.messages ?? []}
        stream={shownStream}
        providers={providers}
        busy={busy}
        error={error}
        onSend={send}
        onCancel={cancel}
        refiner={refiner}
        approvals={detail?.approvals ?? []}
        streamStep={detail?.runs.find((r) => r.id === activeRunId)?.etapa ?? null}
        onContinue={(runId, texto) => void decide(() => api.continueRun(runId, texto))}
        onRetry={(runId, via) => void decide(() => api.retryRun(runId, via))}
        onDiscard={(runId) => void decide(() => api.discardRun(runId).then(() => undefined))}
        sessionProvider={detail?.session.cliProvider ?? null}
        onSummarize={summarizeNow}
      />
      <RunPanel
        onCancel={cancel}
        runs={detail?.runs ?? []}
        stream={liveStream}
        open={panelOpen}
        onToggle={() => setPanelOpen((v) => !v)}
        memory={
          <MemoryPanel
            session={detail?.session ?? null}
            scopeName={projects.find((x) => x.id === factsScope)?.nome ?? null}
            facts={facts}
            settings={memSettings}
            providers={providers}
            busy={memBusy}
            message={memMessage}
            onSaveSummary={(resumo) => selectedId && void memAction(async () => void (await api.saveSummary(selectedId, resumo)))}
            onUndoSummary={() => selectedId && void memAction(async () => void (await api.undoSummary(selectedId)))}
            onSummarize={() => void summarizeNow()}
            onAddFact={(texto, fixado) => void memAction(async () => void (await api.addFact({ texto, fixado, ...(factsScope ? { projectId: factsScope } : selectedId ? { sessionId: selectedId } : {}) })))}
            onUpdateFact={(id, changes) => {
              // Optimistic: the toggle must not flicker back while the request is in flight. A failure reloads the truth.
              setFacts((list) => list.map((f) => (f.id === id ? { ...f, ...changes } : f)));
              void api.updateFact(id, changes).catch((e) => {
                setMemMessage(message(e));
                void loadFacts();
              });
            }}
            onDeleteFact={(id) => void memAction(async () => void (await api.deleteFact(id)))}
            onSaveSettings={(patch) => void memAction(async () => { setMemSettings(await api.saveSettings(patch)); return 'Configurações salvas.'; })}
          />
        }
      />
      </div>
      </div>
    </div>
  );
}
