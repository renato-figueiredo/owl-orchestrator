import { loadConfig } from '@owl/core';
import { restoreBackup } from './restore.js';

const USAGE = `Usage: owl restore <snapshot> [--identity <age-key-file>] [--data-dir <folder>]

Puts a backup snapshot back as the database. Stop the server first. The database that was there is kept next to it
(owl.sqlite.before-restore-...). Attachments are not part of the snapshot.`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (cmd !== 'restore' || !file || file.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const dataDir = option(rest, '--data-dir') ?? loadConfig().dataDir;
  try {
    const r = await restoreBackup({ file, dataDir, identity: option(rest, '--identity') });
    console.log(`Restored ${r.sessions} conversations / ${r.messages} messages into ${r.database}`);
    if (r.previous) console.log(`The previous database was kept as ${r.previous}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}

process.exit(await main());
