<p align="center"><img src="brand/logo-animated.svg" width="96" alt="Logo do OWL"></p>
<h1 align="center">OWL</h1>
<p align="center"><b>Orchestrator for Work &amp; LLMs</b><br>
Orquestrador local de agentes de IA · <a href="README.md">English</a> · Português (BR)</p>

> **Status: pré-alfa — planejamento e estrutura.** Ainda nada executa; veja o [roadmap](docs/roadmap.md).

O OWL roda as **CLIs oficiais** (Claude Code, Codex) e modelos locais (Ollama) como subprocessos na sua própria
máquina, com interface web local, memória em camadas, agentes reutilizáveis, equipes por projeto, um quadro de
tickets estilo Linear com aprovação humana e roteamento por custo.

> Cada pessoa usa **as próprias contas e CLIs na própria máquina**. O OWL nunca lê, copia ou guarda credenciais.
> Veja [regras e conformidade](docs/01-product/rules-and-compliance.md).

## Destaques (planejados)
- Chat com stream e linha do tempo da execução via SSE, só em `127.0.0.1`.
- Pipelines de "melhorar prompt" (um modelo reescreve, outro executa).
- Memória em camadas no SQLite (fatos fixados, resumos, últimas mensagens, FTS5) + servidor MCP de memória.
- Agentes reutilizáveis em Markdown; equipes por projeto; git worktree por agente desenvolvedor.
- Quadro kanban local baseado no schema público do Linear; espelho opcional no Linear.
- Portões de aprovação para ações destrutivas ou caras; métricas de custo por execução.
- Movimento fluido e acessível (Motion, AutoAnimate, dnd-kit).

## Estrutura do repositório
| Caminho | Para quê |
|---|---|
| `apps/` | `server` (Fastify + SSE), `web` (React) |
| `packages/` | `core`, `db`, `board`, `memory`, `mcp-memory`, `ui` |
| `docs/` | Produto, arquitetura, dados, agentes e quadro, UI, pesquisa |
| `build/` | Prompts passo a passo para construir com o Claude Code |
| `.claude/agents/` | Subagentes que constroem este projeto |
| `examples/` | Agentes de execução e pipelines |
| `brand/` | Logo e identidade |
| `references/` | Clones rasos de projetos upstream para estudo (ignorado pelo git) |

## Como começar (contribuidores)
```bash
pnpm install
pnpm dev        # servidor em 127.0.0.1:4317 (/health) + web em 127.0.0.1:5173
pnpm typecheck && pnpm lint && pnpm test
# próximos passos: build/HOW-TO-USE.pt-BR.md, um prompt por vez
```

## Aviso
Sem afiliação com Anthropic, OpenAI ou Linear. O OWL apenas executa as CLIs oficiais instaladas e autenticadas por
você. Você é responsável por respeitar os termos de cada provedor; as regras de assinatura mudam com frequência.

## Licença
[MIT](LICENSE)
