import { Button, Switch } from '@owl/ui';
import { Archive, BrushCleaning } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BackupInfo, SweepReport } from '../lib/types';
import { field } from './desk/ScreenHeader';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Manual cleanup ("Armazenamento") and the optional backup, as the two right-hand columns of the storage screen. */
export function StorageSettings() {
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [report, setReport] = useState<SweepReport | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBackup(await api.backups());
    } catch (e) {
      setNote(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
    <>
      <section aria-label="Armazenamento" className="flex flex-col gap-3 border-b border-line px-6 py-5 xl:border-b-0 xl:border-r">
        <h2 className="m-0 text-[15px] font-semibold">Armazenamento</h2>
        <p className="m-0 text-xs leading-normal text-muted">Imagens sem conversa e arquivos soltos na pasta de dados podem ser limpos. O que está em uso nunca é tocado.</p>
        <div>
          <Button icon={BrushCleaning} disabled={busy} onClick={() => void act(async () => { setReport(await api.sweep()); })}>
            Varrer órfãos
          </Button>
        </div>
        {report && (
          <div role="status" className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md border border-line bg-panel px-3 py-2.5 text-xs">
            <span className="col-span-2 font-semibold text-ok">✓ Varredura concluída</span>
            <span className="text-muted">anexos órfãos</span>
            <span className="font-mono">{report.orphanBlobs}</span>
            <span className="text-muted">arquivos soltos</span>
            <span className="font-mono">{report.strayFiles}</span>
            {report.missingFiles > 0 && (
              <>
                <span className="text-muted">imagens sem arquivo</span>
                <span className="font-mono">{report.missingFiles}</span>
              </>
            )}
            <span className="text-muted">páginas liberadas</span>
            <span className="font-mono">{report.freedPages}</span>
          </div>
        )}
        {note && (
          <p role="status" className="m-0 text-xs leading-normal text-muted">
            {note}
          </p>
        )}
      </section>

      <section aria-label="Backup" className="flex flex-col gap-3 px-6 py-5">
        <h2 className="m-0 text-[15px] font-semibold">Backup</h2>
        {backup && (
          <>
            <Switch checked={backup.settings.ativo} disabled={busy} label="Fazer backup automático (desligado por padrão)" onChange={(v) => void act(async () => void (await api.saveBackupSettings({ ativo: v })))} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              <label className="flex items-center gap-2">
                A cada (horas)
                <input type="number" min={1} max={720} defaultValue={backup.settings.intervaloHoras} key={`i${backup.settings.intervaloHoras}`} disabled={busy} onBlur={(e) => void act(async () => void (await api.saveBackupSettings({ intervaloHoras: Number(e.target.value) })))} className={`${field} w-20 text-right font-mono`} />
              </label>
              <label className="flex items-center gap-2">
                Cópias guardadas
                <input type="number" min={1} max={365} defaultValue={backup.settings.retencao} key={`r${backup.settings.retencao}`} disabled={busy} onBlur={(e) => void act(async () => void (await api.saveBackupSettings({ retencao: Number(e.target.value) })))} className={`${field} w-20 text-right font-mono`} />
              </label>
            </div>
            <p className="m-0 text-xs leading-normal text-muted">
              Criptografia (age): {backup.destinos.criptografia ? 'ligada' : 'desligada'} · Envio (rclone): {backup.destinos.envio ? 'ligado' : 'desligado'}. Configure por variáveis de ambiente (veja o guia).
            </p>
            {backup.ultimo && (
              <div className="flex items-center gap-2 text-xs">
                <span aria-hidden="true" className={`font-mono ${backup.ultimo.ok ? 'text-ok' : 'text-danger'}`}>{backup.ultimo.ok ? '✓' : '✕'}</span>
                <span className={backup.ultimo.ok ? '' : 'text-danger'}>
                  Último: {new Date(backup.ultimo.em).toLocaleString('pt-BR')} — {backup.ultimo.ok ? `ok${backup.ultimo.criptografado ? ' · criptografado' : ''}${backup.ultimo.enviado ? ' · enviado' : ''}` : `falhou (${backup.ultimo.erro ?? '?'})`}
                </span>
              </div>
            )}
            {backup.arquivos.map((f) => (
              <div key={f.nome} className="flex flex-col gap-0.5 border-b border-line py-1.5">
                <span className="truncate font-mono text-[11px]">{f.nome}</span>
                <span className="font-mono text-[11px] text-muted">
                  {kb(f.bytes)}
                  {f.criptografado ? ' · criptografado' : ''}
                </span>
              </div>
            ))}
            <div>
              <Button icon={Archive} disabled={busy} onClick={() => void act(async () => { const s = await api.runBackup(); return s.ok ? `Backup feito: ${s.arquivo}${s.enviado ? ' (enviado)' : ''}.` : `O backup falhou: ${s.erro ?? 'erro desconhecido'}`; })}>
                Fazer backup agora
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
