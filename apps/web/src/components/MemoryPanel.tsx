import { useEffect, useState } from 'react';
import type { Fact, MemorySettings, ProviderInfo, Session } from '../lib/types';

interface Props {
  session: Session | null;
  /** Name of the project that owns the facts shown (null: conversations with no project). */
  scopeName: string | null;
  facts: Fact[];
  settings: MemorySettings | null;
  providers: ProviderInfo[];
  busy: boolean;
  message: string | null;
  onSaveSummary: (resumo: string) => void;
  onUndoSummary: () => void;
  onSummarize: () => void;
  onAddFact: (texto: string, fixado: boolean) => void;
  onUpdateFact: (id: string, changes: { texto?: string; fixado?: boolean }) => void;
  onDeleteFact: (id: string) => void;
  onSaveSettings: (patch: Partial<MemorySettings>) => void;
}

/** View and edit what OWL remembers: the conversation summary, the pinned facts and the memory limits. */
export function MemoryPanel(p: Props) {
  const stored = p.session?.resumo ?? '';
  const [draft, setDraft] = useState(stored);
  // A new summary from the server (summarize, undo, another conversation) replaces the draft.
  useEffect(() => setDraft(stored), [stored, p.session?.id]);
  const changed = draft.trim() !== stored.trim();

  return (
    <div className="space-y-4 p-3 text-sm">
      {p.message && (
        <p role="status" className="rounded border border-line bg-raised px-2 py-1">
          {p.message}
        </p>
      )}

      <section aria-label="Resumo da conversa">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Resumo da conversa</h3>
        {p.session ? (
          <>
            <label className="sr-only" htmlFor="owl-summary">
              Resumo (editável)
            </label>
            <textarea
              id="owl-summary"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              placeholder="Ainda sem resumo. Ele é escrito sozinho depois de algumas mensagens, ou quando você pedir."
              className="mt-1 w-full resize-y rounded border border-line bg-raised px-2 py-1"
            />
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" disabled={p.busy || !changed || !draft.trim()} onClick={() => p.onSaveSummary(draft)} className="rounded bg-accent px-2 py-1 font-medium text-accent-fg disabled:opacity-50">
                Salvar resumo
              </button>
              <button type="button" disabled={p.busy || !p.session.resumoAnterior} onClick={p.onUndoSummary} className="rounded border border-line px-2 py-1 hover:bg-raised disabled:opacity-50">
                Desfazer
              </button>
              <button type="button" disabled={p.busy} onClick={p.onSummarize} className="rounded border border-line px-2 py-1 hover:bg-raised disabled:opacity-50">
                Resumir agora
              </button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-muted">Escolha uma conversa.</p>
        )}
      </section>

      <section aria-label="Fatos">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Fatos {p.scopeName ? `do projeto ${p.scopeName}` : 'sem projeto'}</h3>
        <p className="text-xs text-muted">Só os fixados são enviados ao modelo. Valem para todas as conversas do mesmo projeto.</p>
        <ul className="mt-1 space-y-1">
          {p.facts.length === 0 && <li className="text-muted">Nenhum fato ainda.</li>}
          {p.facts.map((f) => (
            <FactRow key={f.id} fact={f} busy={p.busy} onUpdate={p.onUpdateFact} onDelete={p.onDeleteFact} />
          ))}
        </ul>
        <AddFact busy={p.busy} onAdd={p.onAddFact} />
      </section>

      {p.settings && <SettingsForm settings={p.settings} providers={p.providers} busy={p.busy} onSave={p.onSaveSettings} />}
    </div>
  );
}

function FactRow({ fact, busy, onUpdate, onDelete }: { fact: Fact; busy: boolean; onUpdate: Props['onUpdateFact']; onDelete: Props['onDeleteFact'] }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.texto);
  return (
    <li className="flex items-start gap-2 rounded border border-line bg-raised px-2 py-1">
      <input type="checkbox" checked={fact.fixado} disabled={busy} onChange={(e) => onUpdate(fact.id, { fixado: e.target.checked })} aria-label={`Fixar: ${fact.texto}`} className="mt-1" />
      {editing ? (
        <form
          className="flex flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onUpdate(fact.id, { texto: text.trim() });
            setEditing(false);
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Texto do fato" className="flex-1 rounded border border-line bg-bg px-1" />
          <button type="submit" className="rounded border border-line px-1">OK</button>
        </form>
      ) : (
        <span className="flex-1 break-words">{fact.texto}</span>
      )}
      {!editing && (
        <>
          <button type="button" disabled={busy} onClick={() => { setText(fact.texto); setEditing(true); }} aria-label={`Editar fato: ${fact.texto}`} className="text-muted hover:text-fg">
            ✎
          </button>
          <button type="button" disabled={busy} onClick={() => onDelete(fact.id)} aria-label={`Apagar fato: ${fact.texto}`} className="text-muted hover:text-danger">
            ✕
          </button>
        </>
      )}
    </li>
  );
}

function AddFact({ busy, onAdd }: { busy: boolean; onAdd: Props['onAddFact'] }) {
  const [text, setText] = useState('');
  const [pin, setPin] = useState(true);
  return (
    <form
      className="mt-2 space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text.trim(), pin);
        setText('');
      }}
    >
      <label className="sr-only" htmlFor="owl-new-fact">
        Novo fato
      </label>
      <input id="owl-new-fact" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ex.: usar pnpm, nunca npm" className="w-full rounded border border-line bg-raised px-2 py-1" />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Fixar
        </label>
        <button type="submit" disabled={busy || !text.trim()} className="rounded border border-line px-2 py-1 hover:bg-raised disabled:opacity-50">
          Adicionar fato
        </button>
      </div>
    </form>
  );
}

function SettingsForm({ settings, providers, busy, onSave }: { settings: MemorySettings; providers: ProviderInfo[]; busy: boolean; onSave: Props['onSaveSettings'] }) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const num = (key: 'ultimasN' | 'resumirACada' | 'orcamentoTokens', label: string, min: number, max: number) => (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={s[key]}
        onChange={(e) => setS({ ...s, [key]: Number(e.target.value) })}
        className="w-24 rounded border border-line bg-raised px-1 py-0.5 text-right"
      />
    </label>
  );
  return (
    <details className="rounded border border-line">
      <summary className="cursor-pointer px-2 py-1 font-semibold">Configurações da memória</summary>
      <form
        className="space-y-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...s, resumidor: { provider: s.resumidor.provider, ...(s.resumidor.model?.trim() ? { model: s.resumidor.model.trim() } : {}) } });
        }}
      >
        {num('ultimasN', 'Últimas mensagens (N)', 0, 50)}
        {num('resumirACada', 'Resumir a cada (mensagens)', 2, 200)}
        {num('orcamentoTokens', 'Orçamento do contexto (tokens)', 200, 50000)}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.resumoAutomatico} onChange={(e) => setS({ ...s, resumoAutomatico: e.target.checked })} /> Resumir automaticamente
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.trechosFts} onChange={(e) => setS({ ...s, trechosFts: e.target.checked })} /> Buscar trechos relacionados
        </label>
        <label className="flex items-center gap-2" title="Só no Claude: ele consulta busca, resumo e fatos quando precisar, em vez de receber tudo no prompt">
          <input type="checkbox" checked={s.mcpMemoria} onChange={(e) => setS({ ...s, mcpMemoria: e.target.checked })} /> Ferramentas de memória sob demanda (Claude)
        </label>
        <label className="flex items-center justify-between gap-2">
          Resumidor
          <select aria-label="Resumidor" value={s.resumidor.provider} onChange={(e) => setS({ ...s, resumidor: { ...s.resumidor, provider: e.target.value } })} className="rounded border border-line bg-raised px-1 py-0.5">
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          Modelo do resumidor
          <input value={s.resumidor.model ?? ''} onChange={(e) => setS({ ...s, resumidor: { ...s.resumidor, model: e.target.value } })} placeholder="padrão" className="w-24 rounded border border-line bg-raised px-1 py-0.5" />
        </label>
        <button type="submit" disabled={busy} className="rounded bg-accent px-3 py-1 font-medium text-accent-fg disabled:opacity-50">
          Salvar configurações
        </button>
      </form>
    </details>
  );
}
