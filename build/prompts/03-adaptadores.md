# 03 — Adaptadores das CLIs

**Agente:** `backend` (tipos com apoio do `arquiteto`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/01-product/rules-and-compliance.md`, `docs/02-architecture/architecture.md`

## Tarefa
1. Em `packages/core`: tipos `RunEvent`, `RunRequest`, `ProviderAdapter` (ver `docs/02-architecture/architecture.md`).
2. Adaptador `claude-cli`:
   - Verificar flags reais com `claude --help` antes de implementar.
   - `claude -p <prompt> --output-format stream-json` (+ `--verbose` se exigido), suportar
     `--resume`, `--allowedTools`, `--append-system-prompt`, `--mcp-config`.
   - Parsear JSONL linha a linha → `RunEvent` (texto, ferramenta, uso de tokens, fim com session id).
3. Adaptador `codex-cli`:
   - Verificar com `codex exec --help` as opções de saída (JSON, se houver) e imagem.
   - Normalizar para `RunEvent` (mesmo que só texto no início).
4. `isAvailable()` checa se o binário existe e responde (`--version`).
5. Cancelamento por `AbortSignal` mata o processo filho.
6. Registro de adaptadores (`getAdapter(id)`).
7. Opção de configuração para remover `ANTHROPIC_API_KEY` do ambiente do subprocesso
   quando o usuário escolher "usar assinatura" (documentar o comportamento).

## Critérios de aceite
- Testes com **CLIs falsas** (scripts que imprimem JSONL de exemplo) cobrindo texto, ferramenta, fim, erro e cancelamento.
- Nenhum uso de shell; argumentos sempre em array.
- Nenhuma leitura de arquivos de credencial das CLIs.
- Script manual `pnpm --filter @owl/core try "olá"` roda um prompt real com cada CLI disponível.

## Não fazer
- Chamar APIs HTTP dos provedores diretamente.
