# Backlog para o OWL tratar (dogfooding)

Pendências menores das revisões dos prompts 07 (memória) e 15 (roteador), de 2026-10-16. Cada item é um ticket pronto:
**título**, **descrição**, **critérios de aceite**, **agente sugerido** e **onde mexer**. Para importar: criar pela UI, ou
`POST /projects/:id/tickets` com `titulo`, `descricao`, `criteriosAceite`, `responsavel` (o servidor exige o pareamento).
Rodar `pnpm typecheck`, `pnpm lint` e `pnpm test` ao fim de cada um. Ordem: do mais útil ao cosmético.

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

## Para o agente `monitor` (quando existir)
Chamar `POST /tickets/:id/reclassify` quando o ticket mudar de tamanho (descrição, critérios ou subtarefas novas), para o
próximo passo ser classificado de novo. Ver `docs/roadmap.md` (Ollama, monitoramento local).
