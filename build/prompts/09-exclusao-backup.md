# 09 — Exclusão, lixeira, limpeza e backup

**Agente:** `banco-de-dados` (telas com `frontend`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/03-data/deletion-and-backup.md`

## Tarefa
1. Lixeira: `DELETE /sessions/:id` marca `deleted_at`; restaurar; purga manual e automática (30 dias, configurável).
2. Purga em transação + coleta de blobs órfãos depois do commit (ver `docs/03-data/deletion-and-backup.md`).
3. Varredura na inicialização: blobs sem referência e arquivos sem linha.
4. `PRAGMA incremental_vacuum` periódico.
5. Opção "apagar também a sessão da CLI" — antes, verificar onde cada CLI guarda sessões
   e implementar só se for seguro e documentado; caso contrário, mostrar aviso.
6. Backup opcional (desligado por padrão): snapshot via `VACUUM INTO` em `backups/`, mantendo N cópias;
   documentar Litestream e restic/rclone no README como alternativas.
7. Tela de configurações para lixeira e backup.

## Critérios de aceite
- Teste: após purga, nenhum arquivo de imagem exclusivo da sessão permanece no disco.
- Teste: imagem compartilhada com outra sessão **não** é apagada.
- Teste: snapshot de backup abre e contém os dados.

## Acréscimo (acesso remoto e backup)
Seguir `docs/03-data/sync-and-access.md`: snapshot diário com `VACUUM INTO`, criptografia com `age`,
envio opcional via `rclone`, comando `owl restore` e teste de restauração. Credenciais nunca no repositório.
