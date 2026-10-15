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
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'end'; result?: string; cliSessionId?: string }
  | { type: 'error'; message: string };

export interface RunRequest {
  prompt: string;
  cwd: string;                 // pasta de trabalho
  systemAppend?: string;       // instruções do agente
  allowedTools?: string[];
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
