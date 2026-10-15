# 01 — Setup do monorepo

**Agente:** `arquiteto`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `CLAUDE.md`, `docs/01-product/vision.md`, `docs/01-product/rules-and-compliance.md`, `docs/02-architecture/architecture.md`

## Tarefa
1. Criar monorepo pnpm com `packages/core`, `packages/db`, `apps/server`, `apps/web`,
   `packages/mcp-memory` (vazio por enquanto) e `examples/`.
2. TypeScript estrito compartilhado (`tsconfig.base.json`), ESLint, Prettier, vitest.
3. Scripts na raiz: `dev`, `build`, `test`, `lint`, `typecheck`.
4. `apps/web` com Vite + React (página "olá"). `apps/server` com Fastify ouvindo em
   `127.0.0.1:PORTA` (padrão 4317, configurável) e rota `GET /health`.
5. Arquivos: `LICENSE` (MIT), `CONTRIBUTING.md` com a política de código vazado de `docs/01-product/rules-and-compliance.md`,
   `.gitignore` (incluir `data/`, `backups/`, `.env`), `.env.example`.
6. Pasta de dados configurável (padrão `./data`).
7. CI simples (GitHub Actions): install, typecheck, lint, test.
8. Atualizar o README com o aviso de não afiliação de `docs/01-product/rules-and-compliance.md`.

## Critérios de aceite
- `pnpm install && pnpm typecheck && pnpm test` passam.
- `pnpm dev` sobe servidor e web; `/health` responde; servidor não escuta em 0.0.0.0.
- LICENSE, CONTRIBUTING e aviso no README presentes.

## Não fazer
- Nenhuma chamada às CLIs ainda. Nenhum "Claude"/"GPT" em nomes de pacote.
