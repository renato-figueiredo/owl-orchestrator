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
- [x] 08 Anexos/prints (`build/prompts/08`) — QA e revisão feitos; achados do QA corrigidos
- [x] 09 Exclusão, lixeira, limpeza, backup (`build/prompts/09`) — QA e revisão feitos; achados do QA corrigidos
- [x] 10 Servidor MCP de memória (`build/prompts/10`) — QA e revisão feitos
- [x] 11 Revisão e testes da fase 1 (`build/prompts/11`) — revisão, E2E (7 cenários) e README feitos em 2026-10-15; sem bloqueantes

## Fase 2 — Equipes
- [x] 12 Agentes como arquivos + pipelines YAML (`build/prompts/12`) — implementado em 2026-10-15; `qa-testes` e `revisor` rodam junto do 13
- [x] 13 Quadro local + portões de aprovação (`build/prompts/13`) — implementado em 2026-10-15; `qa-testes` e `revisor` rodam junto do 12
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
**Próximo passo:** `qa-testes` + `revisor` do 12 e do 13 juntos; depois prompt 14 (projetos, equipes e worktrees), sozinho. Fase 1 concluída (prompt 11). O 08/09 foi revisado de novo em 2026-10-15 (a lista antiga do revisor se perdeu): 9 itens corrigidos, 1 aberto abaixo.

**Revisão**
- [x] `qa-testes` e `revisor` nos prompts 02, 03 e 04 rodados em 2026-10-15; 3 bloqueantes corrigidos (NUL no adaptador, Host/Origin, raízes de pastas).
- [ ] Revisão ainda sem registro para os prompts 02 (banco): confirmar se não houve bloqueantes.
- [ ] Permitir o host Tailscale no guard quando o acesso remoto for implementado.

**Repositório / GitHub**
- [x] Os 3 PRs do Dependabot foram mesclados em 2026-10-15 (`checkout` 7, `setup-node` 7, `pnpm/action-setup` 6).
- [ ] Conferir em Settings → Security se o relato privado de vulnerabilidades (`SECURITY.md`) está ativo.
- [ ] Decidir sobre o nome do bot de dependências: manter Dependabot (personalizando prefixo/labels) ou migrar para Renovate com um GitHub App próprio.

**Interface**
- [ ] Rodar `qa-testes` e `revisor` no prompt 07 (contexto, resumo, fatos, troca de provedor).
- [x] `qa-testes` e `revisor` no prompt 06 rodados em 2026-10-15; 3 itens importantes corrigidos (saída vazia, slot de sessão, pausas órfãs).
- [ ] Slot de sessão por (sessão, provedor) para alternar Claude/Codex sem perder o `--resume`.
- [x] `qa-testes` e `revisor` no prompt 05 rodados em 2026-10-15 (E2E: `pnpm --filter @owl/web test:e2e`; precisa de `pnpm exec playwright install chromium` uma vez).
- [ ] Anexos/imagens na caixa de envio (prompt 08); "melhorar prompt" (prompt 06); lixeira/exclusão de conversas (prompt 09, feito).
- [ ] Mostrar o uso das LLMs por sessão (tokens e custo, somando os `runs`; só para provedores que informam), com parâmetros configuráveis (ex.: limites e alertas).

- [ ] Prompt 09: apagar a sessão da CLI ficou só como aviso (decisão em `docs/03-data/deletion-and-backup.md`); reavaliar se as CLIs ganharem comando oficial.
- [ ] Prompt 09: testar `age`/`rclone` reais de ponta a ponta (os testes usam binários falsos); instalar `age` e `rclone` quando for ligar o backup.
- [ ] Prompt 09 (revisão): a purga de uma conversa pode apagar um blob que o usuário acabou de reenviar por dedupe (mesmo print de uma conversa na lixeira) antes de ele anexar; o envio falha com 400 `attachment_not_found` e é preciso colar de novo. Estreito; corrigir respeitando `visto_em` na purga exige ajustar os testes que purgam logo após o upload.
- [ ] Prompt 09: o E2E cobre anexo → lixeira → exclusão (`attachment-trash.spec.ts`); backup ainda só tem testes de API.

**Revisão da fase 1 (prompt 11)** — corrigidos: runs presas em `rodando` após reinício (`runs.failInterrupted` no startup) e `approvals` (prompt editado, erro do refinador) que sobravam na exclusão definitiva. Abertos:
- [ ] `--allowedTools Read` sem escopo quando há imagem (`claude-cli.ts`): trocar por `Read(//<pasta-da-imagem>/**)` e confirmar com o `claude` real que fora da pasta é negado.
- [ ] Nome do anexo no rótulo do prompt: filtrar `"`, `[` e `]` (ou citar com JSON).
- [x] Filho recebia o `process.env` inteiro: agora `childEnv` (lista permitida + `OWL_ENV_PASSTHROUGH`), testado com `claude` e `codex` reais no prompt 12.
- [ ] Fatos fixados novos no caminho com resume entram fora de `orcamentoTokens`; histórico lido inteiro a cada run (usar `lastN` + resumo).
- [ ] Limpar `data/mcp/*.json` que sobram após crash, no startup.
- [ ] Avaliar `purgaAutomatica` desligada por padrão ou aviso na primeira vez.
- [ ] CLAUDE.md lista `packages/memory` como montador de contexto, mas o código está em `packages/core/src/memory`.

**Agentes e pipelines (prompt 12)**
- [x] `qa-testes` (2026-10-15): critérios do 12 cobertos por testes existentes (agente inválido: `agents-library.test.ts`/`agents-pipeline.test.ts`; mesmo agente em duas sessões e pipeline de 3 etapas com outro provedor: `agents-pipeline.test.ts`; `quando`/passagem de saída/`tentativas`: `pipeline.test.ts`, `qa-pipeline-gaps.test.ts`). Nenhuma lacuna nova; `pnpm typecheck`, `lint` e `test` limpos. `revisor` (2026-10-15) feito: achados abaixo, em Quadro.
- [ ] Falha de etapa que não é o refinador (ex.: revisor): hoje só dá para dispensar; falta tentar de novo com outro provedor e pular etapa do meio (`runner.retry/continue` assumem o refinador). O `continue` na última etapa responde 409.
- [ ] Escolher o pipeline na caixa de envio (hoje só pela API: `pipeline` em `POST /sessions/:id/messages`; `GET /pipelines` lista).
- [ ] Editor de pipelines e de skills na interface (hoje só a biblioteca de agentes; pipelines e skills são arquivos).
- [ ] Skills só carregam o `SKILL.md`; arquivos auxiliares da pasta (scripts, referências) não são entregues ao agente.
- [ ] Agentes com `Edit/Write/Bash` só depois dos worktrees (prompt 14); `ferramentas` de um agente do usuário vão direto para `--allowedTools` sem aviso.
- [ ] Atualizar o índice de agentes ao mudar um arquivo sem ninguém listar/rodar (hoje reconstrói na listagem e ao iniciar pipeline; um `fs.watch` fica para depois).
- [ ] Codex ignora `ferramentas` do agente (o sandbox é fixo): documentar/validar quando um agente de Codex declarar ferramentas de escrita.

**Quadro (prompt 13)**
- [x] `qa-testes` (2026-10-15): os 3 critérios do 13 estão cobertos (`packages/board/src/board.test.ts`, `apps/server/src/board.test.ts`, `apps/web/src/board-ui.test.tsx`); novos casos em `packages/board/src/board-qa.test.ts`. Achados:
- [x] `rules.ts`: `npm publish` agora abre portão (regex `publi(car|sh)`); teste trocado de `it.fails` por `it`.
- [x] `local.ts` `decide`: aprovar a entrega com outro portão aberto grava `concluido` nos demais; o último decidido fecha o ticket (qualquer ordem).
- [x] Lista de ações destrutivas ampliada (`rmdir`, `git clean`, `shred`, `mkfs`, `dd if=`, `branch -D`, `chmod/chown -R`, `curl | sh`). **Prompt 14:** inverter para lista de permissão (só ler/testar sem portão).
- [x] Reinício: tickets `em_andamento` sem run viram `bloqueado` com comentário (`LocalBoard.recoverInterrupted`, chamado em `main.ts`).
- [x] Comentários no `ticketBrief` agora dentro de `<comentarios>` com cada linha citada (não forjam cabeçalhos).
- [x] **Autenticação das rotas** (bloqueante do 14, regra de ouro 5) — feita em 2026-10-15: `SessionAuth` (`apps/server/src/auth.ts`). O servidor imprime no próprio console um código de pareamento de uso único; o navegador o troca por cookie `HttpOnly`/`SameSite=Strict` e toda rota (menos `/health` e `/auth/*`) exige a sessão. Sessões em memória: reiniciar o servidor pede novo pareamento. Testes: `auth.test.ts`, `pairing-ui.test.tsx`. Limite: um agente com `Bash` que leia o console/processo do servidor ainda poderia obter o código; o isolamento real vem com os worktrees/sandbox do 14.
- [ ] Revisor, pendentes: `ticketBrief` sem teto próprio (descrição/subtarefas/comentários fora do `CONTEXT_TOKENS`); `parseVerdict` pega o último "VEREDITO:" do texto (exigir última linha); `numero` NULL em tickets antigos (migração 0008 sem backfill); pai fecha sem portão de entrega (`closeParentIfDone`); rótulo ambíguo ao rejeitar `reprovacao`; `allowed-tools` de skill é ignorado (documentar).
- [ ] Ainda sem teste: concorrência real de portões (duas decisões simultâneas pela API) e fluxo com CLIs reais (hoje só adaptador falso e E2E com a CLI falsa).
- [ ] Fluxo de exemplo com `claude` real: o formato JSON do `po`/`tech-lead` e o `VEREDITO:` dependem de o modelo obedecer; testar e ajustar os prompts dos agentes de exemplo.
- [ ] Prefixo do ticket editável por projeto (`projects.prefixo` existe, falta API/UI) e ordem/prioridade editáveis no painel do ticket (prioridade e teto só pela criação/PATCH).
- [ ] O quadro atualiza por polling (3 s); trocar por SSE se pesar.
- [ ] Portão `confianca` só existe na API (`requestGate`); o roteador (prompt 15) é quem vai abri-lo.
- [ ] Sem exclusão de ticket (regra 5: apagar exige aprovação); definir se vira "cancelado" (Linear: `canceled`) em vez de apagar.
- [ ] Agentes só leem (sem worktree): `proposeAction` está pronto para o prompt 14 chamar antes de escrever, apagar, dar push ou mesclar.
- [ ] Equipes (`teams`/`team_members`) ainda não são usadas pelo quadro; vêm no prompt 14.

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
- [ ] Memória por agente dentro do projeto (`facts.agent_id` já existe; falta usar no montador, na API e no MCP) e escopo global para conversas sem projeto (hoje o MCP dá a elas só a própria conversa).
- [x] Prompt 10: `qa-testes` e `revisor` rodados; endurecimento feito (escritor `query_only`, `--tsconfig` fixo, resultados cercados como dado não confiável). Codex não recebe as ferramentas de memória (sem `--mcp-config`; avaliar `codex mcp`); testar o servidor MCP com o `claude` real em CI não é viável (só fake).
- [ ] `RunPanel.onRetry` troca de provedor sem passar pelo aviso de troca (prompt 07, interface).
- [ ] Apagar `references/` (clones de estudo, ~840 MB): o quadro (prompt 13) foi feito só com o schema público do Linear, sem consultar Plane/Vibe Kanban; pode apagar quando quiser.
- [ ] Sandbox opcional de agentes em container (junto ao prompt 14).

**Lançamento e divulgação (decisão de 2026-10-15: só ao final do projeto)**
- [ ] Nada de divulgação, domínio novo ou site antes de o projeto estar funcional e pronto; o foco agora é construir.
- [ ] Site de documentação/landing estático em `owl.renatofigueiredo.dev` (Cloudflare Pages ou GitHub Pages; custo zero, sem Railway, que só entra se houver backend de demo). Comprar domínio próprio apenas se houver tração; redirect 301 preserva o SEO. "owl" é um termo muito disputado: pesar um nome/domínio mais distintivo.
- [ ] Usar a construção do site como primeiro caso de uso real do próprio OWL ("este site foi feito pelo OWL").
- [ ] Divulgar (Reddit, Hacker News e afins) com README final, prints atualizados (`docs/images/`) e site no ar. O que traz público ao repositório é conteúdo (README, docs, backlinks), não o domínio.
- [ ] **README animado (tarefa para o próprio OWL, só com a arquitetura completa):** (1) SVG animado (CSS/SMIL, `docs/images/flow.svg`) com o caminho real de um pedido: prompt → refinador → aprovação → agente (Claude/Codex/Ollama) → executor → memória em camadas → resposta em streaming; 8–12 s em loop, `prefers-reduced-motion` respeitado, paleta de `brand/`, sem caminhos nem dados pessoais. (2) Versão estática do mesmo diagrama como fallback (`flow-static.svg`/PNG). (3) GIF/WebM curto da interface real (chat, memória, troca de provedor, quadro). (4) Dashboard interativo apenas no site de documentação, não no README (o GitHub não executa JavaScript). Gerar a partir de `docs/02-architecture/architecture.md` e regenerar a cada mudança de arquitetura. Princípios em `docs/05-ui/motion-and-animation.md`.
