# 16 — Integração com Linear

**Agente:** `backend`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/04-agents-and-board/agents-teams-board.md` (Provedores de quadro)

## Tarefa
1. Verificar a documentação atual da API do Linear e limites do plano gratuito.
2. Implementar `BoardProvider` `linear` com chave pessoal do usuário (guardada localmente,
   nunca em log; preferir o cofre do sistema operacional se possível).
3. Mapear estados locais ↔ estados do Linear; espelhar tickets, comentários e aprovações.
4. Local continua sendo a referência; sincronização idempotente; tratar conflitos.
5. Opcional: aprovar mudando o estado no Linear.

## Critérios de aceite
- Teste com cliente Linear falso (mock) cobrindo criação, mudança de estado e comentário.
- Sem a chave configurada, o app funciona normalmente com o quadro local.
