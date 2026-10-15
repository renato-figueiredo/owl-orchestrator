# 10 — Roadmap

Projeto **OWL**. Marque `[x]` ao concluir. Cada item aponta para o prompt correspondente.

## Fase 1 — Núcleo
- [x] 01 Setup do monorepo, licença, CONTRIBUTING, CI básico (`build/prompts/01`)
- [x] 02 Banco: conexão, migrações, schema (`build/prompts/02`)
- [x] 03 Adaptadores `claude-cli` e `codex-cli` (Codex só texto, não verificado — ver architecture.md) (`build/prompts/03`)
- [x] 04 Servidor Fastify + SSE + executor simples (`build/prompts/04`)
- [x] 05 Interface de chat com stream (`build/prompts/05`)
- [x] 06 Pipeline "melhorar prompt" (`build/prompts/06`)
- [x] 07 Memória em camadas + resumo incremental (`build/prompts/07`)
- [ ] 08 Anexos/prints (`build/prompts/08`)
- [ ] 09 Exclusão, lixeira, limpeza, backup (`build/prompts/09`)
- [ ] 10 Servidor MCP de memória (`build/prompts/10`)
- [ ] 11 Revisão e testes da fase 1 (`build/prompts/11`)

## Fase 2 — Equipes
- [ ] 12 Agentes como arquivos + pipelines YAML (`build/prompts/12`)
- [ ] 13 Quadro local + portões de aprovação (`build/prompts/13`)
- [ ] 14 Projetos, equipes, gerente multi-projeto, worktrees (`build/prompts/14`)
- [ ] 15 Roteador e métricas (`build/prompts/15`)
- [ ] 16 Integração com Linear (`build/prompts/16`)

- [ ] 17 Motion e animações (`build/prompts/17-motion.md`)
- [ ] 18 Adaptador Ollama (`build/prompts/18-ollama.md`)

## Futuro
- [x] Dev container (`.devcontainer/`, `docs/06-research/containers.md`)
- [ ] Sandbox opcional de agentes em container (junto ao prompt 14)
- [ ] GitHub Issues como quadro
- [ ] Adaptadores de API e Ollama
- [ ] Embeddings opcionais
- [ ] Pacote de vídeo (ffmpeg, Remotion)

## Pendências (atualizado em 2026-10-14)
**Próximo passo:** `qa-testes` e `revisor` no prompt 07; depois prompt 08 (anexos). 

**Revisão**
- [x] `qa-testes` e `revisor` nos prompts 02, 03 e 04 rodados em 2026-10-15; 3 bloqueantes corrigidos (NUL no adaptador, Host/Origin, raízes de pastas).
- [ ] Revisão ainda sem registro para os prompts 02 (banco): confirmar se não houve bloqueantes.
- [ ] Permitir o host Tailscale no guard quando o acesso remoto for implementado.

**Repositório / GitHub**
- [ ] Mesclar os 3 PRs do Dependabot (`checkout` 4→7, `setup-node` 4→7, `pnpm/action-setup` 4→6; todos com CI verde). Mesclar em sequência (mexem no `ci.yml`).
- [ ] Conferir em Settings → Security se o relato privado de vulnerabilidades (`SECURITY.md`) está ativo.
- [ ] Decidir sobre o nome do bot de dependências: manter Dependabot (personalizando prefixo/labels) ou migrar para Renovate com um GitHub App próprio.

**Interface**
- [ ] Rodar `qa-testes` e `revisor` no prompt 07 (contexto, resumo, fatos, troca de provedor).
- [x] `qa-testes` e `revisor` no prompt 06 rodados em 2026-10-15; 3 itens importantes corrigidos (saída vazia, slot de sessão, pausas órfãs).
- [ ] Slot de sessão por (sessão, provedor) para alternar Claude/Codex sem perder o `--resume`.
- [x] `qa-testes` e `revisor` no prompt 05 rodados em 2026-10-15 (E2E: `pnpm --filter @owl/web test:e2e`; precisa de `pnpm exec playwright install chromium` uma vez).
- [ ] Anexos/imagens na caixa de envio (prompt 08); "melhorar prompt" (prompt 06); lixeira/exclusão de conversas (prompt 09).
- [ ] Mostrar o uso das LLMs por sessão (tokens e custo, somando os `runs`; só para provedores que informam), com parâmetros configuráveis (ex.: limites e alertas).

**Adaptadores**
- [x] Codex: JSON, resume e erros capturados do `codex-cli` 0.162 real (fixtures `codex-*.jsonl`). Falta: imagens (prompt 08).
- [ ] Detectar o erro real de limite do Codex quando acontecer (hoje só há a mensagem de modelo inválido) para oferecer troca para haiku/Ollama.
- [ ] Imagens no `claude-cli` (hoje devolve `error`): fazer junto do prompt 08.
- [ ] Adaptador Ollama opcional (prompt 18); Ollama já roda fora do repositório.

**Revisão do M0 (2026-10-15) — pendências**
- [ ] **Decidir o local padrão dos dados**: hoje `OWL_DATA_DIR=./data` é relativo ao diretório do processo (via `pnpm dev` vira `apps/server/data/`, ignorado pelo git). Opções: `~/.owl/` (alinha com a biblioteca global de agentes) ou raiz do repositório.
- [ ] Rodar o E2E no CI (job com `playwright install --with-deps chromium`); hoje só typecheck, lint, test e build.
- [ ] Reduzir o tamanho do contexto do executor: o run do `claude` mediu ~97k tokens de entrada numa conversa simples (cwd com `CLAUDE.md` e ferramentas); medir com pasta vazia.

- [ ] Empacotamento/distribuição: o servidor roda via `tsx` (`pnpm --filter @owl/server start`) porque os pacotes do workspace exportam TypeScript; um build de produção (bundle) fica para quando houver distribuição.

- [ ] Capturar prints do app (`docs/images/`, nomes sugeridos em `docs/images/README.md`) e ligar nos READMEs (há um comentário HTML marcando o lugar). Refazer antes de um release, a UI ainda muda.
- [ ] Manter `docs/guide/` (EN + pt-BR) em dia a cada prompt que mudar o uso (memória, anexos, lixeira).

**Limpeza e hardening**
- [ ] Memória por agente dentro do projeto (`facts.agent_id` já existe; falta usar no montador e na API) e escopo global para conversas sem projeto (prompt 10, junto do MCP de memória).
- [ ] `RunPanel.onRetry` troca de provedor sem passar pelo aviso de troca (prompt 07, interface).
- [ ] Apagar `references/` (clones de estudo, ~840 MB) ao terminar de consultar Plane e Vibe Kanban para o quadro (prompt 13).
- [ ] Sandbox opcional de agentes em container (junto ao prompt 14).

**Lançamento e divulgação (decisão de 2026-10-15: só ao final do projeto)**
- [ ] Nada de divulgação, domínio novo ou site antes de o projeto estar funcional e pronto; o foco agora é construir.
- [ ] Site de documentação/landing estático em `owl.renatofigueiredo.dev` (Cloudflare Pages ou GitHub Pages; custo zero, sem Railway, que só entra se houver backend de demo). Comprar domínio próprio apenas se houver tração; redirect 301 preserva o SEO. "owl" é um termo muito disputado: pesar um nome/domínio mais distintivo.
- [ ] Usar a construção do site como primeiro caso de uso real do próprio OWL ("este site foi feito pelo OWL").
- [ ] Divulgar (Reddit, Hacker News e afins) com README final, prints atualizados (`docs/images/`) e site no ar. O que traz público ao repositório é conteúdo (README, docs, backlinks), não o domínio.
