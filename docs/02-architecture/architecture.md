# 03 — Arquitetura

## Visão
```
[Navegador] ⇄ SSE/HTTP ⇄ [server (Fastify, 127.0.0.1)]
                              │
                        [core: executor de pipelines]
                         │          │            │
                [adaptadores]   [memória]    [roteador]
                 claude  codex      │
                   │       │     [db: SQLite + arquivos]
             subprocessos (CLIs oficiais)
```

## Pacotes
- `core`: tipos, adaptadores, executor, montador de contexto, roteador.
- `db`: conexão better-sqlite3, migrações, repositórios.
- `server`: rotas REST + SSE.
- `web`: React (chat, stream, histórico, quadro).
- `mcp-memory`: servidor MCP com ferramentas de memória.

## Adaptadores de provedor
```ts
export type RunEvent =
  | { type: 'start'; runId: string; provider: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input?: unknown }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'end'; result?: string; cliSessionId?: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export interface RunRequest {
  prompt: string;
  cwd: string;                 // pasta de trabalho
  systemAppend?: string;       // instruções do agente
  allowedTools?: string[];
  runId?: string; model?: string;
  resumeSessionId?: string;    // continuidade nativa da CLI
  mcpConfigPath?: string;
  images?: string[];           // caminhos de arquivos
}

export interface ProviderAdapter {
  id: 'claude-cli' | 'codex-cli' | string;
  isAvailable(): Promise<boolean>;   // binário existe e responde
  run(req: RunRequest, signal: AbortSignal): AsyncIterable<RunEvent>;
}
```
- **claude-cli**: `claude -p <prompt> --output-format stream-json` (+ `--verbose` se exigido),
  `--resume`, `--allowedTools`, `--append-system-prompt`, `--mcp-config`. Ler linha a linha (JSONL).
- **codex-cli**: `codex exec <prompt>` (confirmar flags de saída JSON e imagem com `codex exec --help`).
- Futuros: chave de API, Ollama.
- **Sempre** `spawn(bin, args, { cwd, env })` sem shell; cancelar com `AbortSignal` (matar o processo).
- Remover variáveis de ambiente que forcem API key se o usuário escolheu modo assinatura (configurável).

## Executor de pipelines
Pipeline em YAML, ex.:
```yaml
nome: melhorar-e-executar
etapas:
  - id: melhorar
    agente: refinador-de-prompt
    quando: "{{ opcoes.melhorarPrompt }}"
    saida: prompt
  - id: executar
    agente: dev-generalista
    entrada: "{{ etapas.melhorar.saida ?? pedido }}"
```
Cada etapa vira um `run` no banco, com `parent_run_id` ligando a cadeia.
O prompt melhorado aparece na interface e pode ser editado antes de seguir (opcional).

## Servidor
- `POST /sessions`, `GET /sessions/:id`, `DELETE /sessions/:id`
- `POST /sessions/:id/messages` → inicia execução, retorna `runId`
- `GET /runs/:id/stream` → SSE com `RunEvent`
- `POST /runs/:id/cancel`
- `POST /attachments` (upload)
- Fase 2: `/agents`, `/teams`, `/projects`, `/tickets`, `/approvals`

## Interface
- Lista de sessões, chat, checkbox "melhorar prompt", seletor de agente/pipeline.
- Painel da execução: texto em stream, ferramentas usadas, tokens por etapa.
- Colar (Ctrl+V) ou arrastar prints, com miniatura.
- Tema claro/escuro.

## Decisões (prompt 03, verificadas com o `claude` 2.1.300 real)
- **Isolamento é obrigatório por padrão.** `claude -p` herda MCPs, skills e plugins globais do usuário. Num "diga ok"
  medido: **~540.000 tokens de entrada em cache sem isolamento vs ~3.000 com** `--strict-mcp-config --disable-slash-commands
  --setting-sources ""`. O adaptador isola sempre (`isolate: true`); só o MCP passado em `mcpConfigPath` é carregado.
- **Prompt por stdin, nunca em argv.** Evita que texto do usuário vire flag (`--dangerously-skip-permissions`...), limites de
  tamanho de argv e exposição em `ps`. Valores de opções são validados (não começam com `-`; session id deve ser UUID).
- **Erro de API chega como `result` com `is_error: true` e `subtype: "success"`.** O parser usa `is_error`, não o subtype.
- **Contrato de eventos:** um `start`, eventos de progresso, **exatamente um** terminal (`end` | `error` | `cancelled`).
  O adaptador nunca lança por falha da CLI (binário ausente, crash, saída sem `result` viram `error`).
- **Cancelamento:** `AbortSignal` → SIGTERM, e SIGKILL após `killGraceMs` (padrão 2 s). Parar a iteração cedo também mata o processo.
  Medido no real: processo encerrado 0,7 s após o abort, sem órfãos.
- **Texto:** vem dos `text_delta` (`--include-partial-messages`); o texto dos eventos `assistant` só entra se não houve deltas.
- **Modo de autenticação (`authMode`)**: `subscription` (padrão) remove `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`
  (e `OPENAI_API_KEY`/`CODEX_API_KEY` no Codex) do ambiente do filho para usar o login da própria CLI; `inherit` repassa tudo.
  O OWL nunca lê o valor dessas variáveis nem arquivos de credencial.
- **`resumeSessionId`** → `--resume=<uuid>` (testado no real: mantém o mesmo session id e o contexto).
- **Imagens** ainda não são suportadas pelo adaptador (prompt 08); pedir imagens gera `error`, não flag inventada.
- **Codex: JSON + resume verificados** (ver "Decisões (Codex)" abaixo). Imagens seguem para o prompt 08.
- Testes usam CLIs falsas (`packages/core/test/fake-cli.mjs`) e fixtures **reais sanitizadas** (`test/fixtures/`).
- Teste manual: `pnpm --filter @owl/core try "olá" [--model haiku] [--only claude-cli] [--resume <id>]`
  (use `-- "<prompt>"` se o prompt começar com `-`).

## Decisões (prompt 04, servidor e executor)
- **Tudo por projeto.** `POST /projects` (pasta existente + `instrucoes` opcionais em `config_json`); `POST /sessions` aceita `projectId`.
  Numa sessão de projeto o `cwd` é sempre a `pasta` do projeto (`cwd` no body é recusado) e as instruções entram como `systemAppend`.
  `GET /sessions?projectId=` lista só as daquele projeto.
- **Executor em `apps/server/src/executor.ts`** (o executor de pipelines do `core` vem no prompt 12). Fila FIFO, concorrência
  `OWL_CONCURRENCY` (padrão 1), nunca dois runs da mesma sessão ao mesmo tempo (o `--resume` depende da ordem).
  O `cli_session_id` é lido quando o run **começa**, não quando é enfileirado.
- **Grava antes de anunciar:** o evento terminal (`end`/`error`/`cancelled`) só sai pelo SSE depois de mensagem, tokens e status
  estarem no banco. Quem reage ao `end` já encontra o estado final.
- **SSE** (`GET /runs/:id/stream`): reenvia o histórico em memória (últimos 200 runs) e segue ao vivo; run antigo ou após reinício
  devolve só `start` + desfecho guardado no banco. Cancelar run na fila o marca `cancelado` sem iniciar processo.
- Erros sempre `{ error: { code, message } }`; entrada validada com zod (`model` não pode começar com `-`).
- Sem `DELETE /sessions` ainda (prompt 09). Uso por sessão: somar `runs.tokens_*`/`custo_estimado` (interface, mais adiante).

## Segurança da API local (correções da revisão dos prompts 03 e 04)
- **DNS rebinding / CSRF** (`apps/server/src/security.ts`): todo request passa por um hook que exige `Host` de loopback
  (`127.0.0.1`, `localhost`, `[::1]`) e, se o navegador mandou `Origin`, que seja o próprio servidor ou esteja em
  `OWL_ALLOWED_ORIGINS` (ex.: Vite em dev). Origin `null` ou de outro site → 403. Sem `Origin` (curl, scripts) passa.
- **Pastas** (`OWL_WORKSPACE_ROOTS`, separadas por `:`, padrão = home): `pasta` do projeto e `cwd` precisam estar dentro de uma raiz,
  sem pasta oculta no caminho (`~/.ssh`, `~/.config`...), com symlinks resolvidos. Valida na criação **e a cada run**. Fora → 403.
  A aprovação humana para sair das raízes entra com o quadro/portões (prompt 13).
- **Adaptador nunca lança:** byte NUL em `systemAppend`/ferramentas vira `error`; `spawn` que lança (NUL no `cwd`) também.
- **Acesso remoto (Tailscale):** exigirá permitir o nome do host Tailscale no guard; não é possível hoje por padrão (de propósito).

## Decisões (prompt 05, interface)
- **Tailwind v4** (`@tailwindcss/vite`) com tokens de tema em variáveis CSS (`--c-*`, paleta da marca) mapeados via `@theme inline`;
  tema pelo atributo `data-theme` (segue o SO por padrão; só o nome do tema vai ao `localStorage`).
- **Navegador só fala com a origem do Vite**: `/api/*` é proxy para o servidor, sem CORS. O guard de Host/Origin segue sem exceções.
- **Stream**: `useRunStream` + `reduceStream` (puro, testado). `start` zera o estado, então a reconexão automática do `EventSource`
  (que reenvia o histórico) não duplica texto. Terminal fecha a conexão. Run em andamento reconecta ao recarregar a página.
- **Markdown sem HTML cru** (react-markdown): saída do modelo não injeta marcação; links abrem com `noopener`.
- **Título da sessão** vem da primeira mensagem (servidor, `setTitleIfEmpty`). `GET /providers` devolve `{ id, available }`.
- **Testes**: Vitest + Testing Library (jsdom, `EventSource`/`fetch` falsos) e Playwright (`apps/web/e2e`, servidor com CLI falsa em
  `apps/server/e2e/server.ts`, portas 4318/5174 para não colidir com o dev).

## Decisões (Codex, verificado com `codex-cli` 0.162.1 real)
- Comando: `codex exec [resume <id>] --json --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox read-only [--model m] -`
  (prompt em stdin). Isolamento (`--ignore-user-config/--ignore-rules`) não mudou o consumo medido (~12,8k tokens de entrada num "diga ok",
  contexto base do Codex), mas torna o run independente da configuração interativa do usuário. Login não é afetado.
- **Sem deltas de texto:** cada `agent_message` chega inteiro e pode haver vários (os primeiros são "vou fazer X"). O stream mostra todos;
  o resultado final guardado é o **último**. `thread_id` = id de sessão para `resume`. Uso: `input_tokens`/`output_tokens`, **sem custo**.
- `command_execution` vira um evento `tool` (nome `command`). Item `error` é só aviso; o erro real é `error`/`turn.failed`, cuja mensagem é um JSON
  em string (o adaptador extrai `error.message`). Saída com código 1 não gera segundo erro.
- **`codex exec resume` não tem `--sandbox`:** o resume herda o sandbox do primeiro turno (read-only por padrão). Escrita (`workspace-write`)
  só como opção do adaptador, a ser usada com worktrees (prompt 14).
- Sem flag de "append system prompt": `systemAppend` vai antes do prompt, só no **primeiro turno**. `allowedTools` e `mcpConfigPath` não têm
  equivalente no `exec` e são ignorados. Imagens: `-i` é variádico e engoliria o `-` do stdin; ficam para o prompt 08, com teste real.
- O adaptador emite `start` assim que o processo sobe (`startEarly`), porque a primeira linha (`thread.started`) não traz nada para mostrar.
- Sessões do Codex ficam no diretório da própria CLI (sem `--ephemeral`, necessário para o `resume`).
