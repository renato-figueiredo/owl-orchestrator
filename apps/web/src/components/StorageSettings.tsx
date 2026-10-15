import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BackupInfo, TrashSettings } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Trash retention, the optional backup and a manual cleanup. Everything here is off or conservative by default. */
export function StorageSettings() {
  const [open, setOpen] = useState(false);
  const [trash, setTrash] = useState<TrashSettings | null>(null);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTrash(await api.trashSettings());
      setBackup(await api.backups());
    } catch (e) {
      setNote(message(e));
    }
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="border-t border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium">Armazenamento e backup</summary>
      <div className="mt-2 space-y-3">
        {trash && (
          <fieldset className="space-y-1">
            <legend className="font-semibold">Lixeira</legend>
            <label className="flex items-center justify-between gap-2">
              Guardar por (dias)
              <input type="number" min={1} max={3650} value={trash.diasRetencao} disabled={busy} onChange={(e) => setTrash({ ...trash, diasRetencao: Number(e.target.value) })} onBlur={() => void act(async () => void (await api.saveTrashSettings({ diasRetencao: trash.diasRetencao })))} className="w-20 rounded border border-line bg-raised px-1 py-0.5 text-right" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={trash.purgaAutomatica} disabled={busy} onChange={(e) => void act(async () => void (await api.saveTrashSettings({ purgaAutomatica: e.target.checked })))} /> Excluir sozinho depois desse prazo
            </label>
          </fieldset>
        )}

        {backup && (
          <fieldset className="space-y-1">
            <legend className="font-semibold">Backup do banco</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={backup.settings.ativo} disabled={busy} onChange={(e) => void act(async () => void (await api.saveBackupSettings({ ativo: e.target.checked })))} /> Fazer backup automático (desligado por padrão)
            </label>
            <label className="flex items-center justify-between gap-2">
              A cada (horas)
              <input type="number" min={1} max={720} defaultValue={backup.settings.intervaloHoras} key={`i${backup.settings.intervaloHoras}`} disabled={busy} onBlur={(e) => void act(async () => void (await api.saveBackupSettings({ intervaloHoras: Number(e.target.value) })))} className="w-20 rounded border border-line bg-raised px-1 py-0.5 text-right" />
            </label>
            <label className="flex items-center justify-between gap-2">
              Cópias guardadas
              <input type="number" min={1} max={365} defaultValue={backup.settings.retencao} key={`r${backup.settings.retencao}`} disabled={busy} onBlur={(e) => void act(async () => void (await api.saveBackupSettings({ retencao: Number(e.target.value) })))} className="w-20 rounded border border-line bg-raised px-1 py-0.5 text-right" />
            </label>
            <p className="text-muted">
              Criptografia (age): {backup.destinos.criptografia ? 'ligada' : 'desligada'} · Envio (rclone): {backup.destinos.envio ? 'ligado' : 'desligado'}. Configure por variáveis de ambiente (veja o guia).
            </p>
            <button type="button" disabled={busy} onClick={() => void act(async () => { const s = await api.runBackup(); return s.ok ? `Backup feito: ${s.arquivo}${s.enviado ? ' (enviado)' : ''}.` : `O backup falhou: ${s.erro ?? 'erro desconhecido'}`; })} className="rounded border border-line px-2 py-1 hover:bg-raised">
              Fazer backup agora
            </button>
            {backup.ultimo && (
              <p className={backup.ultimo.ok ? 'text-muted' : 'text-danger'}>
                Último: {new Date(backup.ultimo.em).toLocaleString()} — {backup.ultimo.ok ? 'ok' : `falhou (${backup.ultimo.erro ?? '?'})`}
              </p>
            )}
            {backup.arquivos.length > 0 && (
              <ul className="text-muted">
                {backup.arquivos.map((f) => (
                  <li key={f.nome} className="truncate">
                    {f.nome} · {kb(f.bytes)}
                    {f.criptografado ? ' · criptografado' : ''}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}

        <button type="button" disabled={busy} onClick={() => void act(async () => { const r = await api.sweep(); return `Limpeza feita: ${r.orphanBlobs} imagem(ns) órfã(s), ${r.strayFiles} arquivo(s) solto(s)${r.missingFiles ? `; ${r.missingFiles} imagem(ns) sem arquivo` : ''}.`; })} className="rounded border border-line px-2 py-1 hover:bg-raised">
          Limpar arquivos sem uso
        </button>
        {note && (
          <p role="status" className="text-muted">
            {note}
          </p>
        )}
      </div>
    </details>
  );
}
