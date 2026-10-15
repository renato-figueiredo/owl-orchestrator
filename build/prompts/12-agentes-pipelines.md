# 12 — Agentes como arquivos e pipelines

**Agente:** `arquiteto` (implementação com `backend`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/02-architecture/architecture.md`, `docs/04-agents-and-board/agents-teams-board.md`

## Tarefa
1. Formato de agente de execução (Markdown + frontmatter, ver `docs/04-agents-and-board/agents-teams-board.md`), validado com zod.
2. Biblioteca global (`~/.owl/agents/`) + agentes do repositório (`examples/agents/`);
   indexar na tabela `agents`; recarregar ao mudar o arquivo.
3. Criar exemplos: `po`, `tech-lead`, `dev-front`, `dev-back`, `qa`, `revisor`, `memoria`,
   `roteador`, `refinador-de-prompt`.
4. Ampliar o executor de pipelines: etapas que referenciam agentes, passagem de saída entre etapas,
   condição `quando`, limite de tentativas.
5. Skills: pasta com `SKILL.md`, compatível com o formato do Claude Code (verificar especificação);
   agente declara as skills que usa; o executor as disponibiliza na pasta de trabalho.
6. Interface: biblioteca de agentes (listar, criar, editar, duplicar).

## Critérios de aceite
- Agente inválido mostra erro claro e não quebra o app.
- Mesmo agente usado em duas sessões diferentes sem conflito.
- Pipeline com 3 etapas (refinar → executar → revisar com outro provedor) roda ponta a ponta.
