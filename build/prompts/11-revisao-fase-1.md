# 11 — Revisão e testes da fase 1

**Agente:** `revisor` (e depois `qa-testes`)
**Ler antes:** `CLAUDE.md`, `docs/01-product/rules-and-compliance.md`, `docs/roadmap.md`

## Tarefa
1. `revisor`: revisão completa da fase 1 com o checklist do agente; lista priorizada.
2. `qa-testes`: rodar tudo; adicionar teste ponta a ponta (Playwright) do fluxo
   "enviar com melhorar prompt + print → ver stream → apagar sessão → arquivos removidos".
3. Corrigir bloqueantes (com `backend`/`frontend`/`banco-de-dados` conforme a área).
4. Atualizar README com instruções de instalação e uso.

## Critérios de aceite
- Nenhum item bloqueante aberto.
- E2E passando com CLIs falsas.
- Fase 1 marcada no roadmap.
