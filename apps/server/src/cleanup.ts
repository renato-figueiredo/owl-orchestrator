import { existsSync, lstatSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Db, createRepos } from '@owl/db';
import { z } from 'zod';

type Repos = ReturnType<typeof createRepos>;

export const TRASH_KEY = 'lixeira';
export const trashSettingsSchema = z.object({
  /** Days a conversation stays in the trash before it is purged for good. */
  diasRetencao: z.number().int().min(1).max(3650),
  /** Purge expired conversations by itself (at startup and every few hours). */
  purgaAutomatica: z.boolean(),
});
export const trashSettingsPatchSchema = trashSettingsSchema.partial();
export type TrashSettings = z.infer<typeof trashSettingsSchema>;
export const DEFAULT_TRASH_SETTINGS: TrashSettings = { diasRetencao: 30, purgaAutomatica: true };

/** Blobs and files younger than this are never swept: an upload exists before the message that attaches it. */
export const SWEEP_GRACE_SECONDS = 3600;
const BLOB_FILE = /^[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/;
const TMP_FILE = /^[0-9a-f]{2}\/[0-9a-f]{64}\.webp\.[\w-]+\.tmp$/;

export interface PurgeResult {
  sessionId: string;
  blobsRemoved: number;
  /** The conversation had a native CLI session: its transcript stays in the CLI's own folder (see the docs). */
  cliSession?: { provider: string; id: string };
}
export interface SweepReport {
  /** Blob rows with no attachment whose file and row were removed. */
  orphanBlobs: number;
  /** Files in the attachments folder that no blob row points to. */
  strayFiles: number;
  /** Rows whose file is gone (reported only; nothing to recover them from here). */
  missingFiles: number;
  freedPages: number;
}

export class SessionBusyError extends Error {
  constructor() {
    super('The conversation has a run in progress');
  }
}
export class NotInTrashError extends Error {
  constructor() {
    super('Only a conversation in the trash can be deleted for good');
  }
}

/**
 * Deletion order (docs/03-data/deletion-and-backup.md): the database transaction first, files after. If the app
 * dies in between, `sweep` finds what was left behind.
 */
export class CleanupService {
  private readonly dir: string;

  constructor(
    private readonly deps: { db: Db; repos: Repos; dir: string; isBusy?: (sessionId: string) => boolean },
  ) {
    this.dir = resolve(deps.dir);
  }

  settings(): TrashSettings {
    const stored = this.deps.repos.settings.get(TRASH_KEY);
    const base = typeof stored === 'object' && stored !== null ? (stored as object) : {};
    const parsed = trashSettingsSchema.safeParse({ ...DEFAULT_TRASH_SETTINGS, ...base });
    return parsed.success ? parsed.data : DEFAULT_TRASH_SETTINGS;
  }

  saveSettings(patch: z.infer<typeof trashSettingsPatchSchema>): TrashSettings {
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = trashSettingsSchema.parse({ ...this.settings(), ...given });
    this.deps.repos.settings.set(TRASH_KEY, next);
    return next;
  }

  /** Permanent delete of ONE trashed conversation: transaction, then the files no one else uses. */
  purge(sessionId: string): PurgeResult {
    const { repos } = this.deps;
    const session = repos.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.deletedAt) throw new NotInTrashError();
    if (this.busy(sessionId)) throw new SessionBusyError();
    const hashes = repos.attachments.blobHashesOfSession(sessionId); // must be read before the cascade removes them
    repos.sessions.purge(sessionId);
    const blobsRemoved = this.collect(hashes);
    this.compact();
    return {
      sessionId,
      blobsRemoved,
      ...(session.cliProvider && session.cliSessionId ? { cliSession: { provider: session.cliProvider, id: session.cliSessionId } } : {}),
    };
  }

  /** Purges every trashed conversation at least `days` old (0 = all of them). Busy ones are skipped. */
  purgeTrash(days: number): { purged: number; skipped: number; blobsRemoved: number } {
    let purged = 0;
    let skipped = 0;
    let blobsRemoved = 0;
    for (const s of this.deps.repos.sessions.trashedOlderThan(days)) {
      try {
        blobsRemoved += this.purge(s.id).blobsRemoved;
        purged++;
      } catch (e) {
        if (!(e instanceof SessionBusyError)) throw e;
        skipped++;
      }
    }
    return { purged, skipped, blobsRemoved };
  }

  /** The automatic purge: honours the setting. */
  purgeExpired(): { purged: number; skipped: number; blobsRemoved: number } {
    const cfg = this.settings();
    return cfg.purgaAutomatica ? this.purgeTrash(cfg.diasRetencao) : { purged: 0, skipped: 0, blobsRemoved: 0 };
  }

  /**
   * Startup/periodic sweep: orphan blobs, files without a row, then the freelist. Idempotent. `graceSeconds` is for
   * tests; the default protects images that were uploaded but not sent yet.
   */
  sweep(graceSeconds = SWEEP_GRACE_SECONDS): SweepReport {
    const { repos } = this.deps;
    const orphanBlobs = this.collect(repos.blobs.staleOrphans(graceSeconds).map((b) => b.hash));
    const known = repos.blobs.allPaths();
    let strayFiles = 0;
    let missingFiles = 0;
    for (const caminho of known) if (!existsSync(join(this.dir, caminho))) missingFiles++;
    for (const rel of this.listFiles()) {
      const file = join(this.dir, rel);
      const stray = BLOB_FILE.test(rel) ? !known.has(rel) : TMP_FILE.test(rel);
      if (!stray) continue;
      if (Date.now() - lstatSync(file).mtimeMs < graceSeconds * 1000) continue;
      if (BLOB_FILE.test(rel) && repos.blobs.get(rel.slice(3, 67))) continue; // a row appeared meanwhile
      rmSync(file, { force: true });
      strayFiles++;
    }
    return { orphanBlobs, strayFiles, missingFiles, freedPages: this.compact() };
  }

  /** `PRAGMA incremental_vacuum`: hands free pages back to the file system. Returns how many were free. */
  compact(): number {
    const free = Number(this.deps.db.pragma('freelist_count', { simple: true }));
    if (free > 0) this.deps.db.pragma('incremental_vacuum');
    return free;
  }

  private busy(sessionId: string): boolean {
    return this.deps.repos.sessions.hasRunningRun(sessionId) || (this.deps.isBusy?.(sessionId) ?? false);
  }

  /** Row first (only if still unreferenced), file after. Returns how many blobs went away. */
  private collect(hashes: string[]): number {
    let n = 0;
    for (const hash of hashes) {
      const caminho = this.deps.repos.blobs.deleteIfOrphan(hash);
      if (caminho === undefined) continue; // still used by another conversation
      n++;
      const file = resolve(this.dir, caminho);
      if (file.startsWith(this.dir + sep)) rmSync(file, { force: true });
      try {
        rmdirSync(join(file, '..')); // the two-letter shard folder, only if now empty
      } catch {
        /* not empty or already gone */
      }
    }
    return n;
  }

  /** Relative paths (`ab/<hash>.webp`) of regular files two levels down. Symlinks are never followed or listed. */
  private listFiles(): string[] {
    if (!existsSync(this.dir)) return [];
    const out: string[] = [];
    for (const shard of readdirSync(this.dir, { withFileTypes: true })) {
      if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
      for (const f of readdirSync(join(this.dir, shard.name), { withFileTypes: true })) {
        if (f.isFile()) out.push(`${shard.name}/${f.name}`);
      }
    }
    return out;
  }
}
