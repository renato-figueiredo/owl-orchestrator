import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkSnapshot, snapshotTo, type Db, type createRepos } from '@owl/db';
import { z } from 'zod';

type Repos = ReturnType<typeof createRepos>;

export const BACKUP_KEY = 'backup';
const STATUS_KEY = 'backup_status';

export const backupSettingsSchema = z.object({
  /** Off by default: nothing is copied anywhere unless the user turns this on. */
  ativo: z.boolean(),
  /** How many snapshots to keep in the local folder. */
  retencao: z.number().int().min(1).max(365),
  intervaloHoras: z.number().int().min(1).max(24 * 30),
});
export const backupSettingsPatchSchema = backupSettingsSchema.partial();
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { ativo: false, retencao: 14, intervaloHoras: 24 };

export interface BackupStatus {
  em: string;
  ok: boolean;
  arquivo?: string;
  criptografado?: boolean;
  enviado?: boolean;
  erro?: string;
}
export interface BackupFile {
  nome: string;
  bytes: number;
  criptografado: boolean;
  em: string;
}

export const BACKUP_NAME = /^owl-\d{4}-\d{2}-\d{2}\.db(\.age)?$/;

export interface Tool {
  bin: string;
  /** Arguments placed before the real ones (tests run a node script as the "binary"). */
  binArgs?: string[];
}

export function runTool(tool: Tool, args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    // Always an args array, never a shell string.
    const child = spawn(tool.bin, [...(tool.binArgs ?? []), ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr: stderr.trim() });
    });
  });
}

/**
 * Optional snapshots of the database (docs/03-data/sync-and-access.md). `VACUUM INTO` makes a consistent copy of the
 * live database; with an `age` key the copy is encrypted and the plaintext removed; with an `rclone` remote the
 * ENCRYPTED copy is shipped (an unencrypted snapshot never leaves the machine).
 */
export class BackupService {
  private running = false;

  constructor(
    private readonly deps: {
      db: Db;
      repos: Repos;
      dir: string;
      recipient?: string | undefined;
      remote?: string | undefined;
      age?: Tool;
      rclone?: Tool;
      now?: () => Date;
    },
  ) {}

  settings(): BackupSettings {
    const stored = this.deps.repos.settings.get(BACKUP_KEY);
    const base = typeof stored === 'object' && stored !== null ? (stored as object) : {};
    const parsed = backupSettingsSchema.safeParse({ ...DEFAULT_BACKUP_SETTINGS, ...base });
    return parsed.success ? parsed.data : DEFAULT_BACKUP_SETTINGS;
  }

  saveSettings(patch: z.infer<typeof backupSettingsPatchSchema>): BackupSettings {
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = backupSettingsSchema.parse({ ...this.settings(), ...given });
    this.deps.repos.settings.set(BACKUP_KEY, next);
    return next;
  }

  /** What is configured through the environment, as booleans only (keys and remotes are never echoed back). */
  destinations(): { criptografia: boolean; envio: boolean } {
    return { criptografia: Boolean(this.deps.recipient), envio: Boolean(this.deps.remote) };
  }

  lastStatus(): BackupStatus | undefined {
    const v = this.deps.repos.settings.get(STATUS_KEY);
    return typeof v === 'object' && v !== null ? (v as BackupStatus) : undefined;
  }

  list(): BackupFile[] {
    if (!existsSync(this.deps.dir)) return [];
    return readdirSync(this.deps.dir)
      .filter((n) => BACKUP_NAME.test(n))
      .sort()
      .reverse()
      .map((nome) => {
        const st = statSync(join(this.deps.dir, nome));
        return { nome, bytes: st.size, criptografado: nome.endsWith('.age'), em: st.mtime.toISOString() };
      });
  }

  /** Takes one snapshot now. Never throws: the outcome (and any error) is stored as the last status. */
  async run(): Promise<BackupStatus> {
    if (this.running) return { em: new Date().toISOString(), ok: false, erro: 'A backup is already running' };
    this.running = true;
    const status = await this.take().catch((e: unknown): BackupStatus => ({
      em: (this.deps.now?.() ?? new Date()).toISOString(),
      ok: false,
      erro: e instanceof Error ? e.message : String(e),
    }));
    this.running = false;
    this.deps.repos.settings.set(STATUS_KEY, status);
    return status;
  }

  /** Called on a timer: takes a snapshot when enabled and the last good one is older than the interval. */
  async tick(): Promise<BackupStatus | undefined> {
    const cfg = this.settings();
    if (!cfg.ativo) return undefined;
    const last = this.lastStatus();
    const lastOk = last?.ok ? Date.parse(last.em) : NaN;
    const now = (this.deps.now?.() ?? new Date()).getTime();
    if (Number.isFinite(lastOk) && now - lastOk < cfg.intervaloHoras * 3_600_000) return undefined;
    return this.run();
  }

  private async take(): Promise<BackupStatus> {
    const { dir, recipient, remote } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const base = `owl-${now.toISOString().slice(0, 10)}.db`;
    const plain = join(dir, base);
    const tmp = join(dir, `${base}.${process.pid}.tmp`); // VACUUM INTO refuses an existing file
    rmSync(tmp, { force: true });
    snapshotTo(this.deps.db, tmp);
    const check = checkSnapshot(tmp);
    if (!check.ok) {
      rmSync(tmp, { force: true });
      throw new Error(`The snapshot did not pass the check: ${check.error ?? 'unknown'}`);
    }

    let final = plain;
    if (recipient) {
      const out = `${plain}.age`;
      const outTmp = `${out}.${process.pid}.tmp`;
      rmSync(outTmp, { force: true });
      const r = await runTool(this.deps.age ?? { bin: 'age' }, ['-r', recipient, '-o', outTmp, tmp]);
      rmSync(tmp, { force: true }); // the plaintext never stays on disk when encryption was asked for
      if (r.code !== 0) {
        rmSync(outTmp, { force: true });
        throw new Error(`age failed${r.code === null ? ' to start (is it installed?)' : ''}: ${r.stderr || `exit ${r.code}`}`);
      }
      renameSync(outTmp, out);
      rmSync(plain, { force: true }); // an older unencrypted copy from the same day
      final = out;
    } else {
      renameSync(tmp, plain);
      rmSync(`${plain}.age`, { force: true });
    }
    const arquivo = final.slice(dir.length + 1);
    this.prune();

    let enviado = false;
    if (remote) {
      if (!recipient) throw new Error('A remote is set but no age key: refusing to upload an unencrypted snapshot');
      const r = await runTool(this.deps.rclone ?? { bin: 'rclone' }, ['copyto', final, `${remote.replace(/\/+$/, '')}/${arquivo}`]);
      if (r.code !== 0) {
        throw new Error(`rclone failed${r.code === null ? ' to start (is it installed?)' : ''}: ${r.stderr || `exit ${r.code}`}`);
      }
      enviado = true;
    }
    return { em: now.toISOString(), ok: true, arquivo, criptografado: Boolean(recipient), enviado };
  }

  /** Keeps the newest `retencao` snapshots in the local folder. The remote's retention is the user's (rclone). */
  private prune(): void {
    const keep = this.settings().retencao;
    for (const old of this.list().slice(keep)) rmSync(join(this.deps.dir, old.nome), { force: true });
  }
}
