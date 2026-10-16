import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { FactList, SettingsForm, SummaryEditor } from '../components/MemoryPanel';
import { api } from '../lib/api';
import { fmtCompact } from '../lib/format';
import type { Fact, MemorySettings, Project, ProviderInfo, Session, SummarizeResult } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

const describe = (r: SummarizeResult): string =>
  r.ok
    ? `Resumo atualizado${r.fatosNovos ? ` e ${r.fatosNovos} fato(s) novo(s) para você revisar` : ''}.`
    : r.code === 'nothing_to_summarize'
      ? 'Não há mensagens novas para resumir.'
      : r.code === 'invalid_output'
        ? 'O resumidor respondeu algo inválido; o resumo anterior foi mantido.'
        : `Não foi possível resumir: ${r.error}`;

/** Memory of the open project: pinned facts, the summary of a conversation, the context budget and the memory limits. */
export function MemoryScreen({ projects, projectId }: { projects: Project[]; projectId: string | null }) {
  const project = projects.find((p) => p.id === projectId) ?? null;
  const [facts, setFacts] = useState<Fact[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFacts = useCallback(() => api.facts(projectId).then(setFacts), [projectId]);
  const loadSession = useCallback((id: string) => api.session(id).then((d) => setSession(d.session)), []);

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setError(null);
    setSessionId(null);
    setSession(null);
    Promise.all([api.facts(projectId), api.sessions(), api.settings().catch(() => null), api.providers().catch(() => [] as ProviderInfo[])])
      .then(([f, all, s, pr]) => {
        if (cancelled) return;
        setFacts(f);
        const mine = all.filter((x) => (projectId ? x.projectId === projectId : !x.projectId));
        setSessions(mine);
        setSessionId(mine[0]?.id ?? null);
        setSettings(s);
        setProviders(pr);
      })
      .catch((e) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!sessionId) return setSession(null);
    let cancelled = false;
    loadSession(sessionId).catch((e) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadSession]);

  /** Runs a memory action, then refreshes what it may have changed. */
  const act = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const text = await action();
      if (text) setNote(text);
      if (sessionId) await loadSession(sessionId);
      await loadFacts();
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = q ? facts.filter((f) => f.texto.toLowerCase().includes(q)) : facts;
  const hits = q
    ? [
        ...shown.map((f) => ({ key: f.id, src: 'fato', ref: f.fixado ? 'fixado' : 'não fixado', txt: f.texto })),
        ...(session?.resumo?.toLowerCase().includes(q) ? [{ key: 'resumo', src: 'resumo', ref: session.titulo ?? 'conversa', txt: session.resumo }] : []),
      ]
    : [];
  const pinned = facts.filter((f) => f.fixado).length;

  return (
    <main aria-label="Memória" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div className="flex flex-wrap items-end gap-4 border-b border-line px-6 pb-3.5 pt-5">
        <div className="flex flex-col gap-1.5">
          <div className="owl-label">PROJETO · {(project?.nome ?? 'sem projeto').toUpperCase()}</div>
          <h1 className="text-2xl font-semibold leading-tight">Memória</h1>
        </div>
        <span className="flex-1" />
        <label className="flex h-8 w-[340px] max-w-full items-center gap-2 rounded-md border border-line bg-raised px-2.5 focus-within:border-accent">
          <Search size={14} aria-hidden="true" className="text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nos fatos e no resumo" aria-label="Buscar na memória" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none" />
        </label>
      </div>
      {error && (
        <p role="alert" className="border-b border-line px-6 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="border-b border-line bg-raised px-6 py-2 text-[13px]">
          {note}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6 border-line px-6 py-5 lg:border-r">
          <section aria-label="Fatos" className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2">
              <h2 className="owl-label">FATOS</h2>
              <span className="text-xs text-muted tabular-nums">
                {pinned} {pinned === 1 ? 'fixado vai' : 'fixados vão'} para todo prompt {project ? 'deste projeto' : 'sem projeto'}
              </span>
            </div>
            <FactList
              facts={shown}
              busy={busy}
              emptyText={q ? `Nenhum fato com “${query.trim()}”.` : 'Nenhum fato ainda.'}
              onUpdate={(id, changes) => {
                // Optimistic: the pin must not flicker back while the request is in flight. A failure reloads the truth.
                setFacts((list) => list.map((f) => (f.id === id ? { ...f, ...changes } : f)));
                void api.updateFact(id, changes).catch((e) => {
                  setNote(message(e));
                  void loadFacts();
                });
              }}
              onDelete={(id) => void act(async () => void (await api.deleteFact(id)))}
              onAdd={(texto, fixado) => void act(async () => void (await api.addFact({ texto, fixado, ...(projectId ? { projectId } : {}) })))}
            />
          </section>

          <section aria-label="Resumo da conversa" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="owl-label">RESUMO DA CONVERSA</h2>
              {session && <span className="text-xs text-muted">{session.resumoAteMessageId ? `até a msg #${session.resumoAteMessageId}` : 'ainda sem resumo'}</span>}
            </div>
            {sessions.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted">
                Conversa
                <select value={sessionId ?? ''} onChange={(e) => setSessionId(e.target.value || null)} className="h-7 min-w-0 flex-1 rounded-md border border-line bg-raised px-1.5 text-[13px] text-fg">
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.titulo ?? 'Nova conversa'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <SummaryEditor
              session={session}
              busy={busy}
              rows={6}
              onSave={(resumo) => sessionId && void act(async () => void (await api.saveSummary(sessionId, resumo)))}
              onUndo={() => sessionId && void act(async () => void (await api.undoSummary(sessionId)))}
              onSummarize={() => sessionId && void act(async () => describe(await api.summarize(sessionId)))}
            />
          </section>
        </div>

        <div className="flex flex-col gap-6 px-6 py-5">
          <section aria-label="Contexto da próxima run" className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2">
              <h2 className="owl-label">CONTEXTO DA PRÓXIMA RUN</h2>
              <span className="flex-1" />
              {settings && <span className="font-mono text-[11px] tabular-nums">orçamento {fmtCompact(settings.orcamentoTokens)} tok</span>}
            </div>
            <p className="text-[13px] leading-normal text-muted">
              {settings
                ? `Cada prompt leva os fatos fixados, o resumo e as últimas ${settings.ultimasN} mensagens, dentro do orçamento.`
                : 'Configurações da memória indisponíveis.'}
              {' '}A divisão exata do contexto por fonte ainda não é exposta pelo servidor.
            </p>
          </section>

          {settings && <SettingsForm settings={settings} providers={providers} busy={busy} onSave={(patch) => void act(async () => { setSettings(await api.saveSettings(patch)); return 'Configurações salvas.'; })} />}

          <section aria-live="polite" aria-label="Resultados da busca" className="flex flex-col gap-2">
            <h2 className="owl-label">RESULTADOS DA BUSCA</h2>
            {!q && <p className="border-t border-line py-2.5 text-[13px] text-muted">Digite acima para buscar nos fatos e no resumo da conversa aberta. Mensagens e tickets ainda não entram na busca.</p>}
            {hits.map((h) => (
              <div key={h.key} className="flex flex-col gap-1 border-t border-line py-2.5">
                <span className="flex gap-2 font-mono text-[11px] text-muted">
                  <span className="rounded-sm border border-line px-[5px] text-fg">{h.src}</span>
                  {h.ref}
                </span>
                <span className="text-pretty text-[13px] leading-normal">{h.txt}</span>
              </div>
            ))}
            {q && hits.length === 0 && <p className="border-t border-line py-2.5 text-[13px] text-muted">Nada encontrado para “{query.trim()}”.</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
