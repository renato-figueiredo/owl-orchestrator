import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { checkSnapshot } from '@owl/db';
import { runTool, type Tool } from './backup.js';

export interface RestoreResult {
  database: string;
  /** The database that was there before, moved aside (never deleted). */
  previous?: string;
  sessions: number;
  messages: number;
}

/**
 * `owl restore <file>`: puts a snapshot back as the database in `dataDir`. A `.age` file needs the private key file
 * (`identity`). The snapshot is checked BEFORE anything is touched, and an existing database is moved aside, not
 * deleted. Attachments are not in the snapshot: restore that folder from your own copy (restic/rclone).
 */
export async function restoreBackup(o: {
  file: string;
  dataDir: string;
  identity?: string | undefined;
  age?: Tool;
  now?: () => Date;
}): Promise<RestoreResult> {
  const src = resolve(o.file);
  if (!existsSync(src)) throw new Error(`File not found: ${src}`);
  mkdirSync(o.dataDir, { recursive: true });
  const work = join(o.dataDir, `.restore-${process.pid}.tmp`);
  rmSync(work, { force: true });
  try {
    if (src.endsWith('.age')) {
      if (!o.identity) throw new Error('This snapshot is encrypted: pass the private key file with --identity');
      const r = await runTool(o.age ?? { bin: 'age' }, ['-d', '-i', resolve(o.identity), '-o', work, src]);
      if (r.code !== 0) throw new Error(`age could not decrypt the file${r.code === null ? ' (is it installed?)' : ''}: ${r.stderr || `exit ${r.code}`}`);
    } else {
      copyFileSync(src, work);
    }
    const check = checkSnapshot(work);
    if (!check.ok) throw new Error(`Not a usable snapshot: ${check.error ?? 'unknown'}`);

    const target = join(o.dataDir, 'owl.sqlite');
    let previous: string | undefined;
    if (existsSync(target)) {
      const stamp = (o.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
      previous = `${target}.before-restore-${stamp}`;
      renameSync(target, previous);
    }
    // Leftovers of the old database must not be replayed onto the restored one.
    for (const ext of ['-wal', '-shm']) {
      if (existsSync(target + ext)) renameSync(target + ext, `${previous ?? target}${ext}`);
    }
    renameSync(work, target);
    return { database: target, ...(previous ? { previous: basename(previous) } : {}), sessions: check.sessions ?? 0, messages: check.messages ?? 0 };
  } finally {
    rmSync(work, { force: true });
  }
}
