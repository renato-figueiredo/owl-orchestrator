import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
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

/** Pid of a live server using this data folder (from `owl.pid`), or undefined. A stale file is ignored. */
export function serverPid(dataDir: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(dataDir, 'owl.pid'), 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return undefined;
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' ? -1 : undefined; // EPERM: alive, owned by someone else
  }
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
  const running = serverPid(o.dataDir);
  if (running) throw new Error(`The OWL server is running (pid ${running}): stop it before restoring, or it keeps writing to the old database`);
  // A private folder (0700): the decrypted database must not be readable by other users while it is being checked.
  const workDir = mkdtempSync(join(o.dataDir, '.restore-'));
  const work = join(workDir, 'owl.sqlite');
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
      if (!existsSync(target + ext)) continue;
      if (previous) renameSync(target + ext, `${previous}${ext}`);
      else rmSync(target + ext, { force: true }); // no database to pair it with: it would be replayed onto the restored one
    }
    renameSync(work, target);
    return { database: target, ...(previous ? { previous: basename(previous) } : {}), sessions: check.sessions ?? 0, messages: check.messages ?? 0 };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
