# Development

[← Guide](README.md) · English · [Português (BR)](development.pt-BR.md)

## Repository layout
| Path | Purpose |
|---|---|
| `apps/server` | Fastify API: sessions, runs, SSE streaming, queued executor, pipeline runner |
| `apps/web` | React + Tailwind interface (chat, run panel, refined-prompt review) |
| `packages/core` | Provider adapters (`claude-cli`, `codex-cli`), config, agent files, pipeline stepper |
| `packages/db` | SQLite connection, versioned migrations, typed repositories |
| `packages/board`, `memory`, `mcp-memory`, `ui` | Placeholders for upcoming prompts (see the [roadmap](../roadmap.md)) |
| `examples/` | Agents (`agents/*.md`) and pipelines (`pipelines/*.yaml`) |
| `docs/` | Design docs (numbered folders, Brazilian Portuguese) and this guide |
| `build/` | The step-by-step build prompts and how to use them |
| `.claude/agents/` | Subagents that build this project |
| `brand/` | Logo and identity |
| `references/` | Shallow clones of upstream projects for study (gitignored, large) |

## Commands
```bash
pnpm dev                              # server (4317) + web (5173)
pnpm typecheck && pnpm lint && pnpm test
pnpm build                            # builds the web app (the server runs through tsx)
pnpm --filter @owl/server start       # server only
pnpm --filter @owl/web test:e2e       # browser tests; first time: pnpm --filter @owl/web exec playwright install chromium
pnpm --filter @owl/core try "say ok"  # one real call through the adapters (spends a little of your CLI limit)
```

## Tests
- **Unit and integration** (Vitest): adapters are tested against **real captured CLI output** (sanitized fixtures in
  `packages/core/test/fixtures/`) and a fake CLI (`packages/core/test/fake-cli.mjs`), so no test needs a login or spends tokens.
- **Web**: Testing Library with jsdom (fake `EventSource` and `fetch`).
- **E2E** (Playwright): the real app against a server whose CLIs are replaced by the fake one (`apps/server/e2e/server.ts`), on
  ports 4318/5174 so it does not collide with `pnpm dev`.

## Ground rules
Read [`CLAUDE.md`](../../CLAUDE.md) first. The ones that matter most: never read or store CLI credentials; always `spawn` with an
argument array (never a shell string); listen on `127.0.0.1` only; destructive actions need human approval; no leaked or proprietary
code. Details: [rules & compliance](../01-product/rules-and-compliance.md) and [CONTRIBUTING](../../CONTRIBUTING.md).

## How the project is built
OWL is built in small steps from [`build/prompts/`](../../build/prompts/) (see [`build/HOW-TO-USE.pt-BR.md`](../../build/HOW-TO-USE.pt-BR.md)),
each one followed by a QA pass and a code review, with decisions recorded in
[`docs/02-architecture/architecture.md`](../02-architecture/architecture.md) and progress in [`docs/roadmap.md`](../roadmap.md).
