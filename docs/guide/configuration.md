# Configuration

[← Guide](README.md) · English · [Português (BR)](configuration.pt-BR.md)

OWL reads environment variables (see [`.env.example`](../../.env.example); copy it to `.env` if you like, and never commit it).

| Variable | Default | What it does |
|---|---|---|
| `OWL_PORT` | `4317` | Port of the API server. |
| `OWL_DATA_DIR` | `./data` | Folder of the SQLite database. A relative path is relative to where the server runs (with `pnpm dev`: `apps/server/`). |
| `OWL_CONCURRENCY` | `1` | Runs executing at once (1–16). A single conversation never runs two at the same time. |
| `OWL_MAX_ATTACHMENT_MB` | `10` | Largest image accepted when you attach a picture (0.1–100 MB, measured before OWL shrinks it). |
| `OWL_WORKSPACE_ROOTS` | your home folder | Folders where projects and runs may work, separated by `:`. See below. |
| `OWL_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the API, comma-separated. |
| `OWL_WEB_PORT` | `5173` | Port of the web dev server (development only). |

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
