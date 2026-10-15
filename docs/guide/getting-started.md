# Getting started

[← Guide](README.md) · English · [Português (BR)](getting-started.pt-BR.md)

OWL runs on your machine and talks to the **official CLIs you already use**. It never sees your passwords or tokens:
each CLI keeps its own login.

## Requirements
- **Node.js 22+** and **pnpm** (the repo pins the pnpm version through `packageManager`).
- At least one of these CLIs, installed **and logged in** (OWL checks with `--version` and shows what it finds):
  - `claude` (Claude Code)
  - `codex` (OpenAI Codex CLI)
- Linux or macOS. Windows is untested.

## Install and run
```bash
git clone https://github.com/renato-figueiredo/owl-orchestrator.git
cd owl-orchestrator
pnpm install
pnpm dev
```
`pnpm dev` starts two processes:

| What | Address |
|---|---|
| API server | http://127.0.0.1:4317 (`/health` answers `{"status":"ok"}`) |
| Web app | **http://127.0.0.1:5173** ← open this one |

Both listen on **loopback only**: nothing is reachable from other machines.

## First conversation
1. Open http://127.0.0.1:5173.
2. Click **Projeto +** and create a project: a name and the **folder** it works in (it must be inside your home folder, see
   [Configuration](configuration.md)). Optional: instructions that every run in the project will receive.
3. Click the **+** next to the project name to start a conversation in it.
4. Pick the provider (`claude-cli` or `codex-cli`; a CLI that is not installed is shown as unavailable), write a message and press **Enter**.
5. The answer streams in. The right panel shows status, tools used and tokens.

Next: [How to use](how-to-use.md).

## Where your data goes
Conversations, runs and projects are stored in a local SQLite file (`OWL_DATA_DIR`, default `./data` relative to where the
server runs; with `pnpm dev` that is `apps/server/data/`, ignored by git). Nothing is sent anywhere except to the CLI you chose.
