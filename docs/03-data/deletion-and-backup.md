# 07 — Exclusão, limpeza e backup

## Exclusão de chat (com imagens)
1. **Lixeira**: `DELETE /sessions/:id` marca `deleted_at`. A interface esconde a sessão.
2. **Purga** (manual ou após 30 dias), em uma transação:
   `DELETE FROM sessions WHERE id = ?` → CASCADE apaga runs, mensagens e anexos;
   triggers limpam o FTS5.
   Na mesma transação, apaga os **fatos não fixados** que o resumidor extraiu das runs da sessão
   (`facts.origem_run_id`). Fatos **fixados** ficam: são curadoria do usuário e valem para o projeto, não só para o chat.
3. **Depois do commit**, coleta de órfãos **só dos blobs da própria sessão** (os hashes são lidos antes do cascade).
   Para cada um, em um único `DELETE ... WHERE hash = ? AND hash NOT IN (SELECT blob_hash FROM attachments) RETURNING caminho`
   (sem intervalo entre checar e apagar): se a linha saiu, apaga o arquivo; se outra sessão ainda usa, nada acontece.
4. Varredura (ao iniciar e a cada 3 h; `POST /maintenance/sweep` sob demanda): blobs órfãos e arquivos em
   `attachments/` sem linha em `blobs` (só nomes `ab/<hash>.webp` e temporários `.tmp`; nunca segue symlinks nem toca em outros nomes).
   **Carência de 1 h** (`blobs.visto_em`, migração 0004; mtime nos arquivos): a imagem é enviada antes da mensagem que a anexa,
   então um órfão recente não é lixo. Linhas cujo arquivo sumiu só são relatadas.
5. Recuperar espaço: `PRAGMA incremental_vacuum` depois de cada purga e na varredura; `VACUUM` manual opcional.

Ordem importa: **banco primeiro (linha), arquivo depois**. Se o app cair no meio, sobra um arquivo sem linha e a varredura apaga.
Purga só vale para sessão **já na lixeira** e sem execução em andamento (`409` caso contrário). A lixeira esvazia sozinha após
`lixeira.diasRetencao` (padrão 30; `lixeira.purgaAutomatica`).

## Transcrições das CLIs
Verificado em 2026-10-15: o Claude Code guarda `~/.claude/projects/<pasta-codificada>/<cli_session_id>.jsonl`; o Codex guarda
`~/.codex/sessions/AAAA/MM/DD/rollout-…-<id>.jsonl` **e** índices próprios (`state_*.sqlite`, `session_index.jsonl`, `history.jsonl`).
Apagar no app **não** apaga esses arquivos.

**Decisão: só avisar, não apagar.** O layout é interno e não documentado das CLIs (a codificação de pastas do Claude e os
índices do Codex podem mudar), apagar um arquivo e deixar o índice do Codex apontando para ele deixaria a CLI inconsistente, e as
pastas são do usuário/da CLI, não do OWL (regra de ouro 5). A purga devolve `cliSession: { provider, id }` e a interface mostra
que o histórico da CLI continua lá. Reavaliar se as CLIs ganharem um comando oficial de exclusão de sessão.

## Backup
**Nunca** sincronizar o `.db` aberto em Dropbox/Drive/OneDrive (risco de corrupção com WAL).

Opções (módulo opcional, desligado por padrão):
- **Snapshot**: `VACUUM INTO 'backups/AAAA-MM-DD.db'` ou API de backup do better-sqlite3;
  a cópia pode ir para uma pasta sincronizada. Manter N últimas.
- **Litestream**: replicação contínua para armazenamento S3 compatível (Backblaze B2, Cloudflare R2).
- **restic / rclone**: pasta de anexos e configs, com criptografia do lado do cliente.

Criptografar antes de enviar: conversas e prints podem conter dados sensíveis.
Documentar a restauração e testar.

### Implementado (prompt 09)
`BackupService` (`apps/server/src/backup.ts`): `VACUUM INTO` em arquivo temporário, `integrity_check`, `age -r` (chave pública em
`OWL_BACKUP_AGE_RECIPIENT`; o texto simples é apagado, inclusive se o `age` falhar), `rclone copyto` para `OWL_BACKUP_RCLONE_REMOTE`
(recusa enviar sem criptografia), últimas N cópias locais. Desligado por padrão; configurações em `settings.backup`.
`owl restore <arquivo> [--identity chave] [--data-dir pasta]` verifica antes e guarda o banco anterior como `.before-restore-…`.
Anexos e configs ficam fora do snapshot (restic/rclone, ver README); Litestream é alternativa para o banco.

## Acesso remoto
Rodar sempre na máquina do usuário. Para acessar do celular, VPN privada (ex.: Tailscale).
Nunca expor a porta na internet.
