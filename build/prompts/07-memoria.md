# 07 — Memória em camadas e resumo incremental

**Agente:** `backend` (consultas com `banco-de-dados`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/03-data/memory-and-context.md`

## Tarefa
1. `montarContexto(sessao, pedido, orcamento)` em `packages/core`:
   fatos fixados → resumo → últimas N mensagens → trechos FTS (só se relevante), cortando no orçamento.
   Estimativa de tokens: caracteres/4.
2. Usar o contexto montado quando **não** houver `--resume` (ex.: troca de provedor, sessão nova
   com memória do projeto). Com `--resume`, enviar só fatos novos relevantes.
3. Resumo incremental: a cada X mensagens, chamar modelo barato com `resumo anterior + novas`,
   esperar JSON `{resumo, fatos_novos, pendencias}`, validar com zod, gravar e guardar `resumo_anterior`.
4. Interface: ver/editar resumo e fatos; fixar/desfixar fato.
5. Configurações: N, X, orçamento, provedor do resumidor.

## Critérios de aceite
- Teste: contexto nunca passa do orçamento.
- Teste: resumo incremental envia só mensagens após `resumo_ate_message_id`.
- Teste: JSON inválido do resumidor não corrompe o resumo existente.
