# 10 — Servidor MCP de memória

**Agente:** `backend`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/03-data/memory-and-context.md` (Memória sob demanda)

## Tarefa
1. `packages/mcp-memory` usando o SDK oficial de MCP para TypeScript (verificar versão atual).
2. Ferramentas: `buscar_memoria`, `ler_resumo`, `salvar_fato`, `listar_fatos`, com escopo por projeto.
3. Acesso ao mesmo SQLite (somente o necessário; escrita só em `facts`).
4. Gerar arquivo de configuração MCP e passá-lo ao `claude -p` via `--mcp-config` quando a opção estiver ativa.
5. Registrar no `run` quais ferramentas de memória foram chamadas.

## Critérios de aceite
- Teste do servidor MCP isolado (chamar cada ferramenta).
- Teste manual: o Claude Code consegue chamar `buscar_memoria` durante uma execução.
