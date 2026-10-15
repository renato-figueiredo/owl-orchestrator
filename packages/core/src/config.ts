import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  OWL_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  OWL_DATA_DIR: z.string().min(1).default('./data'),
  OWL_WORKSPACE_ROOTS: z.string().optional(),
  OWL_ALLOWED_ORIGINS: z.string().optional(),
  OWL_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  OWL_BACKUP_AGE_RECIPIENT: z.string().regex(/^age1[a-z0-9]{20,}$/, 'expected an age public key (age1...)').optional(),
  OWL_BACKUP_RCLONE_REMOTE: z.string().regex(/^[A-Za-z0-9_][\w.-]*:[^\0]*$/, 'expected an rclone destination like remote:folder').optional(),
  OWL_MAX_ATTACHMENT_MB: z.coerce.number().min(0.1).max(100).default(10),
});

export interface OwlConfig {
  /** Always loopback: the server must never listen on 0.0.0.0 by default. */
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  /** Maximum runs executing at once (default 1). */
  concurrency: number;
  /** Largest image accepted by `POST /attachments`, in bytes (OWL_MAX_ATTACHMENT_MB, default 10). */
  maxAttachmentBytes: number;
  /** `age` public key (OWL_BACKUP_AGE_RECIPIENT): snapshots are encrypted to it. A public key is not a secret. */
  backupAgeRecipient?: string;
  /** `rclone` destination (OWL_BACKUP_RCLONE_REMOTE): encrypted snapshots are copied there. Needs the key above. */
  backupRcloneRemote?: string;
  /**
   * Folders under which projects and runs may work (OWL_WORKSPACE_ROOTS, `:`-separated). Default: the home
   * folder. Hidden folders below a root (`~/.ssh`, `~/.config`...) are always refused.
   */
  workspaceRoots: string[];
  /** Extra browser origins allowed to call the API, e.g. the Vite dev server (OWL_ALLOWED_ORIGINS, comma-separated). */
  allowedOrigins: string[];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): OwlConfig {
  const parsed = schema.parse(env);
  const list = (v: string | undefined, sep: string | RegExp) => (v ?? '').split(sep).map((x) => x.trim()).filter(Boolean);
  const roots = list(parsed.OWL_WORKSPACE_ROOTS, delimiter);
  return {
    host: '127.0.0.1',
    port: parsed.OWL_PORT,
    dataDir: parsed.OWL_DATA_DIR,
    concurrency: parsed.OWL_CONCURRENCY,
    maxAttachmentBytes: Math.round(parsed.OWL_MAX_ATTACHMENT_MB * 1024 * 1024),
    ...(parsed.OWL_BACKUP_AGE_RECIPIENT ? { backupAgeRecipient: parsed.OWL_BACKUP_AGE_RECIPIENT } : {}),
    ...(parsed.OWL_BACKUP_RCLONE_REMOTE ? { backupRcloneRemote: parsed.OWL_BACKUP_RCLONE_REMOTE } : {}),
    workspaceRoots: roots.length ? roots : [homedir()],
    allowedOrigins: list(parsed.OWL_ALLOWED_ORIGINS, ','),
  };
}
