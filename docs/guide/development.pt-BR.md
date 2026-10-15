# Desenvolvimento

[← Guia](README.pt-BR.md) · [English](development.md) · Português (BR)

## Estrutura do repositório
| Caminho | Para quê |
|---|---|
| `apps/server` | API Fastify: sessões, runs, streaming SSE, executor com fila, orquestrador de pipeline |
| `apps/web` | Interface React + Tailwind (chat, painel de execução, revisão do prompt melhorado) |
| `packages/core` | Adaptadores de provedor (`claude-cli`, `codex-cli`), configuração, arquivos de agente, "stepper" de pipeline |
| `packages/db` | Conexão SQLite, migrações versionadas, repositórios tipados |
| `packages/board`, `memory`, `mcp-memory`, `ui` | Espaços reservados para os próximos prompts (veja o [roadmap](../roadmap.md)) |
| `examples/` | Agentes (`agents/*.md`) e pipelines (`pipelines/*.yaml`) |
| `docs/` | Documentos de projeto (pastas numeradas, em português) e este guia |
| `build/` | Os prompts de construção passo a passo e como usá-los |
| `.claude/agents/` | Subagentes que constroem este projeto |
| `brand/` | Logo e identidade |
| `references/` | Clones rasos de projetos upstream para estudo (ignorado pelo git, grande) |

## Comandos
```bash
pnpm dev                              # servidor (4317) + web (5173)
pnpm typecheck && pnpm lint && pnpm test
pnpm build                            # compila o app web (o servidor roda via tsx)
pnpm --filter @owl/server start       # só o servidor
pnpm --filter @owl/web test:e2e       # testes no navegador; 1ª vez: pnpm --filter @owl/web exec playwright install chromium
pnpm --filter @owl/core try "diga ok" # uma chamada real pelos adaptadores (gasta um pouco do limite da sua CLI)
```

## Testes
- **Unitários e de integração** (Vitest): os adaptadores são testados com **saídas reais capturadas das CLIs** (fixtures sanitizadas em
  `packages/core/test/fixtures/`) e uma CLI falsa (`packages/core/test/fake-cli.mjs`), então nenhum teste precisa de login nem gasta tokens.
- **Web**: Testing Library com jsdom (`EventSource` e `fetch` falsos).
- **E2E** (Playwright): o app de verdade contra um servidor cujas CLIs são trocadas pela falsa (`apps/server/e2e/server.ts`), nas
  portas 4318/5174 para não colidir com o `pnpm dev`.

## Regras de ouro
Leia o [`CLAUDE.md`](../../CLAUDE.md) primeiro. As que mais importam: nunca ler nem guardar credenciais das CLIs; sempre `spawn` com
array de argumentos (nunca string de shell); escutar só em `127.0.0.1`; ações destrutivas exigem aprovação humana; nada de código vazado
ou proprietário. Detalhes: [regras e conformidade](../01-product/rules-and-compliance.md) e [CONTRIBUTING](../../CONTRIBUTING.md).

## Como o projeto é construído
O OWL é construído em passos pequenos a partir de [`build/prompts/`](../../build/prompts/) (veja [`build/HOW-TO-USE.pt-BR.md`](../../build/HOW-TO-USE.pt-BR.md)),
cada um seguido de uma passada de QA e de uma revisão de código, com as decisões registradas em
[`docs/02-architecture/architecture.md`](../02-architecture/architecture.md) e o progresso em [`docs/roadmap.md`](../roadmap.md).
