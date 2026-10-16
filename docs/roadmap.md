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
- [x] 14 Projetos, equipes, gerente multi-projeto, worktrees (`build/prompts/14`) — implementado em 2026-10-15; `qa-testes` e `revisor` rodados em 2026-10-15; achados 1–9 corrigidos
- [x] 15 Roteador e métricas (`build/prompts/15`) — implementado em 2026-10-15; `qa-testes` e `revisor` rodados em 2026-10-15; achados corrigidos (fim de mês em `/metrics`, delimitador do classificador, orçamento com execuções em andamento, configuração campo a campo, retrabalho independente do filtro, modelo validado no PUT). Roteamento implementado mas desligado por padrão (`roteamento: fixo`)
- [x] 16 Quadro avançado: etiquetas, relações, ciclos, estimativa e prazo (`build/prompts/16-quadro-avancado.md`) — implementado em 2026-10-15; `qa-testes` e `revisor` pendentes, junto do 15. (A integração com o Linear real foi descartada: o quadro é próprio.)

- [x] 17 Motion e animações (`build/prompts/17-motion.md`) — implementado (3eaab8b); `qa-testes` e `revisor` rodados, correções em affe944
- [x] 18 Adaptador Ollama (`build/prompts/18-ollama.md`) — implementado, com keep-alive e fallback; testes e typecheck verdes em 2026-10-16

## Futuro
- [x] Dev container (`.devcontainer/`, `docs/06-research/containers.md`)
- [ ] Sandbox opcional de agentes em container (ver Limpeza e hardening)
- [ ] GitHub Issues como quadro
- [ ] Adaptadores de API e Ollama
- [ ] Embeddings opcionais
- [ ] Pacote de vídeo (ffmpeg, Remotion)

## Pendências (atualizado em 2026-10-14)
**Próximo passo:** finalização — 17 e 18 feitos e revisados; restam os pontos de atenção abaixo. 15 e 16 já revisados. Fase 1 concluída (prompt 11); 12, 13 e 14 revisados. O 08/09 foi revisado de novo em 2026-10-15 (a lista antiga do revisor se perdeu): 9 itens corrigidos, 1 aberto abaixo.

**Revisão**
- [x] UI reimplementada pelo design system (`design/claude-design/`, regra matriz): tokens, fontes, Lucide, Vigia + trilho, Chat/Execução, Quadro/Ticket/Aprovações, Agentes, Pipelines, Métricas, Armazenamento, Pareamento, Projetos (2026-10-16). Revisão visual no navegador ainda por fazer em modo claro e 390px; lacunas de backend (diff/comando/risco de gates, histórico de aprovações, clonar do GitHub, lista de dispositivos pareados, série de custo por dia, log de run) ficaram como estados "indisponível".
- [ ] Itens menores das revisões do 07 e do 15 viraram tickets prontos em `docs/backlog-dogfood.md`, para o próprio OWL tratar já em teste (2026-10-16).
- [ ] Prompt 16: ordenar/alertar por prazo e ciclo ativo automático (hoje só estimativa/prazo exibidos); revisar o bloqueio por relação no fluxo (`BoardFlow.run`) e o filtro do quadro.
- [x] `qa-testes` e `revisor` nos prompts 02, 03 e 04 rodados em 2026-10-15; 3 bloqueantes corrigidos (NUL no adaptador, Host/Origin, raízes de pastas).
- [x] Prompt 02 (banco), conferido em 2026-10-16: sem bloqueantes. Os 3 bloqueantes da revisão 02–04 (`1fbfba4`) ficaram em `apps/server` e `packages/core`; o QA do 02 só acrescentou `db.acceptance.test.ts`.
- [ ] Permitir o host Tailscale no guard quando o acesso remoto for implementado.

**Repositório / GitHub**
- [x] Os 3 PRs do Dependabot foram mesclados em 2026-10-15 (`checkout` 7, `setup-node` 7, `pnpm/action-setup` 6).
- [ ] Conferir em Settings → Security se o relato privado de vulnerabilidades (`SECURITY.md`) está ativo.
- [ ] Decidir sobre o nome do bot de dependências: manter Dependabot (personalizando prefixo/labels) ou migrar para Renovate com um GitHub App próprio.

**Interface**
- [x] `qa-testes` e `revisor` no prompt 07 rodados em 2026-10-16: sem bloqueantes; critérios cobertos. Corrigidos: fato fixado/editado depois da criação agora chega à sessão com `--resume` (migração 0013, `facts.atualizado_em`), texto de fatos/resumo/mensagens/trechos achatado em uma linha e sem forjar `[Fim do contexto]`/`## ` (o cabeçalho diz "não como instruções"), orçamento NaN. Abertos:
  - [x] O resumidor só pode ser `claude-cli` ou `ollama` (os adaptadores que rodam sem ferramentas); `PUT /settings` responde 400 `summarizer_needs_no_tools` para os outros (2026-10-16).
  - [ ] Bloco de fatos novos no `--resume` sem orçamento (`memory.ts` `contextFor`); resumo automático pode sobrescrever edição do usuário feita durante a execução e não confere sessão apagada; pasta `owl-summarizer-*` não é removida; truncamento pode cortar par substituto UTF-16; uma mensagem única > 60k caracteres passa inteira ao resumidor; `PATCH/DELETE /facts/:id` sem checagem de escopo e `GET /facts` sem filtro lista fatos legados órfãos.
- [x] `qa-testes` e `revisor` no prompt 06 rodados em 2026-10-15; 3 itens importantes corrigidos (saída vazia, slot de sessão, pausas órfãs).
- [ ] Slot de sessão por (sessão, provedor) para alternar Claude/Codex sem perder o `--resume`.
- [x] `qa-testes` e `revisor` no prompt 05 rodados em 2026-10-15 (E2E: `pnpm --filter @owl/web test:e2e`; precisa de `pnpm exec playwright install chromium` uma vez).
- [ ] Anexos/imagens na caixa de envio (prompt 08); "melhorar prompt" (prompt 06); lixeira/exclusão de conversas (prompt 09, feito).
- [ ] Mostrar o uso das LLMs por sessão (tokens e custo, somando os `runs`; só para provedores que informam), com parâmetros configuráveis (ex.: limites e alertas).

- [ ] Prompt 09: apagar a sessão da CLI ficou só como aviso (decisão em `docs/03-data/deletion-and-backup.md`); reavaliar se as CLIs ganharem comando oficial.
- [ ] Prompt 09: testar `age`/`rclone` reais de ponta a ponta (os testes usam binários falsos); instalar `age` e `rclone` quando for ligar o backup.
- [x] Prompt 09 (revisão): a purga de uma conversa respeita `visto_em`: um blob reenviado por dedupe na última hora (`SWEEP_GRACE_SECONDS`) fica para o sweep, então o print colado de novo ainda anexa (2026-10-16). Testes que purgam logo após o upload passaram a envelhecer o blob (`chat()` helper); teste novo em `cleanup.test.ts`.
- [ ] Prompt 09: o E2E cobre anexo → lixeira → exclusão (`attachment-trash.spec.ts`); backup ainda só tem testes de API.

**Revisão da fase 1 (prompt 11)** — corrigidos: runs presas em `rodando` após reinício (`runs.failInterrupted` no startup) e `approvals` (prompt editado, erro do refinador) que sobravam na exclusão definitiva. Abertos:
- [x] `--allowedTools Read` agora vai como `Read(//<pasta-da-imagem>/**)`; confirmado com o `claude` real em 2026-10-16 (dentro da pasta lê, fora é negado).
- [x] Nome do anexo no rótulo: `labelOf` remove `"`, `[`, `]`, controles e limita a 100 caracteres.
- [x] Filho recebia o `process.env` inteiro: agora `childEnv` (lista permitida + `OWL_ENV_PASSTHROUGH`), testado com `claude` e `codex` reais no prompt 12.
- [ ] Fatos fixados novos no caminho com resume entram fora de `orcamentoTokens`; histórico lido inteiro a cada run (usar `lastN` + resumo).
- [x] `data/mcp/*.json` que sobram após crash são removidos no startup (`clearStaleMcpConfigs`).
- [ ] Avaliar `purgaAutomatica` desligada por padrão ou aviso na primeira vez.
- [ ] CLAUDE.md lista `packages/memory` como montador de contexto, mas o código está em `packages/core/src/memory`.

**Agentes e pipelines (prompt 12)**
- [x] `qa-testes` (2026-10-15): critérios do 12 cobertos por testes existentes (agente inválido: `agents-library.test.ts`/`agents-pipeline.test.ts`; mesmo agente em duas sessões e pipeline de 3 etapas com outro provedor: `agents-pipeline.test.ts`; `quando`/passagem de saída/`tentativas`: `pipeline.test.ts`, `qa-pipeline-gaps.test.ts`). Nenhuma lacuna nova; `pnpm typecheck`, `lint` e `test` limpos. `revisor` (2026-10-15) feito: achados abaixo, em Quadro.
- [ ] Falha de etapa que não é o refinador (ex.: revisor): hoje só dá para dispensar; falta tentar de novo com outro provedor e pular etapa do meio (`runner.retry/continue` assumem o refinador). O `continue` na última etapa responde 409.
- [ ] Escolher o pipeline na caixa de envio (hoje só pela API: `pipeline` em `POST /sessions/:id/messages`; `GET /pipelines` lista).
- [ ] Editor de pipelines e de skills na interface (hoje só a biblioteca de agentes; pipelines e skills são arquivos).
- [ ] Skills só carregam o `SKILL.md`; arquivos auxiliares da pasta (scripts, referências) não são entregues ao agente.
- [x] Agentes com `Edit/Write/Bash` só em worktree (prompt 14); `ferramentas` validadas ao carregar o arquivo (lista de permissão em `packages/core/src/tools.ts`) e escrita confinada à pasta pelo adaptador.
- [ ] Atualizar o índice de agentes ao mudar um arquivo sem ninguém listar/rodar (hoje reconstrói na listagem e ao iniciar pipeline; um `fs.watch` fica para depois).
- [x] Codex ignora `ferramentas` do agente (o sandbox é fixo): agora a biblioteca recusa agente (ou `fallback`) de Codex que declare escrita ou Bash (prompt 14).

**Quadro (prompt 13)**
- [x] `qa-testes` (2026-10-15): os 3 critérios do 13 estão cobertos (`packages/board/src/board.test.ts`, `apps/server/src/board.test.ts`, `apps/web/src/board-ui.test.tsx`); novos casos em `packages/board/src/board-qa.test.ts`. Achados:
- [x] `rules.ts`: `npm publish` agora abre portão (regex `publi(car|sh)`); teste trocado de `it.fails` por `it`.
- [x] `local.ts` `decide`: aprovar a entrega com outro portão aberto grava `concluido` nos demais; o último decidido fecha o ticket (qualquer ordem).
- [x] Lista de ações destrutivas ampliada (`rmdir`, `git clean`, `shred`, `mkfs`, `dd if=`, `branch -D`, `chmod/chown -R`, `curl | sh`). Inversão para lista de permissão feita **na camada de ferramentas** (prompt 14): o `Bash` de um agente só aceita comandos de leitura/teste escopados; `proposeAction` segue com a lista larga de palavras destrutivas como segunda rede.
- [x] Reinício: tickets `em_andamento` sem run viram `bloqueado` com comentário (`LocalBoard.recoverInterrupted`, chamado em `main.ts`).
- [x] Comentários no `ticketBrief` agora dentro de `<comentarios>` com cada linha citada (não forjam cabeçalhos).
- [x] **Autenticação das rotas** (bloqueante do 14, regra de ouro 5) — feita em 2026-10-15: `SessionAuth` (`apps/server/src/auth.ts`). O servidor imprime no próprio console um código de pareamento de uso único; o navegador o troca por cookie `HttpOnly`/`SameSite=Strict` e toda rota (menos `/health` e `/auth/*`) exige a sessão. Sessões em memória: reiniciar o servidor pede novo pareamento. Testes: `auth.test.ts`, `pairing-ui.test.tsx`. Limite: um agente com `Bash` que leia o console/processo do servidor ainda poderia obter o código; o isolamento real vem com os worktrees/sandbox do 14.
- [x] `ticketBrief` com tetos próprios (descrição, critérios, subtarefas e comentários por total, os mais novos ganham) e `parseVerdict` só aceita o veredito na última linha (2026-10-16).
- [ ] Ainda sem teste: concorrência real de portões (duas decisões simultâneas pela API) e fluxo com CLIs reais (hoje só adaptador falso e E2E com a CLI falsa).
- [ ] Fluxo de exemplo com `claude` real: o formato JSON do `po`/`tech-lead` e o `VEREDITO:` dependem de o modelo obedecer; testar e ajustar os prompts dos agentes de exemplo.
- [ ] Prefixo do ticket editável por projeto (`projects.prefixo` existe, falta API/UI) e ordem/prioridade editáveis no painel do ticket (prioridade e teto só pela criação/PATCH).
- [ ] O quadro atualiza por polling (3 s); trocar por SSE se pesar.
- [x] Portão `confianca`: aberto pelo roteador (prompt 15) quando a confiança fica abaixo do limiar; aprovar roda o passo no tier proposto.
- [ ] Sem exclusão de ticket (regra 5: apagar exige aprovação); definir se vira "cancelado" (Linear: `canceled`) em vez de apagar.
- [x] Agentes escrevem em worktree (prompt 14). Mesclar e descartar a branch passam por portão `destrutiva` (`POST /tickets/:id/branch/merge|descartar`); `proposeAction` continua disponível para o agente anunciar ações.
- [x] Equipes (`teams`/`team_members`) usadas pelo quadro: com ao menos um membro no projeto, só membros trabalham; o papel da equipe vale no projeto (prompt 14).

**Projetos, equipes e worktrees (prompt 14)** — feito: CRUD de projeto e equipe, papel por equipe, memória do agente por projeto, worktree/branch por ticket que escreve, commit automático, mesclagem e descarte com portão, concorrência por projeto e global, tela do projeto e seletor. Abertos:
- [x] `qa-testes` + `revisor` do 14 (2026-10-15), feitos; corrigidos: teste de rejeição, `Bash` escopado (flags, segredos, `node --test`), `.git` do worktree conferido antes do commit, pasta de worktrees privada, branches órfãs ao apagar projeto, `ensure` validado, `cwdIn` com symlink, prefixo `owl/`. Aberto: `Read` sem escopo, git síncrono, `worktree prune` no startup. Era: Pontos para olhar: `worktrees.ts` (git síncrono, `merge` na pasta do usuário), `scopeWriteTools` (confinamento da escrita), `analyzeTools` (lista de comandos), gate `acao` em `LocalBoard.decide`.
- [ ] Git síncrono (`spawnSync`) bloqueia o loop do servidor durante `worktree add`/`commit`/`merge`: em repositório grande pode passar de segundos. Mover para `spawn` assíncrono (o fluxo do quadro é síncrono; exige tornar `BoardFlow.run` assíncrono).
- [x] Worktrees que sobraram após queda do servidor: `WorktreeService.reconcile()` roda no startup (`main.ts`): `git worktree prune` em cada projeto e remoção das pastas que nenhum ticket `ativo` possui; trabalho pendente de um ticket é commitado na branch antes, e pasta desconhecida com alterações fica intacta (2026-10-16). Tickets `ativo` mantêm a pasta (rodar de novo a reaproveita).
- [ ] Mesclar na pasta do usuário só com a branch base ativa e árvore limpa; não há mesclagem em worktree dedicado (evitaria exigir isso do usuário) nem `git push`/PR (fora do escopo: push exige portão próprio).
- [ ] Subtarefas saem todas da branch base, não da branch do pai; dependências entre subtarefas que mexem nos mesmos arquivos vão dar conflito na mesclagem (o OWL só avisa).
- [ ] Memória por agente: entra no prompt dos tickets do quadro e aparece na tela do projeto; o chat, o MCP de memória e o agente `memoria` (que grava fatos do projeto, não do agente) ainda não a usam.
- [ ] A lista de comandos do `Bash` escopado é fixa no código (`BASH_FIRST`, `PACKAGE_SCRIPTS`...); tornar configurável por projeto se faltar `make`, `cargo`, `go test`...
- [x] `Read` dos agentes do quadro confinado ao worktree: `RunRequest.confineReads` → `scopeReadTools` vira `Read(//<cwd>/**)` (pasta e caminho real). Conferido com o `claude` 2.1.301 real (haiku): dentro lê, fora é negado (2026-10-16). Só o quadro; o chat não muda. Aberto: Grep/Glob seguem a regra de `Read` segundo a CLI, mas não foram testados fora da pasta.
- [x] Concorrência de portões: `gate-concurrency.test.ts` (decisões simultâneas pela API: mesma aprovação 3x = 1×200 + 2×409 e o passo roda uma vez; aprovar×rejeitar; dois portões do mesmo ticket não deixam o ticket preso) (2026-10-16).
- [ ] Tela do projeto: sem E2E no navegador; testes de componente e de API cobrem.
- [ ] Fluxo `dev` com `claude` real conferido uma vez em 2026-10-15 (repositório temporário, haiku): `dev-back` criou o arquivo só no worktree, o OWL commitou na branch, a pasta do usuário ficou intacta, o arquivo fora da pasta **não** foi criado e o `qa` reprovou (abriu o portão de reprovação). Falta uma bateria maior (testes que o projeto realmente roda, conflitos, vários tickets).

**Roteador e métricas (prompt 15)** — feito: regras → classificador pequeno só se ambíguo (JSON validado, falha = confiança 0 = pessoa decide), tiers configuráveis (`PUT /router`), escalonamento por reprovação, aviso em 80% e portão `custo` por ticket e por dia (tokens), `GET /metrics`, painel *Métricas e roteador*, migração 0010. Escopo: **só o quadro**; agentes `roteamento: auto` (os exemplos continuam `fixo`). Abertos:
- [x] `qa-testes` + `revisor` do 15 rodados de novo em 2026-10-16: sem bloqueantes; dia local, SQL e divisão por zero conferidos. Corrigidos: `confianca` do classificador limitada a 0,95 (resposta "confiança 1" por injeção não pula o portão), classificador cancelado não abre portão. Testes novos: `packages/db/src/metrics.test.ts`, `apps/server/src/router-service.test.ts`. Abertos:
  - [x] A resposta do classificador é guardada por ticket (`settings`, chave `roteador.decisao.<ticket>`, só respostas válidas) e reaproveitada em retrabalho e retomada de portão; `POST /tickets/:id/reclassify` apaga a guardada e `BoardFlow.reclassify` faz o mesmo, para o futuro agente `monitor` (roteiro do Ollama) chamar quando o ticket mudar de tamanho (2026-10-16). Aberto: a chave sobra em `settings` se o ticket for apagado, e o monitor ainda não existe.
  - [ ] Retrabalho = qualquer reexecução do mesmo agente no ticket (inclui `memoria`, runs com erro/cancelados, retomada após portão de custo) e o denominador conta todos os runs de ticket: documentar ou refinar. `failures()` conta reprovação pendente (escala antes de a pessoa decidir); explicar em `routing-and-costs.md`.
  - [ ] Painel: `estourado` (uso ≥ 100%) difere de `overDaily` (uso + reserva + estimativa > limite); aviso usa `Math.floor` (29% pode aparecer 28%); custo de `codex`/`ollama` conta 0 e deveria ser sinalizado; o classificador não é pré-checado contra o orçamento.
- [ ] Roteador no chat e nos pipelines YAML (hoje só o quadro). Decidir se `outroProvedorQue` convive com tier.
- [ ] Ligar `roteamento: auto` nos agentes de exemplo e medir antes: o gasto do classificador aparece em *Métricas*; só vale se economizar mais do que custa. Ajustar as regras com os `runs` reais (os limiares 600/6000 caracteres e 400 linhas são chutes).
- [ ] Orçamento em USD (hoje só tokens; o Codex não informa custo) e orçamento por projeto/agente.
- [ ] O orçamento diário pausa por ticket, no portão de cada um; não há "pausa global" que impeça novos objetivos. Estimativa do próximo passo = prompt + 2000 tokens fixos.
- [ ] Retrabalho é calculado dentro do período filtrado (a 1ª execução de um ticket fora do período não conta como "primeira"). `diffStat` usa `git` síncrono (mesma pendência do prompt 14).
- [ ] Tier por etapa de pipeline e animação/ícone do tier na interface (finalmentes). Ollama como tier `pequeno`: feito no prompt 18.

**Adaptadores**
- [x] Codex: JSON, resume e erros capturados do `codex-cli` 0.162 real (fixtures `codex-*.jsonl`). Falta: imagens (prompt 08).
- [ ] Detectar o erro real de limite do Codex quando acontecer (hoje só há a mensagem de modelo inválido) para oferecer troca para haiku/Ollama.
- [ ] Imagens no `claude-cli` (hoje devolve `error`): fazer junto do prompt 08.
- [x] Adaptador Ollama (prompt 18): HTTP em stream, `isAvailable`/`listModels`, thinking desligado por padrão, URL só local, tier `pequeno` usa Ollama quando no ar e sem ferramentas. Verificado com o `qwen2.5-coder:7b` real (classificação JSON em ~2,7 s, cancelamento ok).
- [x] Prompt 18: qa+revisor feitos em 2026-10-15 e corrigidos (0dcd01e): redirect bloqueado, local desligado por padrão, fallback em tempo de execução, teto de resposta e timeout de inatividade.
- [ ] **Prompt 18, para avaliar (revisor, importante):**
  - [ ] `LocalModels.pick()` (`apps/server/src/local-models.ts`) cai em `modelos[0]` sem filtrar modelos de embedding (`nomic-embed-text`, `bge-*`), que respondem 400 em `/api/chat`; e se o modelo escolhido na tela não está instalado, usa outro sem avisar. Opções: filtrar por `/api/show` (capabilities) e devolver `motivo` na UI/evento quando o modelo configurado não existe.
  - [ ] Os tokens do Ollama entram em `dayUsage`/`tokensSince` e no teto por ticket, mas o local é grátis e o orçamento foi pensado para a cota de assinatura: pode bloquear passos pagos à toa. Decidir: excluir runs `ollama` da soma (e documentar em `routing-and-costs.md`) ou manter de propósito.
  - [ ] `GET/PUT /router` sondam o Ollama a cada chamada (2 timeouts de 1,5 s no pior caso, ~3 s) e refreshes concorrentes não são deduplicados nem ordenados (`LocalModels.refresh`). Opções: deduplicar a promessa em andamento e/ou reaproveitar o snapshot recente.
- [ ] **Prompt 18, sugestões (revisor):**
  - [ ] Unificar `SAFE_MODEL` (`ollama.ts`, aceita `..` e `/` inicial) com o regex do schema do router e o do `PUT /router` (`router-routes.ts`, aceita `[]`) numa constante só.
  - [ ] Depois do retry sem `think` (400), o `think:false` deixa de ser enviado: um modelo que rejeita o campo mas pensa por padrão vai pensar. Comentar no código e validar com modelos reais.
  - [ ] Normalizar `localhost` para `127.0.0.1` (hoje depende de DNS/hosts); aceitar outros 127.x se for preciso.
  - [ ] Mensagens de erro repassam até 2000 caracteres do corpo do servidor e a URL; reduzir.
  - [ ] `LocalStatus` no front (`apps/web/src/lib/types.ts`) sem `motivo` nem o modelo efetivo (necessário para o `pick()` avisar).
  - [ ] Teste de integração opt-in (`OLLAMA_LIVE=1`) para a afirmação "Verified" de `docs/06-research/ollama.md`, que hoje vem de teste manual.
- [ ] Prompt 18 — medição inicial (2026-10-15, `think:false`, sem thinking em nenhum): e2b ~129 tok/s, ministral-3:3b ~123, qwen2.5-coder:7b ~90, gemma4:26b ~59 só com `use_mmap:false` (com mmap travou, ~3 tok/s no prompt): o adaptador precisa permitir `use_mmap:false` para modelos que não cabem na VRAM. `use_mmap:false` implementado (`useMmap`/`OLLAMA_USE_MMAP=0`). Qualidade (4 pedidos de refinador + 3 do roteador, 2026-10-15): gemma4:26b melhor (segue as regras, pergunta as lacunas, roteador 3/3, ~1 s por chamada após carga de ~39 s); gemma4:e2b bom e rápido (roteador 3/3, refinador correto mas seco); ministral-3:3b inventa requisitos (viola a regra do refinador) e errou a chave JSON (`confiança`); qwen2.5-coder:7b refinador pobre e roteador errou o caso alto. Sugestão: 26b para refinador, e2b para classificador/monitor. Abertos: validar Gemma 4 e2b / Ministral 3B / Gemma 4 26B lado a lado (velocidade, qualidade no refinador e no monitor; só o qwen2.5-coder está instalado); ver se o thinking desses modelos vem ligado e se `think:false` é aceito; refinador de prompt e memória (`memoria` usa ferramentas) ainda não usam o Ollama; imagens e ferramentas não existem no adaptador; agente `monitor` local com `outroProvedorQue` ainda não desenhado.

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
- [ ] Sandbox opcional de agentes em container: o worktree isola os arquivos do ticket e a escrita é confinada por regra `Edit(//<pasta>/**)`, mas `Bash(pnpm test:*)` roda scripts do projeto, que podem tocar fora. Container fecha essa porta.

**Lançamento e divulgação (decisão de 2026-10-15: só ao final do projeto)**
- [ ] Nada de divulgação, domínio novo ou site antes de o projeto estar funcional e pronto; o foco agora é construir.
- [ ] Site de documentação/landing estático em `owl.renatofigueiredo.dev` (Cloudflare Pages ou GitHub Pages; custo zero, sem Railway, que só entra se houver backend de demo). Comprar domínio próprio apenas se houver tração; redirect 301 preserva o SEO. "owl" é um termo muito disputado: pesar um nome/domínio mais distintivo.
- [ ] Usar a construção do site como primeiro caso de uso real do próprio OWL ("este site foi feito pelo OWL").
- [ ] Divulgar (Reddit, Hacker News e afins) com README final, prints atualizados (`docs/images/`) e site no ar. O que traz público ao repositório é conteúdo (README, docs, backlinks), não o domínio.
- [ ] **README animado (tarefa para o próprio OWL, só com a arquitetura completa):** (1) SVG animado (CSS/SMIL, `docs/images/flow.svg`) com o caminho real de um pedido: prompt → refinador → aprovação → agente (Claude/Codex/Ollama) → executor → memória em camadas → resposta em streaming; 8–12 s em loop, `prefers-reduced-motion` respeitado, paleta de `brand/`, sem caminhos nem dados pessoais. (2) Versão estática do mesmo diagrama como fallback (`flow-static.svg`/PNG). (3) GIF/WebM curto da interface real (chat, memória, troca de provedor, quadro). (4) Dashboard interativo apenas no site de documentação, não no README (o GitHub não executa JavaScript). Gerar a partir de `docs/02-architecture/architecture.md` e regenerar a cada mudança de arquitetura. Princípios em `docs/05-ui/motion-and-animation.md`.

**Anotado em 2026-10-15 (pedido do usuário) — modelos locais, para o prompt 18 (Ollama)**
- [ ] Modelos candidatos já vistos rodando bem na máquina do usuário: **Gemma 4 text-only e2b** e **Ministral 3 3B** (pequenos, bons para melhorar prompt e para monitorar o Linear), mais o **Gemma 4 26B** (mixture of experts, maior). A máquina provavelmente aguenta modelos maiores que esses; medir antes de decidir o padrão.
- [ ] Usar os pequenos para o **refinador de prompt** e para o **monitoramento do Linear** (espelho do prompt 16) em vez de gastar Claude/Codex com tarefa de vigia.
- [ ] **Monitoramento local de um agente por outro** (um modelo local confere o trabalho de outro): troca um custo recorrente alto por um quase zero. Desenhar como etapa de pipeline com `outroProvedorQue`.
- [ ] **Testar e validar a integração do Gemma 4 26B** (e e2b / Ministral 3B) pelo adaptador próprio do Ollama, lado a lado com `codex --oss`, medindo velocidade e qualidade no refinador e no monitor.
- [ ] **Conferir se o modo de raciocínio (thinking) vem ligado por padrão** nesses modelos: ligado atrasa respostas onde não precisa. O adaptador deve desligá-lo por padrão (parâmetro do Ollama) e deixar o agente pedir quando valer.

**Anotado em 2026-10-15 — acabamento visual (vai para "finalmentes", é estético)**
- [ ] Animação simples de **estado do agente**: dormindo (ocioso), trabalhando, aguardando (aprovação/bloqueado). Só animação, nada além.
- [ ] A **coruja** (marca do OWL) para agentes de modelos locais; o **boneco do Claude** quando o agente roda no `claude`. Outros provedores: personagem próprio.
- [ ] Usuários poderão **criar os próprios personagens**, associá-los a uma LLM/provedor e definir o que cada um faz em ocioso, trabalhando e aguardando (campo no arquivo do agente, no mesmo estilo dos outros). Encaixa no prompt 17 (motion) ou depois dele.

**Fluxo combinado para fechar o 14:** `qa-testes` + `revisor` do 14 rodam num terminal à parte (sem misturar contexto com este chat); lá mesmo se aplicam as correções, e então commit e push.

- [x] Monitor do backlog (2026-10-16): `apps/server/src/monitor.ts`, sem modelo (custo zero de tokens). Config em `settings` (`GET/PUT /monitor`, `POST /monitor/start|stop|tick`), desligado por padrão; a cada `intervaloMin` avisa execução parada >45 min, avisa uma vez ao dia em `avisoPct` (70%) do orçamento diário e, ligado, inicia o próximo ticket pronto (prioridade, sem bloqueio, sem portão pendente, <2 execuções com erro, respeitando a concorrência do projeto). Para sozinho em `paradaPct` (90%), sem orçamento diário definido ou com `maxPortoesPendentes` (3) portões esperando; nunca decide portões. Botão liga/desliga na barra Vigia. Aberto: resumo do quadro por modelo local (hoje só texto fixo), concorrência padrão 1 quando o projeto não define, avisos só na UI (sem notificação do sistema).
