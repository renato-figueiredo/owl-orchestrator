# 04 — Memória e contexto

## Princípio
Guardar no SQLite é barato. O que custa tokens é o que entra no prompt.
Nunca reenviar o histórico inteiro.

## Camadas (montadas a cada chamada, com orçamento fixo, ex.: 3–6 mil tokens)
1. **Fatos fixados** — preferências, decisões, regras do projeto. Curtos e editáveis pelo usuário.
2. **Resumo da sessão** — texto corrido atualizado periodicamente.
3. **Últimas N mensagens** na íntegra.
4. **Trechos recuperados** — só quando relevante; 3 a 5 trechos.

O montador de contexto preenche as camadas na ordem e corta quando atinge o orçamento.
Estimar tokens por aproximação (ex.: caracteres / 4) é suficiente no início.

## Resumo incremental
- A cada X mensagens (ex.: 10) ou quando o contexto passar de um limite:
  enviar `resumo anterior + mensagens novas` a um modelo barato (ex.: Codex, ou modelo pequeno).
- Saída em JSON: `{ "resumo": "...", "fatos_novos": [...], "pendencias": [...] }`.
- Gravar `resumo_ate_message_id` para saber de onde continuar.
- Nunca resumir decisões fora: decisões viram **fatos**.
- Manter versão anterior do resumo para poder desfazer.

## Hierarquia
mensagem → resumo da sessão → resumo do projeto. Buscar de cima para baixo.

## Busca
- Começar com **FTS5** do SQLite (texto). Resolve a maioria dos casos.
- Embeddings ficam opcionais (módulo plugável), para depois.

## Memória sob demanda (MCP) — preferida
Servidor MCP local (`packages/mcp-memory`) com ferramentas:
- `buscar_memoria(consulta, projeto?, limite?)`
- `ler_resumo(sessao | projeto)`
- `salvar_fato(texto, projeto, fixado?)`
- `listar_fatos(projeto)`

Passado ao `claude -p` via `--mcp-config`. O agente consulta só quando precisa,
em vez de receber tudo empurrado no prompt.

## Continuidade nativa
Usar `--resume <cliSessionId>` do Claude Code em vez de remontar o histórico.
A CLI cuida de cache e compactação. Guardar `cli_session_id` na sessão.

## Escopo de memória
- Por projeto (padrão).
- Por agente dentro do projeto (ex.: o gerente que atende dois projetos tem memória separada em cada um).
