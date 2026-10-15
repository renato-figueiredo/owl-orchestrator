# 14 — Projetos, equipes e worktrees

**Agente:** `backend` (modelo com `arquiteto`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/04-agents-and-board/agents-teams-board.md`

## Tarefa
1. CRUD de projetos (pasta de trabalho, configuração) e equipes (membros e papéis).
2. Agente gerente em duas equipes de projetos diferentes, com **memória separada por projeto**
   (`facts.agent_id` + `project_id`).
3. Git worktree por ticket de desenvolvimento (branch própria); limpeza ao concluir/cancelar.
4. Ferramentas permitidas por agente aplicadas via `--allowedTools`.
5. Concorrência máxima por projeto e global.
6. Interface: seletor de projeto, tela de equipe.

## Critérios de aceite
- Fato salvo pelo gerente no projeto A não aparece no projeto B.
- Dois tickets em paralelo não conflitam em arquivos (worktrees distintos).
- Nenhum merge sem aprovação.
