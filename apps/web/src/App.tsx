import { useCallback, useEffect, useState } from 'react';
import { Chat } from './components/Chat';
import { RunPanel } from './components/RunPanel';
import { Sidebar } from './components/Sidebar';
import { api } from './lib/api';
import type { Project, ProviderInfo, Session, SessionDetail } from './lib/types';
import { useRunStream } from './lib/useRunStream';
import { useTheme } from './lib/useTheme';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
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

  const stream = useRunStream(activeRunId, () => {
    // The server stores the reply before it announces the end, so a reload now returns the final state.
    if (selectedId) void loadDetail(selectedId).catch((e) => setError(message(e)));
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

  const send = async (input: { texto: string; provider: string; model?: string }) => {
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

  const cancel = () => {
    if (activeRunId) void api.cancel(activeRunId).catch((e) => setError(message(e)));
  };

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects}
        sessions={sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNewSession={(pid) => void newSession(pid)}
        onCreateProject={async (input) => {
          const p = await api.createProject(input);
          setProjects((list) => [p, ...list]);
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <Chat
        hasSession={selectedId !== null}
        messages={detail?.messages ?? []}
        stream={shownStream}
        providers={providers}
        busy={busy}
        error={error}
        onSend={send}
        onCancel={cancel}
      />
      <RunPanel runs={detail?.runs ?? []} stream={liveStream} open={panelOpen} onToggle={() => setPanelOpen((v) => !v)} />
    </div>
  );
}
