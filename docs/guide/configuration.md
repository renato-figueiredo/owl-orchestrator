# Configuration

[← Guide](README.md) · English · [Português (BR)](configuration.pt-BR.md)

OWL reads environment variables (see [`.env.example`](../../.env.example); copy it to `.env` if you like, and never commit it).

| Variable | Default | What it does |
|---|---|---|
| `OWL_PORT` | `4317` | Port of the API server. |
| `OWL_DATA_DIR` | `./data` | Folder of the SQLite database. A relative path is relative to where the server runs (with `pnpm dev`: `apps/server/`). |
| `OWL_CONCURRENCY` | `1` | Runs executing at once (1–16). A single conversation never runs two at the same time. |
| `OWL_MAX_ATTACHMENT_MB` | `10` | Largest image accepted when you attach a picture (0.1–100 MB, measured before OWL shrinks it). |
| `OWL_BACKUP_AGE_RECIPIENT` | none | Public key (`age1…`) that encrypts backups. See [Backup](#backup). |
| `OWL_BACKUP_RCLONE_REMOTE` | none | `rclone` destination (e.g. `myremote:owl`) that receives the encrypted backups. |
| `OWL_WORKSPACE_ROOTS` | your home folder | Folders where projects and runs may work, separated by `:`. See below. |
| `OWL_LIBRARY_DIR` | `~/.owl` | Your library of agents, skills and pipelines (`agents/`, `skills/`, `pipelines/` inside). |
| `OWL_ENV_PASSTHROUGH` | none | Extra environment variables to hand to the CLIs, comma-separated (e.g. `SSH_AUTH_SOCK`). By default the CLIs get only what they need (PATH, HOME, locale, certificates, proxy, `CLAUDE_*`, `CODEX_*`), not the server's whole environment. |
| `OWL_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the API, comma-separated. |
| `OWL_WEB_PORT` | `5173` | Port of the web dev server (development only). |

## Backup
Off by default. Turn it on in **Storage and backup** (sidebar) or take one now. Everything stays in `<OWL_DATA_DIR>/backups/`.

- **Snapshot**: a consistent copy of the database (`VACUUM INTO`, safe while OWL runs) named `owl-YYYY-MM-DD.db`; the newest N are kept (14 by default).
- **Encrypt** (recommended; conversations can hold secrets): install [`age`](https://age-encryption.org), create a key with `age-keygen -o key.txt` and set `OWL_BACKUP_AGE_RECIPIENT` to the **public** key it prints. Backups become `owl-….db.age`; the plain copy is deleted right after. Keep `key.txt` **outside** this folder and outside the repository: without it nobody, including you, can open the backups.
- **Send it elsewhere**: install [`rclone`](https://rclone.org), run `rclone config` once, then set `OWL_BACKUP_RCLONE_REMOTE=myremote:owl`. OWL refuses to upload an unencrypted snapshot. Old files on the remote are not pruned: use the remote's own lifecycle rules.
- **Credentials** (age private key, rclone login) live in your own configuration, never in OWL's database, logs or this repository.
- **Not covered by the snapshot**: the images (`<OWL_DATA_DIR>/attachments/`) and your agent files. Back them up with [restic](https://restic.net) (encrypted, deduplicated) to the same place, or any tool you like. For continuous replication of the database itself, [Litestream](https://litestream.io) works with OWL's WAL-mode SQLite.
- **Never** put the live `owl.sqlite` (or its `-wal`/`-shm`) in Dropbox/Drive/OneDrive: it can corrupt. Only the snapshots are safe to sync.

### Restoring
Stop the server, then:
```bash
pnpm owl restore path/to/owl-2026-10-15.db                       # plain snapshot
pnpm owl restore path/to/owl-2026-10-15.db.age --identity key.txt # encrypted
pnpm owl restore <file> --data-dir /somewhere/else               # try it without touching your data
```
The snapshot is checked first; the database that was there is kept next to it as `owl.sqlite.before-restore-…`. Restore the `attachments/` folder from your own copy; images missing from it simply do not show.

## Trash and cleanup
Conversations stay in the trash for 30 days (configurable, can be turned off), then are purged. At startup and every 3 hours OWL also
removes images no conversation uses and files in `attachments/` with no record, and hands free space back to the disk. Images uploaded in the last
hour are left alone (you may not have sent them yet). Only files OWL itself named (`ab/<hash>.webp`) are ever removed.

## Where agents may work (`OWL_WORKSPACE_ROOTS`)
A project folder, and any folder a run uses, must be **inside one of these roots**. This stops a mistaken (or malicious) request
from pointing an agent at the whole disk.

- The default is your home folder. To be stricter: `OWL_WORKSPACE_ROOTS=$HOME/projects`.
- **Hidden folders below a root are always refused** (`~/.ssh`, `~/.config`, …), and symlinks are followed before checking, so a link cannot escape.
- The check runs when you create a project **and again on every run**.

## Who may call the API
- The server answers only on `127.0.0.1`, and only to requests whose `Host` is `127.0.0.1`, `localhost` or `[::1]` (this blocks DNS-rebinding).
- A browser request that carries an `Origin` must come from the OWL page itself; other sites get `403` (this blocks cross-site requests
  that would otherwise use your logged-in CLI). The Vite dev server needs no exception: it proxies `/api` to the server.
- `OWL_ALLOWED_ORIGINS` is only for a front end served from another origin, e.g. `http://localhost:5173` if you change the proxy setup.

## Provider options
Provider, model and the refiner are chosen in the interface. The refiner agent and its alternatives live in
[`examples/agents/refinador-de-prompt.md`](../../examples/agents/refinador-de-prompt.md) (`provedor`, `modelo`, `fallback`).
OWL **removes API-key variables** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) from the environment of the CLIs it starts, so they use
your **subscription login** and never bill an API key by surprise.
