# CLAUDE.md — project instructions

## What it is
**OWL** — *Orchestrator for Work & LLMs*. Local orchestrator of AI agents (coding first). Runs the official `claude`
and `codex` CLIs (and local Ollama models) as subprocesses, streams execution to a local web UI, stores everything
in SQLite, and coordinates agents through a local Linear-style board. Always read the doc named in the prompt before changing code.

## Golden rules (never violate)
1. **Credentials**: never read, copy, log, store or forward CLI tokens/OAuth. Only call the binaries.
2. **Leaked code**: never use or derive from the leaked Claude Code source (npm, Mar 2026) or any proprietary code (incl. Linear's web bundle).
3. **Network**: the server listens on `127.0.0.1` only by default.
4. **Subprocesses**: always `spawn` with an args array, never a shell string.
5. **Dangerous actions** (deleting user files, push, deploy, merge) require human approval.
6. No "Claude" or "GPT" in product or package names (trademarks).

## Stack
TypeScript strict · Node LTS · pnpm workspaces · Fastify + SSE · better-sqlite3 + versioned SQL migrations ·
Vite + React · zod · YAML/Markdown-frontmatter configs · sharp · vitest (+ Playwright later) ·
Motion, AutoAnimate, dnd-kit for UI (see `docs/05-ui/motion-and-animation.md`).

## Repository layout
```
apps/server          Fastify, routes, SSE
apps/web             React UI
packages/core        types, adapters, pipeline executor, router
packages/db          connection, migrations, repositories
packages/board       BoardProvider: local (SQLite) + linear mirror
packages/memory      context assembler, summaries, FTS
packages/mcp-memory  MCP memory server
packages/ui          shared components + motion primitives
brand/               logo and identity
docs/                01-product 02-architecture 03-data 04-agents-and-board 05-ui 06-research + roadmap.md
build/               prompts/ (step-by-step build prompts) and HOW-TO-USE
.claude/agents/      subagents that BUILD this project
examples/            execution agents and pipelines
references/          shallow clones for study (gitignored)
scripts/             repo tooling
```

## Doc map
| Topic | File |
|---|---|
| Vision | `docs/01-product/vision.md` |
| Rules & compliance | `docs/01-product/rules-and-compliance.md` |
| Architecture | `docs/02-architecture/architecture.md` |
| Routing & costs | `docs/02-architecture/routing-and-costs.md` |
| Memory & context | `docs/03-data/memory-and-context.md` |
| Attachments | `docs/03-data/attachments-and-images.md` |
| Database | `docs/03-data/database.md` |
| Deletion & backup | `docs/03-data/deletion-and-backup.md` |
| Agents, teams, board | `docs/04-agents-and-board/agents-teams-board.md` |
| Linear-style model | `docs/04-agents-and-board/linear-model-notes.md` |
| Motion | `docs/05-ui/motion-and-animation.md` |
| Ollama (optional) / containers / references | `docs/06-research/` |
| Remote access & backup | `docs/03-data/sync-and-access.md` |
| Roadmap | `docs/roadmap.md` |

## Commands (created in prompt 01)
`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm --filter @owl/web test:e2e` (E2E no navegador)

## Definition of done
Tests pass, typecheck clean, acceptance criteria met, docs updated, roadmap item ticked.

## How to work
One step at a time following `build/prompts/` in order. Short plan first; wait for confirmation on big changes.
Small, testable changes. Don't invent CLI flags: check `--help` of installed CLIs.
Docs are currently pt-BR (originals); READMEs are bilingual (EN primary).
