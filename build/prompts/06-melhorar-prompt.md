# 06 — Pipeline "melhorar prompt"

**Agente:** `backend` (interface com `frontend`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/02-architecture/architecture.md` (Executor de pipelines)

## Tarefa
1. Executor de pipelines mínimo lendo YAML (só etapas sequenciais e condição `quando`).
2. Pipeline `examples/pipelines/melhorar-e-executar.yaml`:
   etapa `melhorar` (Codex, prompt de sistema de refinador) → etapa `executar` (Claude).
3. Cada etapa cria um `run` com `parent_run_id`.
4. Interface: checkbox "melhorar prompt"; mostrar o prompt melhorado; opção "editar antes de executar".
5. Prompt do refinador em `examples/agents/refinador-de-prompt.md`:
   reescrever o pedido de forma clara, com objetivo, contexto, restrições e formato de saída;
   responder só com o prompt.

## Critérios de aceite
- Com checkbox desmarcado, só uma etapa roda.
- Com checkbox marcado, duas etapas aparecem encadeadas no painel, com tokens de cada uma.
- Edição do prompt melhorado é respeitada.
