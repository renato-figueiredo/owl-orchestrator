# 04 — Servidor, SSE e executor simples

**Agente:** `backend`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/02-architecture/architecture.md`

## Tarefa
1. Rotas: `POST /sessions`, `GET /sessions`, `GET /sessions/:id`,
   `POST /sessions/:id/messages` (body: texto, agente/provedor), `GET /runs/:id/stream` (SSE),
   `POST /runs/:id/cancel`.
2. Executor simples: grava mensagem do usuário, cria `run`, chama adaptador, transmite eventos via SSE,
   grava resposta, tokens e status ao fim. Guarda `cli_session_id` para `--resume`.
3. Fila com concorrência configurável (padrão 1).
4. Validação com zod; erros padronizados.

## Critérios de aceite
- Teste de integração com CLI falsa: enviar mensagem → receber eventos SSE → resposta gravada.
- Cancelamento interrompe o processo e marca `run` como `cancelado`.
- Segunda mensagem na mesma sessão usa `--resume`.
