# 16 — Quadro avançado (etiquetas, relações, ciclos)

**Agente:** `backend` (interface com `frontend`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/04-agents-and-board/linear-model-notes.md`, `docs/04-agents-and-board/agents-teams-board.md`

> Este prompt substitui a "Integração com Linear" do pacote original. O quadro é próprio e local: nenhum serviço de terceiros,
> nenhuma chave, nada sai da máquina. Aqui o quadro ganha o que falta do modelo público do Linear (só o formato dos dados, nunca código nem o nome).

## Tarefa
1. **Etiquetas** por projeto (nome único, cor), muitas por ticket; filtrar o quadro por etiqueta.
2. **Relações** entre tickets do mesmo projeto: `bloqueia`, `relacionado`, `duplicado`. Sem auto-relação, sem repetição, sem ciclo de bloqueio.
   Um ticket com bloqueador ainda aberto aparece como "bloqueado por ..." e um agente não o inicia.
3. **Ciclos** por projeto (número sequencial, nome, início e fim): atribuir tickets, ver progresso (por estado e por estimativa) e o que sobrou.
4. **Estimativa** (pontos) e **prazo** (data) no ticket.
5. Tudo registrado no histórico do ticket e coberto por testes; interface: etiquetas nos cartões, seção no detalhe do ticket, filtro por etiqueta/ciclo.

## Critérios de aceite
- Teste: relação inválida (outro projeto, si mesmo, repetida, ciclo de bloqueio) é recusada.
- Teste: ticket bloqueado por um aberto não é iniciado por agente; concluir o bloqueador o libera.
- Teste: progresso do ciclo bate com os tickets; apagar etiqueta/ciclo/ticket não deixa lixo.
- Migração nova, sem alterar as anteriores.
