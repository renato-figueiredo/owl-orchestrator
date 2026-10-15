# 10 — Roadmap

Projeto **OWL**. Marque `[x]` ao concluir. Cada item aponta para o prompt correspondente.

## Fase 1 — Núcleo
- [x] 01 Setup do monorepo, licença, CONTRIBUTING, CI básico (`build/prompts/01`)
- [x] 02 Banco: conexão, migrações, schema (`build/prompts/02`)
- [x] 03 Adaptadores `claude-cli` e `codex-cli` (Codex só texto, não verificado — ver architecture.md) (`build/prompts/03`)
- [x] 04 Servidor Fastify + SSE + executor simples (`build/prompts/04`)
- [ ] 05 Interface de chat com stream (`build/prompts/05`)
- [ ] 06 Pipeline "melhorar prompt" (`build/prompts/06`)
- [ ] 07 Memória em camadas + resumo incremental (`build/prompts/07`)
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
**Próximo passo:** prompt 05 (interface de chat), que consome as rotas do prompt 04.

**Revisão**
- [x] `qa-testes` e `revisor` nos prompts 02, 03 e 04 rodados em 2026-10-15; 3 bloqueantes corrigidos (NUL no adaptador, Host/Origin, raízes de pastas).
- [ ] Revisão ainda sem registro para os prompts 02 (banco): confirmar se não houve bloqueantes.
- [ ] Permitir o host Tailscale no guard quando o acesso remoto for implementado.

**Repositório / GitHub**
- [ ] Mesclar os 3 PRs do Dependabot (`checkout` 4→7, `setup-node` 4→7, `pnpm/action-setup` 4→6; todos com CI verde). Mesclar em sequência (mexem no `ci.yml`).
- [ ] Conferir em Settings → Security se o relato privado de vulnerabilidades (`SECURITY.md`) está ativo.
- [ ] Decidir sobre o nome do bot de dependências: manter Dependabot (personalizando prefixo/labels) ou migrar para Renovate com um GitHub App próprio.

**Interface (prompt 05+)**
- [ ] Mostrar o uso das LLMs por sessão (tokens e custo, somando os `runs`; só para provedores que informam), com parâmetros configuráveis (ex.: limites e alertas).

**Adaptadores**
- [ ] Instalar o `codex`, rodar `codex exec --help`, capturar a saída real como fixtures e implementar JSON, imagens e resume (hoje: só texto, flags não verificadas).
- [ ] Imagens no `claude-cli` (hoje devolve `error`): fazer junto do prompt 08.
- [ ] Adaptador Ollama opcional (prompt 18); Ollama já roda fora do repositório.

**Limpeza e hardening**
- [ ] Apagar `references/` (clones de estudo, ~840 MB) ao terminar de consultar Plane e Vibe Kanban para o quadro (prompt 13).
- [ ] Sandbox opcional de agentes em container (junto ao prompt 14).
