import { homedir } from 'node:os';
import { delimiter } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  OWL_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  OWL_DATA_DIR: z.string().min(1).default('./data'),
  OWL_WORKSPACE_ROOTS: z.string().optional(),
  OWL_ALLOWED_ORIGINS: z.string().optional(),
  OWL_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
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
    workspaceRoots: roots.length ? roots : [homedir()],
    allowedOrigins: list(parsed.OWL_ALLOWED_ORIGINS, ','),
  };
}
