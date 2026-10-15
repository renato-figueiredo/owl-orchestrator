# 07 — Exclusão, limpeza e backup

## Exclusão de chat (com imagens)
1. **Lixeira**: `DELETE /sessions/:id` marca `deleted_at`. A interface esconde a sessão.
2. **Purga** (manual ou após 30 dias), em uma transação:
   `DELETE FROM sessions WHERE id = ?` → CASCADE apaga runs, mensagens e anexos;
   triggers limpam o FTS5.
   Na mesma transação, apaga os **fatos não fixados** que o resumidor extraiu das runs da sessão
   (`facts.origem_run_id`). Fatos **fixados** ficam: são curadoria do usuário e valem para o projeto, não só para o chat.
3. **Depois do commit**, coleta de órfãos:
   ```sql
   SELECT hash, caminho FROM blobs
   WHERE hash NOT IN (SELECT blob_hash FROM attachments);
   ```
   Para cada um: apagar o arquivo do disco, depois a linha em `blobs`.
4. Rotina periódica (ex.: ao iniciar o app) repete a coleta e procura arquivos em
   `data/attachments` sem linha em `blobs`.
5. Recuperar espaço: `PRAGMA incremental_vacuum;` periodicamente, `VACUUM` manual opcional.

Ordem importa: banco primeiro, arquivos depois. Se o app cair no meio, a varredura corrige.

## Transcrições das CLIs
Claude Code e Codex guardam as próprias sessões (ex.: em `~/.claude` e `~/.codex`; confirmar caminhos).
Apagar no app **não** apaga esses arquivos. Oferecer opção "apagar também a sessão da CLI"
(usando o `cli_session_id`) ou ao menos avisar o usuário.

## Backup
**Nunca** sincronizar o `.db` aberto em Dropbox/Drive/OneDrive (risco de corrupção com WAL).

Opções (módulo opcional, desligado por padrão):
- **Snapshot**: `VACUUM INTO 'backups/AAAA-MM-DD.db'` ou API de backup do better-sqlite3;
  a cópia pode ir para uma pasta sincronizada. Manter N últimas.
- **Litestream**: replicação contínua para armazenamento S3 compatível (Backblaze B2, Cloudflare R2).
- **restic / rclone**: pasta de anexos e configs, com criptografia do lado do cliente.

Criptografar antes de enviar: conversas e prints podem conter dados sensíveis.
Documentar a restauração e testar.

## Acesso remoto
Rodar sempre na máquina do usuário. Para acessar do celular, VPN privada (ex.: Tailscale).
Nunca expor a porta na internet.
