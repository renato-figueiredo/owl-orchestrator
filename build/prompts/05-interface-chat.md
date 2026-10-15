# 05 — Interface de chat

**Agente:** `frontend`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/02-architecture/architecture.md`

## Tarefa
1. Layout: lista de sessões à esquerda, chat ao centro, painel de execução recolhível.
2. Enviar mensagem, escolher provedor (Claude/Codex conforme disponibilidade via `/health` ou rota de status).
3. Renderizar stream em tempo real (texto incremental, ferramentas usadas, status, tokens).
4. Botão cancelar. Markdown e blocos de código com copiar.
5. Tema claro/escuro.

## Critérios de aceite
- Com a CLI falsa, a resposta aparece em stream e persiste ao recarregar.
- Navegação por teclado funciona no envio e na lista de sessões.
