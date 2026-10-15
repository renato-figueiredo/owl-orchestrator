import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PurgeResult, Session } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

interface Props {
  /** Bumped by the parent when a conversation was just moved to the trash. */
  version: number;
  onRestored: () => void;
}

/** The trash: conversations moved here can be restored; deleting from here is permanent and asks twice. */
export function TrashPanel({ version, onRestored }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Session[] | null>(null);
  const [confirm, setConfirm] = useState<string | 'all' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.trash().then(setItems).catch((e) => setNote(message(e))), []);
  // Loaded when the panel is opened (and again when something new went to the trash while it is open).
  useEffect(() => {
    if (open) void load();
  }, [open, load, version]);

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
    } catch (e) {
      setNote(message(e));
    } finally {
      setConfirm(null);
      setBusy(false);
      await load();
    }
  };

  const purgedNote = (r: PurgeResult) =>
    r.cliSession
      ? `Conversa excluída do OWL. O histórico da própria CLI (${r.cliSession.provider}, sessão ${r.cliSession.id}) continua na pasta da CLI: o OWL não apaga essas pastas.`
      : 'Conversa excluída para sempre.';

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="border-t border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium">Lixeira</summary>
      <div className="mt-2 space-y-1">
        {items?.length === 0 && <p className="text-muted">A lixeira está vazia.</p>}
        {items?.map((s) => (
          <div key={s.id} className="rounded border border-line bg-raised p-1.5">
            <div className="truncate">{s.titulo ?? 'Nova conversa'}</div>
            <div className="mt-1 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void act(async () => { await api.restoreSession(s.id); onRestored(); })} className="rounded border border-line px-2 py-0.5 hover:bg-bg">
                Restaurar
              </button>
              {confirm === s.id ? (
                <button type="button" disabled={busy} onClick={() => void act(async () => purgedNote(await api.purgeSession(s.id)))} className="rounded bg-danger px-2 py-0.5 text-white">
                  Confirmar: excluir para sempre
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirm(s.id)} className="rounded border border-line px-2 py-0.5 text-danger hover:bg-bg">
                  Excluir de vez
                </button>
              )}
            </div>
          </div>
        ))}
        {items && items.length > 0 &&
          (confirm === 'all' ? (
            <button type="button" disabled={busy} onClick={() => void act(async () => { const r = await api.emptyTrash(); return `${r.purged} conversa(s) excluída(s)${r.skipped ? `; ${r.skipped} em andamento ficaram` : ''}.`; })} className="w-full rounded bg-danger px-2 py-1 text-white">
              Confirmar: esvaziar a lixeira para sempre
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirm('all')} className="w-full rounded border border-line px-2 py-1 text-danger hover:bg-raised">
              Esvaziar lixeira
            </button>
          ))}
        {note && (
          <p role="status" className="text-muted">
            {note}
          </p>
        )}
      </div>
    </details>
  );
}
