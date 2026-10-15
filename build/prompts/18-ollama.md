# 18 — Adaptador Ollama

**Agente:** `backend`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/06-research/ollama.md`, `docs/02-architecture/routing-and-costs.md`

## Tarefa
1. `ProviderAdapter` `ollama` sobre a API HTTP local (`127.0.0.1:11434`), com stream.
2. `isAvailable()` checa o endpoint; listar modelos instalados.
3. Roteador: tier `pequeno` usa Ollama quando disponível.

## Critérios de aceite
- Teste com servidor HTTP falso cobrindo texto em stream, erro e cancelamento.
- Sem Ollama, o app funciona normalmente (fallback).
