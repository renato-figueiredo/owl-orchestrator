# 00 — Como usar estes prompts

## Antes de começar
1. Copie toda a pasta para a raiz de um repositório git novo.
2. Confirme que `claude` e `codex` estão instalados e logados (`claude --version`, `codex --version`).
3. Abra o Claude Code na raiz: `claude`.
4. Confira os subagentes: comando `/agents` (devem aparecer arquiteto, backend, frontend,
   banco-de-dados, qa-testes, revisor). Se o formato tiver mudado, ajuste `.claude/agents/`
   conforme a documentação atual do Claude Code.

## Ciclo de cada etapa
1. Abra o prompt da etapa (ex.: `build/prompts/01-setup.md`).
2. No Claude Code, envie:
   > Use o agente **<agente indicado>** e execute `build/prompts/NN-nome.md`. Apresente o plano antes de codar.
3. Revise o plano, aprove.
4. Ao terminar, envie:
   > Use o agente **qa-testes** para verificar os critérios de aceite de `build/prompts/NN-nome.md`.
5. Depois:
   > Use o agente **revisor** para revisar as mudanças desta etapa.
6. Corrija o que for bloqueante, faça commit e marque o item em `docs/roadmap.md`.

## Dicas para poupar limite do plano
- Uma etapa por sessão; use `/clear` entre etapas grandes.
- Use `/compact` quando a conversa crescer.
- Peça planos curtos e diffs pequenos.

## Mapa de etapas e agentes
| Prompt | Agente principal | Apoio |
|---|---|---|
| 01 setup | arquiteto | — |
| 02 banco | banco-de-dados | — |
| 03 adaptadores | backend | arquiteto (tipos) |
| 04 servidor/SSE | backend | — |
| 05 interface chat | frontend | — |
| 06 melhorar prompt | backend | frontend |
| 07 memória | backend | banco-de-dados |
| 08 anexos | backend | frontend, banco-de-dados |
| 09 exclusão/backup | banco-de-dados | frontend |
| 10 MCP memória | backend | — |
| 11 revisão fase 1 | revisor | qa-testes |
| 12 agentes/pipelines | arquiteto | backend |
| 13 quadro/aprovação | backend | frontend, banco-de-dados |
| 14 projetos/equipes | backend | arquiteto |
| 15 roteador/métricas | backend | frontend |
| 16 Linear | backend | — |
