import { Button, IconButton, ListAnimated } from '@owl/ui';
import { Check, Pencil, Pin, PinOff, X } from 'lucide-react';
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

const field = 'w-full rounded-md border border-line bg-raised px-2.5 py-2 text-[13px] focus:border-accent';

/** View and edit what OWL remembers: the conversation summary, the pinned facts and the memory limits. */
export function MemoryPanel(p: Props) {
  return (
    <div className="space-y-5 p-4 text-[13px]">
      {p.message && (
        <p role="status" className="rounded-md border border-line bg-raised px-2.5 py-1.5">
          {p.message}
        </p>
      )}

      <section aria-label="Resumo da conversa" className="flex flex-col gap-2">
        <h3 className="owl-label">Resumo da conversa</h3>
        <SummaryEditor session={p.session} busy={p.busy} onSave={p.onSaveSummary} onUndo={p.onUndoSummary} onSummarize={p.onSummarize} />
      </section>

      <section aria-label="Fatos" className="flex flex-col gap-2">
        <h3 className="owl-label">Fatos {p.scopeName ? `do projeto ${p.scopeName}` : 'sem projeto'}</h3>
        <FactList facts={p.facts} busy={p.busy} onUpdate={p.onUpdateFact} onDelete={p.onDeleteFact} onAdd={p.onAddFact} />
      </section>

      {p.settings && <SettingsForm settings={p.settings} providers={p.providers} busy={p.busy} onSave={p.onSaveSettings} />}
    </div>
  );
}

/** The summary of one conversation: editable, with save, undo and "resumir agora". */
export function SummaryEditor({ session, busy, onSave, onUndo, onSummarize, rows = 7 }: { session: Session | null; busy: boolean; onSave: (resumo: string) => void; onUndo: () => void; onSummarize: () => void; rows?: number }) {
  const stored = session?.resumo ?? '';
  const [draft, setDraft] = useState(stored);
  // A new summary from the server (summarize, undo, another conversation) replaces the draft.
  useEffect(() => setDraft(stored), [stored, session?.id]);
  const changed = draft.trim() !== stored.trim();
  if (!session) return <p className="text-muted">Escolha uma conversa.</p>;
  return (
    <>
      <label className="sr-only" htmlFor="owl-summary">
        Resumo (editável)
      </label>
      <textarea
        id="owl-summary"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={rows}
        placeholder="Ainda sem resumo. Ele é escrito sozinho depois de algumas mensagens, ou quando você pedir."
        className={`${field} resize-y leading-[1.6]`}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={changed ? 'primary' : 'secondary'} disabled={busy || !changed || !draft.trim()} onClick={() => onSave(draft)}>
          Salvar resumo
        </Button>
        <Button size="sm" disabled={busy} onClick={onSummarize}>
          Resumir agora
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || !session.resumoAnterior} onClick={onUndo}>
          Desfazer
        </Button>
      </div>
    </>
  );
}

/** Pinned facts go into every prompt of the project; the rest stay stored. */
export function FactList({ facts, busy, onUpdate, onDelete, onAdd, emptyText = 'Nenhum fato ainda.' }: { facts: Fact[]; busy: boolean; onUpdate: Props['onUpdateFact']; onDelete: Props['onDeleteFact']; onAdd: Props['onAddFact']; emptyText?: string }) {
  return (
    <>
      <p className="text-xs text-muted">Só os fixados são enviados ao modelo. Valem para todas as conversas do mesmo projeto.</p>
      <ListAnimated className="flex flex-col gap-2">
        {facts.length === 0 && <li className="text-muted">{emptyText}</li>}
        {facts.map((f) => (
          <FactRow key={f.id} fact={f} busy={busy} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </ListAnimated>
      <AddFact busy={busy} onAdd={onAdd} />
    </>
  );
}

function FactRow({ fact, busy, onUpdate, onDelete }: { fact: Fact; busy: boolean; onUpdate: Props['onUpdateFact']; onDelete: Props['onDeleteFact'] }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.texto);
  return (
    <li className="grid grid-cols-[28px_1fr_auto] items-start gap-2 rounded-md border border-line bg-panel px-2.5 py-2">
      <button
        type="button"
        aria-pressed={fact.fixado}
        aria-label={`Fixar: ${fact.texto}`}
        title={fact.fixado ? 'Fixado: vai em todo prompt' : 'Fixar'}
        disabled={busy}
        onClick={() => onUpdate(fact.id, { fixado: !fact.fixado })}
        className={`grid size-7 place-items-center rounded-sm transition-colors hover:bg-raised disabled:opacity-50 ${fact.fixado ? 'text-fg' : 'text-faint'}`}
      >
        {fact.fixado ? <Pin size={14} aria-hidden="true" /> : <PinOff size={14} aria-hidden="true" />}
      </button>
      {editing ? (
        <form
          className="flex min-w-0 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onUpdate(fact.id, { texto: text.trim() });
            setEditing(false);
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Texto do fato" autoFocus className="h-7 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[13px] focus:border-accent" />
          <IconButton icon={Check} label="Salvar fato" size={28} type="submit" />
        </form>
      ) : (
        <span className="min-w-0 break-words pt-1 text-[13px] leading-[1.45]">{fact.texto}</span>
      )}
      {!editing && (
        <span className="flex gap-0.5 pt-0.5">
          <IconButton icon={Pencil} label={`Editar fato: ${fact.texto}`} size={28} disabled={busy} onClick={() => { setText(fact.texto); setEditing(true); }} />
          <IconButton icon={X} label={`Apagar fato: ${fact.texto}`} size={28} disabled={busy} onClick={() => onDelete(fact.id)} />
        </span>
      )}
    </li>
  );
}

function AddFact({ busy, onAdd }: { busy: boolean; onAdd: Props['onAddFact'] }) {
  const [text, setText] = useState('');
  const [pin, setPin] = useState(true);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text.trim(), pin);
        setText('');
      }}
    >
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="owl-new-fact">
          Novo fato
        </label>
        <input id="owl-new-fact" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ex.: usar pnpm, nunca npm" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 text-[13px] focus:border-accent" />
        <Button type="submit" disabled={busy || !text.trim()}>
          Adicionar fato
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} className="accent-[var(--c-accent)]" /> Fixar
      </label>
    </form>
  );
}

/** Memory limits (messages kept, when to summarize, budget, summarizer). */
export function SettingsForm({ settings, providers, busy, onSave }: { settings: MemorySettings; providers: ProviderInfo[]; busy: boolean; onSave: Props['onSaveSettings'] }) {
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
        className="h-7 w-24 rounded-md border border-line bg-raised px-1.5 text-right font-mono text-xs tabular-nums focus:border-accent"
      />
    </label>
  );
  const check = (checked: boolean, on: (v: boolean) => void, label: string, title?: string) => (
    <label className="flex items-center gap-2" {...(title ? { title } : {})}>
      <input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} className="accent-[var(--c-accent)]" /> {label}
    </label>
  );
  return (
    <details className="rounded-md border border-line">
      <summary className="cursor-pointer px-2.5 py-1.5 font-semibold hover:bg-raised">Configurações da memória</summary>
      <form
        className="space-y-2 border-t border-line p-2.5 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...s, resumidor: { provider: s.resumidor.provider, ...(s.resumidor.model?.trim() ? { model: s.resumidor.model.trim() } : {}) } });
        }}
      >
        {num('ultimasN', 'Últimas mensagens (N)', 0, 50)}
        {num('resumirACada', 'Resumir a cada (mensagens)', 2, 200)}
        {num('orcamentoTokens', 'Orçamento do contexto (tokens)', 200, 50000)}
        {check(s.resumoAutomatico, (v) => setS({ ...s, resumoAutomatico: v }), 'Resumir automaticamente')}
        {check(s.trechosFts, (v) => setS({ ...s, trechosFts: v }), 'Buscar trechos relacionados')}
        {check(s.mcpMemoria, (v) => setS({ ...s, mcpMemoria: v }), 'Ferramentas de memória sob demanda (Claude)', 'Só no Claude: ele consulta busca, resumo e fatos quando precisar, em vez de receber tudo no prompt')}
        <label className="flex items-center justify-between gap-2">
          Resumidor
          <select aria-label="Resumidor" value={s.resumidor.provider} onChange={(e) => setS({ ...s, resumidor: { ...s.resumidor, provider: e.target.value } })} className="h-7 rounded-md border border-line bg-raised px-1.5 font-mono text-xs">
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          Modelo do resumidor
          <input value={s.resumidor.model ?? ''} onChange={(e) => setS({ ...s, resumidor: { ...s.resumidor, model: e.target.value } })} placeholder="padrão" className="h-7 w-24 rounded-md border border-line bg-raised px-1.5 font-mono text-xs focus:border-accent" />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          Salvar configurações
        </Button>
      </form>
    </details>
  );
}
