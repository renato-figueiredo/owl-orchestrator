# Remote access & backup (lightweight)

## Sizing
OWL stores text and metadata; images live as files outside the DB. Intense personal use is tens of MB/year
(see `database.md`). Conclusion: **no database server is needed**. SQLite stays local, as the single source of truth.

## Access from anywhere
Do **not** host the DB or open a port. Instead, reach your own machine:
- **Tailscale (recommended)**: install on the PC and phone; `tailscale serve` can publish the local UI to your tailnet only.
  OWL still binds `127.0.0.1`. Needs the PC to be on.
- Alternative later: a read-only exported snapshot (static page) for viewing when the PC is off.
- Never forward a router port; never bind `0.0.0.0`.

## Backup
Layers, all optional and off by default:
1. **Snapshot** — daily `VACUUM INTO 'backups/YYYY-MM-DD.db'` (consistent, WAL-safe). Keep the last N (default 14).
2. **Encrypt before leaving the machine** — `age` (public-key) on the snapshot. Conversations can hold secrets.
3. **Ship it** — `rclone` to any remote the user owns (Google Drive, Backblaze B2, Cloudflare R2, a NAS).
   Attachments and configs: `restic` (encrypted, deduplicated) to the same remote.
4. **Continuous (advanced)** — Litestream to S3-compatible storage.
5. **Restore drill** — a documented `owl restore <file>` and a test that restores a snapshot into a temp dir.

## Rules
- Never sync the live `.db` (or its `-wal`/`-shm`) through Drive/Dropbox/OneDrive.
- Remote credentials and `age` keys live in the user's config/OS keychain, never in the repo or logs.
- Backup destination is configured per user (`OWL_BACKUP_*`); the project ships no default remote.
