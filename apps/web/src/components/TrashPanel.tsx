import { Button, Switch } from '@owl/ui';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PurgeResult, Session, TrashSettings } from '../lib/types';
import { field } from './desk/ScreenHeader';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

interface Props {
  /** Bumped by the parent when a conversation was just moved to the trash. */
  version: number;
  onRestored: () => void;
}

/** The trash: conversations moved here can be restored; deleting from here is permanent and asks twice. */
export function TrashPanel({ version, onRestored }: Props) {
  const [items, setItems] = useState<Session[] | null>(null);
  const [settings, setSettings] = useState<TrashSettings | null>(null);
  const [confirm, setConfirm] = useState<string | 'all' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.trash());
      setSettings(await api.trashSettings());
    } catch (e) {
      setNote(message(e));
    }
  }, []);
  // Loaded when the screen opens, and again when something new went to the trash.
  useEffect(() => {
    void load();
  }, [load, version]);

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
    <section aria-label="Lixeira" className="flex flex-col gap-3 border-b border-line px-6 py-5 xl:border-b-0 xl:border-r">
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 text-[15px] font-semibold">Lixeira</h2>
        <span className="font-mono text-[11px] text-muted">{items?.length ?? 0}</span>
      </div>

      {settings && (
        <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
          <Switch checked={settings.purgaAutomatica} disabled={busy} label="Excluir de vez depois do prazo" onChange={(v) => void act(async () => void (await api.saveTrashSettings({ purgaAutomatica: v })))} />
          <label className="flex items-center gap-2 text-muted">
            Guardar por (dias)
            <input
              type="number"
              min={1}
              max={3650}
              value={settings.diasRetencao}
              disabled={busy}
              onChange={(e) => setSettings({ ...settings, diasRetencao: Number(e.target.value) })}
              onBlur={() => void act(async () => void (await api.saveTrashSettings({ diasRetencao: settings.diasRetencao })))}
              className={`${field} w-20 text-right font-mono`}
            />
          </label>
        </div>
      )}

      {items?.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md border border-line bg-panel px-3 py-2.5">
          <span className="truncate text-[13px] font-medium">{s.titulo ?? 'Nova conversa'}</span>
          {s.criadoEm && <span className="font-mono text-[11px] text-muted">criada em {new Date(s.criadoEm).toLocaleDateString('pt-BR')}</span>}
          <div className="flex gap-1.5">
            {confirm === s.id ? (
              <>
                <Button size="sm" variant="danger" disabled={busy} style={{ color: 'var(--c-danger)', borderColor: 'var(--c-danger)', background: 'var(--c-danger-wash)' }} onClick={() => void act(async () => purgedNote(await api.purgeSession(s.id)))}>
                  Confirmar: excluir para sempre
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                  Voltar
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={busy} onClick={() => void act(async () => { await api.restoreSession(s.id); onRestored(); })}>
                  Restaurar
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} className="hover:!text-danger" onClick={() => setConfirm(s.id)}>
                  Excluir de vez
                </Button>
              </>
            )}
          </div>
        </div>
      ))}

      {items?.length === 0 && (
        <div className="flex items-center gap-3 py-4 text-muted">
          <img src="/brand/mark.svg" alt="" className="size-8 opacity-60" />A lixeira está vazia.
        </div>
      )}

      {items && items.length > 0 &&
        (confirm === 'all' ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="danger" disabled={busy} style={{ color: 'var(--c-danger)', borderColor: 'var(--c-danger)', background: 'var(--c-danger-wash)' }} onClick={() => void act(async () => { const r = await api.emptyTrash(); return `${r.purged} conversa(s) excluída(s)${r.skipped ? `; ${r.skipped} em andamento ficaram` : ''}.`; })}>
              Confirmar: esvaziar a lixeira para sempre
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Voltar
            </Button>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm('all')}>
              Esvaziar lixeira
            </Button>
          </div>
        ))}

      {note && (
        <p role="status" className="m-0 text-xs leading-normal text-muted">
          {note}
        </p>
      )}
    </section>
  );
}
