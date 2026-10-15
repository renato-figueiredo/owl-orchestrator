# 13 — Quadro de tickets e portões de aprovação

**Agente:** `backend` (UI com `frontend`, schema com `banco-de-dados`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/04-agents-and-board/agents-teams-board.md`, `docs/04-agents-and-board/linear-model-notes.md`

## Tarefa
1. Interface `BoardProvider` e implementação `local` (SQLite).
2. Estados e transições de `docs/04-agents-and-board/agents-teams-board.md`; subtarefas (`parent_id`); comentários com autor (agente ou humano).
3. Agentes leem **apenas** ticket + resumo + fatos relevantes (usar `montarContexto`).
4. Portões: criar `approval` pendente nos casos de `docs/04-agents-and-board/agents-teams-board.md`; execução pausa até decisão.
5. Interface: kanban com arrastar entre colunas, detalhe do ticket com comentários e runs,
   fila de aprovações com aprovar/rejeitar + comentário.
6. Fluxo de exemplo: objetivo do usuário → `po` cria ticket → `tech-lead` quebra → `dev-*` executa →
   `qa` verifica → aprovação → `memoria` resume.

## Critérios de aceite
- Ação destrutiva simulada sempre gera aprovação pendente.
- Rejeição volta o ticket para `em_andamento` com o comentário visível ao agente.
- Histórico do ticket mostra quem fez o quê e quanto custou.
