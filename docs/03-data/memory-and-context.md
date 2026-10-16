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
- `listar_fatos()` (até 50, os mais recentes; texto achatado em uma linha)

Passado ao `claude -p` via `--mcp-config`. O agente consulta só quando precisa,
em vez de receber tudo empurrado no prompt.

### Como está implementado (prompt 10)
- **Pacote** `packages/mcp-memory` (SDK oficial `@modelcontextprotocol/sdk`, stdio). `createMemoryServer` recebe duas conexões:
  uma **somente leitura** (`openReadonly`) para busca, resumos e listagem, e outra usada **só** por `salvar_fato` (insert em `facts`).
- **Escopo fixado por quem inicia o servidor, não pelo modelo**: projeto e sessão vão em variáveis de ambiente do processo
  (`OWL_DB`, `OWL_MEMORY_SESSION`, `OWL_MEMORY_PROJECT`, `OWL_MEMORY_RUN`). Por isso as ferramentas **não têm** o parâmetro `projeto`
  do desenho original: nenhum argumento alcança outro projeto. Conversa sem projeto busca só nela mesma (`buscarMensagens` sem
  escopo buscaria tudo) e seus fatos são só dela (`facts.session_id`, migração 0006). Conversas na lixeira nunca aparecem.
- **`salvar_fato` nunca fixa** (fixar põe o texto em todo prompt futuro: texto não confiável lido pelo agente não pode chegar lá
  sozinho), no máximo 10 fatos por execução, ignora duplicados e guarda a execução de origem.
- **Ligação**: opção `mcpMemoria` nas configurações da memória (desligada por padrão). `MemoryService.mcpFor` escreve um config por
  execução (`<dados>/mcp/<runId>.json`, modo 0600, apagado ao fim) e o executor o passa em `mcpConfigPath` com a permissão
  `mcp__owl-memory`. Só `claude-cli`; execuções sem estado (resumidor, refinador) ou sem ferramentas não recebem. O isolamento
  (`--strict-mcp-config`) continua: só este servidor é carregado.
- **Endurecimento (revisão do 10)**: (1) a conexão de escrita do servidor MCP roda em `query_only`; `salvar_fato` só a libera
  para o insert em `facts` e restaura em seguida. (2) O servidor é iniciado com `--tsconfig` do repositório (`memoryServerLaunch`):
  a CLI o inicia na pasta do projeto, e um `tsconfig.json` ali (`paths`) redirecionaria os imports; há teste com tsconfig hostil.
  (3) Tudo que vem do histórico (busca, resumos, fatos) é devolvido dentro de `<dados-nao-confiaveis>` com aviso de que são
  dados, não instruções, e um fechamento forjado no texto é neutralizado.
- **Registro**: `runs.memoria_chamadas` (JSON `{"buscar_memoria": 2}`, migração 0005), mostrado no painel de execuções.
- O servidor é iniciado com o mesmo carregador `tsx` do processo principal (os pacotes exportam TypeScript).

## Continuidade nativa
Usar `--resume <cliSessionId>` do Claude Code em vez de remontar o histórico.
A CLI cuida de cache e compactação. Guardar `cli_session_id` na sessão.

## Escopo de memória
- Por projeto (padrão).
- Por agente dentro do projeto (ex.: o gerente que atende dois projetos tem memória separada em cada um).

## Como está implementado (prompt 07)
- **Montador** (`packages/core/src/memory/context.ts`): camadas na ordem acima, orçamento de tokens respeitado
  (inclusive com fatos ou mensagens gigantes). `ultimasN = 0` significa "nenhuma mensagem recente".
- **Quando entra no prompt**: sem sessão nativa para retomar (conversa nova ou troca de provedor) vai o bloco completo.
  Com `--resume` vão só os fatos fixados criados desde a última run que **falou com a conversa da CLI**: runs de resumo,
  do refinador e runs que não terminaram `ok` não contam (`runs.sem_estado`, `RunsRepo.previousStart`).
- **Resumidor** (`apps/server/src/memory.ts`): modelo barato, sem estado, só `claude-cli` ou `ollama` (rodam sem ferramentas; o Codex não tem como, e o resumidor lê mensagens não confiáveis), em uma pasta temporária própria
  (`mkdtemp`) e **sem nenhuma ferramenta** (`--tools ""`), porque lê texto não confiável da conversa. JSON inválido ou
  falha da CLI nunca sobrescrevem o resumo anterior.
- **Backoff**: depois de uma tentativa automática que falhou, só tenta de novo com mais `resumirACada` mensagens novas.
  A falha automática é silenciosa; o resumo manual que falha avisa na conversa com uma mensagem de sistema.
- **Fatos** são do projeto (ou, sem projeto, da própria conversa: `session_id`, apagados junto com ela). Decisões do resumo viram fatos não fixados.
- **Pendências**: escopo por agente (a tabela `facts` já tem `agent_id`, ainda não usado).
  Fatos antigos sem projeto e sem conversa (anteriores à 0006) ficam no banco, mas nenhuma conversa os vê.
