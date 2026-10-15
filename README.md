<p align="center"><img src="brand/logo-animated.svg" width="96" alt="OWL logo"></p>
<h1 align="center">OWL</h1>
<p align="center"><b>Orchestrator for Work &amp; LLMs</b><br>
Local-first orchestrator of AI agents · English · <a href="README.pt-BR.md">Português (BR)</a></p>

> **Status: pre-alpha — planning and scaffolding.** Nothing runs yet; see the [roadmap](docs/roadmap.md).

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
# next steps: build/HOW-TO-USE.pt-BR.md, one prompt at a time
```

## Disclaimer
Not affiliated with Anthropic, OpenAI or Linear. OWL only runs the official CLIs you installed and authenticated.
You are responsible for complying with each provider's terms; subscription rules change often.
Docs are currently written in Brazilian Portuguese; English translations are welcome.

## License
[MIT](LICENSE)
