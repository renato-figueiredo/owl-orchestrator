# 02 — Banco de dados

**Agente:** `banco-de-dados`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/03-data/database.md`, `docs/03-data/deletion-and-backup.md`

## Tarefa
1. Em `packages/db`: conexão better-sqlite3 com os PRAGMAs de `docs/03-data/database.md`.
2. Executor de migrações com tabela `schema_migrations`.
3. Migração `0001_inicial.sql` com `auto_vacuum = INCREMENTAL` e **todo** o schema de `docs/03-data/database.md`
   (incluindo tabelas da fase 2, para não refazer depois).
4. Repositórios tipados para: sessions, messages (com busca FTS5), runs, facts, blobs, attachments.
5. Função `buscarMensagens(consulta, sessaoOuProjeto, limite)` usando FTS5.

## Critérios de aceite
- Migração aplica do zero e é idempotente na reexecução.
- Teste: inserir mensagens, buscar por FTS, apagar, e a busca não retorna mais.
- Teste: apagar sessão remove runs, messages e attachments (CASCADE).
- `foreign_keys` verificado como ON em toda conexão.

## Não fazer
- Guardar imagens no banco.
