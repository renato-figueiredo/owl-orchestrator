<p align="center"><img src="brand/logo-animated.svg" width="96" alt="OWL logo"></p>
<h1 align="center">OWL</h1>
<p align="center"><b>Orchestrator for Work &amp; LLMs</b><br>
Local-first orchestrator of AI agents · English · <a href="README.pt-BR.md">Português (BR)</a></p>

> **Status: pre-alpha — the chat core works (M0).** You can chat with Claude Code and Codex through your own logged-in CLIs, per project, with streaming, cancel, "improve prompt" and light/dark themes. Memory, attachments, teams and the board are still planned; see the [roadmap](docs/roadmap.md).

OWL runs the **official CLIs** (Claude Code, Codex) and local models (Ollama) as subprocesses on your own machine,
with a local web UI, layered memory, reusable agents, per-project teams, a Linear-style ticket board with human
approval gates, and cost-aware routing.

> Each person uses **their own accounts and CLIs on their own machine**. OWL never reads, copies or stores credentials.
> See [rules & compliance](docs/01-product/rules-and-compliance.md).

## Highlights (planned)
- Streaming chat and run timeline over SSE, bound to `127.0.0.1`.
- "Improve prompt" pipelines (one model rewrites, another executes).
- Layered memory in SQLite (pinned facts, summaries, recent messages, FTS5) + MCP memory server.
- Reusable agents as Markdown files; teams per project; git worktree per developer agent.
- Local kanban board modeled on Linear's public schema; optional Linear mirror.
- Approval gates for destructive or expensive actions; per-run cost metrics.
- Smooth, accessible motion (Motion, AutoAnimate, dnd-kit).

## Repository layout
| Path | Purpose |
|---|---|
| `apps/` | `server` (Fastify + SSE), `web` (React) |
| `packages/` | `core`, `db`, `board`, `memory`, `mcp-memory`, `ui` |
| `docs/` | Product, architecture, data, agents & board, UI, research |
| `build/` | Step-by-step build prompts for Claude Code |
| `.claude/agents/` | Subagents that build this project |
| `examples/` | Execution agents and pipelines |
| `brand/` | Logo and identity |
| `references/` | Shallow clones of upstream projects for study (gitignored) |

## Getting started (for contributors)
```bash
pnpm install
pnpm dev        # server on 127.0.0.1:4317 (/health) + web on 127.0.0.1:5173
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @owl/web test:e2e   # browser tests (first time: pnpm --filter @owl/web exec playwright install chromium)
# next steps: build/HOW-TO-USE.pt-BR.md, one prompt at a time
```
Prerequisites to actually chat: the `claude` and/or `codex` CLI installed and logged in. Open http://127.0.0.1:5173. The server runs through `tsx` (`pnpm --filter @owl/server start`); there is no production bundle yet.

Configuration (see [`.env.example`](.env.example)): `OWL_PORT`, `OWL_DATA_DIR`, `OWL_CONCURRENCY`, `OWL_WORKSPACE_ROOTS`
(folders agents may work in; default your home folder), `OWL_ALLOWED_ORIGINS`.
The API only answers on loopback hosts and refuses cross-site browser requests.

## Disclaimer
Not affiliated with Anthropic, OpenAI or Linear. OWL only runs the official CLIs you installed and authenticated.
You are responsible for complying with each provider's terms; subscription rules change often.
Docs are currently written in Brazilian Portuguese; English translations are welcome.

## License
[MIT](LICENSE)
