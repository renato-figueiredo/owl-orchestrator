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

- [ ] 17 Motion e animações (`build/prompts/17-motion.md`)
- [ ] 18 Adaptador Ollama (`build/prompts/18-ollama.md`)

## Futuro
- [x] Dev container (`.devcontainer/`, `docs/06-research/containers.md`)
- [ ] Sandbox opcional de agentes em container (ver Limpeza e hardening)
- [ ] GitHub Issues como quadro
- [ ] Adaptadores de API e Ollama
- [ ] Embeddings opcionais
- [ ] Pacote de vídeo (ffmpeg, Remotion)

## Pendências (atualizado em 2026-10-14)
**Próximo passo:** `qa-testes` + `revisor` do 17 (motion: `packages/ui` com `useMotionPreference`, `FadeIn`, `ListAnimated`, `Pulse`, `StreamCaret`; kanban com `layoutId` + dnd-kit; coruja piscando nos estados vazio/carregando), depois prompt 18. 15 e 16 já revisados. Fase 1 concluída (prompt 11); 12, 13 e 14 revisados. O 08/09 foi revisado de novo em 2026-10-15 (a lista antiga do revisor se perdeu): 9 itens corrigidos, 1 aberto abaixo.

**Revisão**
- [ ] Prompt 16: ordenar/alertar por prazo e ciclo ativo automático (hoje só estimativa/prazo exibidos); revisar o bloqueio por relação no fluxo (`BoardFlow.run`) e o filtro do quadro.
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
- [ ] Revisor, pendentes: `ticketBrief` sem teto próprio (descrição/subtarefas/comentários fora do `CONTEXT_TOKENS`); `parseVerdict` pega o último "VEREDITO:" do texto (exigir última linha); `numero` NULL em tickets antigos (migração 0008 sem backfill); pai fecha sem portão de entrega (`closeParentIfDone`); rótulo ambíguo ao rejeitar `reprovacao`; `allowed-tools` de skill é ignorado (documentar).
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
- [ ] Worktrees `ativo` que sobraram após queda do servidor: o ticket vira `bloqueado` e rodar de novo reaproveita a pasta, mas nada limpa pastas órfãs nem roda `git worktree prune` no startup.
- [ ] Mesclar na pasta do usuário só com a branch base ativa e árvore limpa; não há mesclagem em worktree dedicado (evitaria exigir isso do usuário) nem `git push`/PR (fora do escopo: push exige portão próprio).
- [ ] Subtarefas saem todas da branch base, não da branch do pai; dependências entre subtarefas que mexem nos mesmos arquivos vão dar conflito na mesclagem (o OWL só avisa).
- [ ] Memória por agente: entra no prompt dos tickets do quadro e aparece na tela do projeto; o chat, o MCP de memória e o agente `memoria` (que grava fatos do projeto, não do agente) ainda não a usam.
- [ ] A lista de comandos do `Bash` escopado é fixa no código (`BASH_FIRST`, `PACKAGE_SCRIPTS`...); tornar configurável por projeto se faltar `make`, `cargo`, `go test`...
- [ ] `Read` continua sem escopo de pasta nos agentes do quadro (pendência da revisão 11): um agente pode ler fora do worktree.
- [ ] Tela do projeto: sem E2E no navegador; testes de componente e de API cobrem.
- [ ] Fluxo `dev` com `claude` real conferido uma vez em 2026-10-15 (repositório temporário, haiku): `dev-back` criou o arquivo só no worktree, o OWL commitou na branch, a pasta do usuário ficou intacta, o arquivo fora da pasta **não** foi criado e o `qa` reprovou (abriu o portão de reprovação). Falta uma bateria maior (testes que o projeto realmente roda, conflitos, vários tickets).

**Roteador e métricas (prompt 15)** — feito: regras → classificador pequeno só se ambíguo (JSON validado, falha = confiança 0 = pessoa decide), tiers configuráveis (`PUT /router`), escalonamento por reprovação, aviso em 80% e portão `custo` por ticket e por dia (tokens), `GET /metrics`, painel *Métricas e roteador*, migração 0010. Escopo: **só o quadro**; agentes `roteamento: auto` (os exemplos continuam `fixo`). Abertos:
- [ ] `qa-testes` + `revisor` do 15 (pontos: `board-flow.ts` `route`/`classify`, contagem de `failures`, orçamento diário em `RouterService`, SQL de `metrics`).
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
- [ ] Prompt 18 abertos: `qa-testes` + `revisor`; validar Gemma 4 e2b / Ministral 3B / Gemma 4 26B lado a lado (velocidade, qualidade no refinador e no monitor; só o qwen2.5-coder está instalado); ver se o thinking desses modelos vem ligado e se `think:false` é aceito; refinador de prompt e memória (`memoria` usa ferramentas) ainda não usam o Ollama; imagens e ferramentas não existem no adaptador; sem fallback automático se o Ollama cai entre as checagens (30 s); agente `monitor` local com `outroProvedorQue` ainda não desenhado.

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
