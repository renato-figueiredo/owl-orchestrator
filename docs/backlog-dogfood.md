# Backlog para o OWL tratar (dogfooding)

Pendências menores das revisões dos prompts 07 (memória), 15 (roteador) e 14 (projetos/worktrees), de 2026-10-16. Cada item é um ticket pronto:
**título**, **descrição**, **critérios de aceite**, **agente sugerido** e **onde mexer**. Para importar: criar pela UI, ou
`POST /projects/:id/tickets` com `titulo`, `descricao`, `criteriosAceite`, `responsavel` (o servidor exige o pareamento).
Rodar `pnpm typecheck`, `pnpm lint` e `pnpm test` ao fim de cada um. Ordem: do mais útil ao cosmético.

## Ordem e dependências (evitar concorrência e trabalho repetido)

Regra: dois tickets que mexem **no mesmo arquivo** não rodam ao mesmo tempo. Ao importar, crie as relações `tipo: "bloqueia"`
(`POST /tickets/:id/relations`, `relacionadoId` = o ticket que fica esperando). `BoardFlow.run` já recusa rodar um ticket
com bloqueador aberto. Os números abaixo são os deste arquivo; mapeie para os identificadores do quadro (OWL-n) ao importar.

**Correntes (A → B: A fecha antes de B começar):**
- `memory.ts` / `context.ts`: 1 → 2 → 3 → 5, e 2 → 6. (O 4 mexe em `app.ts`/`facts.ts`, fica fora da corrente.)
- `metrics.ts` e `board-flow.ts`: 7 → 10 → 11.
- `router.ts` e o painel de métricas: 8 → 9 → 10 → 17, e 10 → 20.
- Ollama: 16 → 18 → 19, e 16 → 20.
- `claude-cli.ts` e `executor.ts`: 12 → 27 → 22.
- Worktrees: 13 → 14, e **14 só depois de 10 e 11** (torna `BoardFlow.run` assíncrono e conflitaria com eles). 15 (`cleanup.ts`) é independente.
- Dados: 25 só depois de 22 e 14 (mexe em caminho de dados e migração).
- Documentação por último: 28 depois de 21 e 23; 24 e 26 são independentes.

**Podem rodar em paralelo (arquivos distintos):** 1, 4, 7, 8, 12, 13, 15, 16, 21, 23, 24, 26.

**Importância (fechar antes):**
1. 1 (perde dado do usuário), 4 (escopo das rotas), 12 (vazamento de leitura): correções de segurança ou de perda de dado.
2. 16 (modelo errado no Ollama) e 17 (decisão que muda o orçamento): destravam 18–20 e 8–9.
3. 2, 3, 5, 6, 7, 11, 13, 15: correções localizadas.
4. 22 e 14: maiores e mais arriscados; só depois que as correntes de `board-flow.ts` e `executor.ts` estiverem fechadas.
5. 25 (decisão humana), 27, 28, 24, 26: acabamento.

**Antes de rodar cada ticket:** conferir se o anterior da corrente foi mesclado, rodar `git pull`/rebase da branch base e ler o
diff dele; se o ticket já foi feito por outro, fechar com comentário em vez de refazer.

## Memória (prompt 07)

### 1. Resumo automático não pode sobrescrever a edição do usuário
- **Agente:** dev-back · **Onde:** `apps/server/src/memory.ts` (`apply`/`setSummary`, ~268–290)
- **Descrição:** se o usuário edita o resumo enquanto o resumidor roda (alguns segundos), `setSummary` grava por cima e
  `resumo_anterior` passa a ser a edição: a versão anterior real se perde. `apply` também não confere se a conversa foi apagada.
- **Aceite:** o resumo lido no início é comparado com o atual antes de gravar; se mudou, o resultado automático é descartado
  (ou reaplicado sobre a edição) sem perder dado; conversa apagada não grava nada; teste cobre as duas corridas.

### 2. Bloco de fatos novos no `--resume` com orçamento
- **Agente:** dev-back · **Onde:** `apps/server/src/memory.ts` `contextFor` (~147), `packages/core/src/memory/context.ts`
- **Descrição:** no caminho `--resume` os fatos novos fixados não passam por `montarContexto`: quantidade e tamanho são
  ilimitados (cada fato até 500 caracteres). Fixar muitos de uma vez pode estourar o orçamento.
- **Aceite:** o bloco respeita `orcamentoTokens` (trunca e marca `truncado`); teste com dezenas de fatos grandes.

### 3. Uma mensagem única acima do teto não passa inteira ao resumidor
- **Agente:** dev-back · **Onde:** `apps/server/src/memory.ts` (~230, `SUMMARY_INPUT_CHARS`)
- **Descrição:** a condição `batch.length > 0` deixa a primeira mensagem ultrapassar os 60k caracteres.
- **Aceite:** a primeira mensagem é cortada ao teto (com reticências); o marcador avança só até o que foi enviado; teste.

### 4. Rotas de fatos: conferir pertencimento e não listar órfãos
- **Agente:** dev-back · **Onde:** `apps/server/src/app.ts` (`/facts`, ~534–549), `packages/db/src/repos/facts.ts` (`listScope`)
- **Descrição:** `PATCH`/`DELETE /facts/:id` não verificam o escopo; `GET /facts` sem `projectId` nem `sessionId` devolve
  fatos legados órfãos que nenhuma conversa vê.
- **Aceite:** `GET /facts` sem escopo responde 400 (ou lista vazia); `PATCH/DELETE` aceitam um escopo opcional e respondem
  404 se o fato não pertence a ele; testes.

### 5. Limpar a pasta temporária do resumidor
- **Agente:** dev-back · **Onde:** `apps/server/src/memory.ts` (~307, `mkdtemp` `owl-summarizer-`)
- **Aceite:** a pasta é removida ao fim da execução (e as antigas no startup); teste.

### 6. Truncamento não pode partir um par substituto UTF-16
- **Agente:** dev-back · **Onde:** `packages/core/src/memory/context.ts` (~78, `slice`), `summary.ts` (`clip`)
- **Aceite:** o corte nunca deixa um emoji pela metade; o teste de emoji verifica o texto, não só o orçamento.

## Roteador e métricas (prompt 15)

### 7. Definição de retrabalho mais precisa
- **Agente:** dev-back, depois revisor · **Onde:** `packages/db/src/repos/metrics.ts` (~93–113)
- **Descrição:** retrabalho é qualquer reexecução do mesmo agente no ticket (inclui o agente `memoria`, runs com erro ou
  cancelados e a retomada após portão de custo), e o denominador conta todos os runs de ticket: a taxa é inflada ou subestimada.
- **Aceite:** só conta reexecução depois de uma reprovação (ou define e documenta a regra em `routing-and-costs.md`);
  numerador e denominador usam o mesmo conjunto de runs; testes em `metrics.test.ts`.

### 8. Reprovação pendente já escala o tier
- **Agente:** tech-lead decide, dev-back aplica · **Onde:** `apps/server/src/router.ts` `failures()` (~111)
- **Descrição:** conta `reprovacao` em qualquer status, inclusive `pendente`; se a pessoa rejeitar a reprovação ela
  continua contando e dispara retrabalho em tier maior.
- **Aceite:** decisão registrada (contar só confirmadas, ou manter e explicar em `routing-and-costs.md`); teste.

### 9. Painel de orçamento coerente com o bloqueio
- **Agente:** dev-back/dev-front · **Onde:** `apps/server/src/router.ts` (~126–146), painel *Métricas e roteador*
- **Descrição:** `estourado` (uso ≥ 100%) difere de `overDaily` (uso + reserva + estimativa > limite); o aviso usa
  `Math.floor` (29% pode aparecer 28%) e, acima de 100%, ainda diz "Ao estourar...".
- **Aceite:** o painel mostra o mesmo critério do bloqueio; arredondamento correto; texto certo acima de 100%; testes.

### 10. Sinalizar custo desconhecido (Codex/Ollama) e pré-checar o classificador
- **Agente:** dev-back/dev-front · **Onde:** `packages/db/src/repos/metrics.ts` (~49), `apps/server/src/board-flow.ts`
- **Descrição:** `custo_estimado` nulo conta 0, então o custo de `codex` e `ollama` é subestimado sem aviso. O classificador
  não é checado contra o orçamento diário antes de rodar.
- **Aceite:** o painel indica "custo não informado" para esses provedores; o classificador respeita o orçamento restante
  (ou o desvio é documentado); testes.

### 11. Apagar a classificação guardada junto com o ticket
- **Agente:** dev-back · **Onde:** `apps/server/src/board-flow.ts` (`decisionKey`), exclusão de ticket
- **Descrição:** `settings` `roteador.decisao.<ticket>` sobra se o ticket for apagado.
- **Aceite:** apagar o ticket (ou o projeto) remove a chave; teste.

## Projetos e worktrees (prompt 14)

### 12. Conferir `Grep` e `Glob` fora do worktree com o `claude` real
- **Agente:** qa-testes · **Onde:** `packages/core/src/adapters/claude-cli.ts` (`scopeReadTools`)
- **Descrição:** `Read` está confinado ao worktree e conferido com a CLI real; `Grep`/`Glob` deveriam seguir a mesma regra, mas não foram testados.
- **Aceite:** rodar um agente com `[Read, Grep, Glob]` pedindo busca fora da pasta; se vazar, escopar também (`Grep(//dir/**)`...); teste de argumentos.

### 13. `reconcile` completo no startup
- **Agente:** dev-back · **Onde:** `apps/server/src/worktrees.ts` (`reconcile`)
- **Descrição:** ticket `ativo` cuja pasta sumiu continua `ativo` no banco; pastas de projeto apagado/sem repositório não são limpas; o resultado só vai para o log.
- **Aceite:** ticket `ativo` sem pasta vira `removido` (a branch fica); pasta de projeto inexistente é reportada; teste de cada caso.

### 14. Git assíncrono nos worktrees
- **Agente:** arquiteto planeja, depois dev-back · **Onde:** `apps/server/src/worktrees.ts`, `BoardFlow.run`
- **Descrição:** `spawnSync` bloqueia o servidor em repositório grande (`worktree add`, `commit`, `merge`, `diffStat`).
- **Aceite:** chamadas com `spawn` assíncrono e timeout; `BoardFlow.run` assíncrono; testes de worktree seguem verdes.

### 15. Purga imediata de blob recém-reenviado
- **Agente:** dev-back · **Onde:** `apps/server/src/cleanup.ts` (`purge`)
- **Descrição:** a purga agora deixa para o sweep o blob visto na última hora; "esvaziar lixeira" mostra `blobsRemoved` menor sem explicar.
- **Aceite:** a resposta/UI indica blobs adiados; ou opção `force` que ignora a carência; teste.

## Ollama (prompt 18, revisor)

### 16. `LocalModels.pick()` sem modelos de embedding e com motivo
- **Agente:** dev-back · **Onde:** `apps/server/src/local-models.ts` (`pick`)
- **Descrição:** cai em `modelos[0]` sem filtrar `nomic-embed-text`/`bge-*` (respondem 400 em `/api/chat`); se o modelo escolhido na tela não está instalado, usa outro sem avisar.
- **Aceite:** filtra por capabilities (`/api/show`); quando o modelo configurado não existe devolve `motivo` e o modelo efetivo; testes com servidor falso (embedding, modelo ausente).

### 17. Tokens do Ollama fora do orçamento
- **Agente:** tech-lead decide, dev-back aplica · **Onde:** `apps/server/src/router.ts` (`dayUsage`/`tokensSince`), teto por ticket, `docs/02-architecture/routing-and-costs.md`
- **Descrição:** o local é grátis, mas seus tokens entram no orçamento pensado para a cota de assinatura e podem bloquear passos pagos à toa.
- **Aceite:** decisão registrada; se excluir, runs `ollama` não somam em nenhum teto e a doc diz isso; teste dos dois lados.

### 18. `GET/PUT /router` sem sondar o Ollama a cada chamada
- **Agente:** dev-back · **Onde:** `apps/server/src/local-models.ts` (`refresh`), `router-routes.ts`
- **Descrição:** até ~3 s por chamada no pior caso; refreshes concorrentes não são deduplicados nem ordenados.
- **Aceite:** promessa em andamento compartilhada e snapshot recente reaproveitado; teste de duas chamadas simultâneas com uma só sondagem.

### 19. Endurecer o adaptador Ollama
- **Agente:** dev-back · **Onde:** `packages/core/src/adapters/ollama.ts`, `apps/server/src/router-routes.ts`
- **Descrição:** `SAFE_MODEL` duplicado e divergente (aceita `..`, `/` inicial, `[]`); `localhost` depende de DNS/hosts; erros repassam até 2000 caracteres do corpo e a URL; após o retry sem `think` (400) o `think:false` deixa de ser enviado (comentar o motivo).
- **Aceite:** uma constante única de validação de modelo usada nos três lugares; `localhost` vira `127.0.0.1`; mensagem de erro curta, sem URL; testes de cada caso.

### 20. Mostrar o motivo e o modelo efetivo na interface
- **Agente:** dev-front · **Onde:** `apps/web/src/lib/types.ts` (`LocalStatus`), painel *Métricas e roteador*
- **Aceite:** a tela mostra o aviso quando o modelo configurado não existe e qual modelo está de fato em uso; teste de componente. Depende do 16.

## Funcionalidades pequenas pendentes

### 21. Escolher o pipeline na caixa de envio
- **Agente:** dev-front · **Onde:** `apps/web` (caixa de envio), `GET /pipelines`, `POST /sessions/:id/messages` (`pipeline`)
- **Aceite:** seletor lista os pipelines, o escolhido segue na mensagem, "sem pipeline" continua o padrão; teste de componente e E2E simples.

### 22. Slot de sessão por (sessão, provedor)
- **Agente:** arquiteto planeja, depois dev-back · **Onde:** `packages/db` (sessão CLI), `apps/server/src/executor.ts`
- **Descrição:** alternar Claude/Codex hoje perde o `--resume`.
- **Aceite:** cada (sessão, provedor) guarda o seu id de retomada; voltar a um provedor retoma a conversa dele; migração com backfill; testes.

### 23. `RunPanel.onRetry` passa pelo aviso de troca de provedor
- **Agente:** dev-front · **Onde:** `apps/web` (`RunPanel`)
- **Aceite:** tentar de novo com outro provedor mostra o mesmo aviso da troca normal; teste de componente.

### 24. CLAUDE.md fala de `packages/memory`, mas o código está em `packages/core/src/memory`
- **Agente:** dev-back · **Onde:** `CLAUDE.md` (layout do repositório)
- **Aceite:** o layout descreve o que existe de fato (e o `packages/mcp-memory`); nada mais muda.

## Finalização

### 25. Decidir o local padrão dos dados
- **Agente:** tech-lead propõe · **Humano decide** (abre portão `entrega`) · **Onde:** `OWL_DATA_DIR`, `apps/server/src/config.ts`, docs
- **Descrição:** hoje `./data` é relativo ao processo (`apps/server/data/` via `pnpm dev`). Opções: `~/.owl/` (alinha com a biblioteca global de agentes) ou raiz do repositório.
- **Aceite:** proposta com migração dos dados existentes; só implementar após aprovação; teste de resolução do caminho.

### 26. E2E no CI
- **Agente:** dev-back · **Onde:** `.github/workflows/`
- **Aceite:** job com `playwright install --with-deps chromium` rodando `pnpm --filter @owl/web test:e2e`. Push e a conferência no GitHub ficam com a pessoa (regra de ouro 5).

### 27. Reduzir o contexto do executor
- **Agente:** dev-back · **Onde:** `apps/server/src/executor.ts`, `packages/core/src/adapters/claude-cli.ts`
- **Descrição:** o run do `claude` mediu ~97k tokens de entrada numa conversa simples.
- **Aceite:** medir com pasta vazia e sem `CLAUDE.md`, registrar os números em `routing-and-costs.md` e cortar o que for desperdício; teste dos argumentos.

### 28. Guias e lista de prints
- **Agente:** dev-back (docs) · **Onde:** `docs/guide/` (EN + pt-BR), `docs/images/README.md`
- **Aceite:** guias em dia com memória, anexos, lixeira, pipeline na caixa de envio e rótulos do portão de reprovação; lista de prints pronta (sem divulgação, sem site).

## Para o agente `monitor` (quando existir)
Chamar `POST /tickets/:id/reclassify` quando o ticket mudar de tamanho (descrição, critérios ou subtarefas novas), para o
próximo passo ser classificado de novo. Ver `docs/roadmap.md` (Ollama, monitoramento local).
