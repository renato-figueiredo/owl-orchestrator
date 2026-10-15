# Configuração

[← Guia](README.pt-BR.md) · [English](configuration.md) · Português (BR)

O OWL lê variáveis de ambiente (veja [`.env.example`](../../.env.example); copie para `.env` se quiser, e nunca o versione).

| Variável | Padrão | O que faz |
|---|---|---|
| `OWL_PORT` | `4317` | Porta do servidor da API. |
| `OWL_DATA_DIR` | `./data` | Pasta do banco SQLite. Caminho relativo é relativo a onde o servidor roda (com `pnpm dev`: `apps/server/`). |
| `OWL_CONCURRENCY` | `1` | Runs executando ao mesmo tempo (1–16). Uma mesma conversa nunca roda dois ao mesmo tempo. |
| `OWL_MAX_ATTACHMENT_MB` | `10` | Maior imagem aceita ao anexar uma figura (0,1–100 MB, medida antes de o OWL reduzi-la). |
| `OWL_BACKUP_AGE_RECIPIENT` | nenhuma | Chave pública (`age1…`) que criptografa os backups. Veja [Backup](#backup). |
| `OWL_BACKUP_RCLONE_REMOTE` | nenhuma | Destino do `rclone` (ex.: `meuremoto:owl`) que recebe os backups criptografados. |
| `OWL_WORKSPACE_ROOTS` | sua pasta pessoal | Pastas onde projetos e runs podem trabalhar, separadas por `:`. Veja abaixo. |
| `OWL_LIBRARY_DIR` | `~/.owl` | Sua biblioteca de agentes, skills e pipelines (`agents/`, `skills/`, `pipelines/` dentro). |
| `OWL_ENV_PASSTHROUGH` | nenhuma | Variáveis de ambiente extras a repassar às CLIs, separadas por vírgula (ex.: `SSH_AUTH_SOCK`). Por padrão as CLIs recebem só o necessário (PATH, HOME, idioma, certificados, proxy, `CLAUDE_*`, `CODEX_*`), não o ambiente inteiro do servidor. |
| `OWL_ALLOWED_ORIGINS` | nenhuma | Origens de navegador extras autorizadas a chamar a API, separadas por vírgula. |
| `OWL_WEB_PORT` | `5173` | Porta do servidor web de desenvolvimento (só em desenvolvimento). |

## Backup
Desligado por padrão. Ligue em **Armazenamento e backup** (barra lateral) ou faça um agora. Tudo fica em `<OWL_DATA_DIR>/backups/`.

- **Snapshot**: cópia consistente do banco (`VACUUM INTO`, segura com o OWL rodando) chamada `owl-AAAA-MM-DD.db`; as N mais novas ficam (14 por padrão).
- **Criptografar** (recomendado; conversas podem ter segredos): instale o [`age`](https://age-encryption.org), crie uma chave com `age-keygen -o key.txt` e ponha em `OWL_BACKUP_AGE_RECIPIENT` a chave **pública** que ele mostra. Os backups viram `owl-….db.age`; a cópia sem criptografia é apagada em seguida. Guarde o `key.txt` **fora** dessa pasta e fora do repositório: sem ele ninguém, nem você, abre os backups.
- **Enviar para outro lugar**: instale o [`rclone`](https://rclone.org), rode `rclone config` uma vez e defina `OWL_BACKUP_RCLONE_REMOTE=meuremoto:owl`. O OWL se recusa a enviar um snapshot sem criptografia. Arquivos antigos no destino não são apagados: use as regras de ciclo de vida do próprio destino.
- **Credenciais** (chave privada do age, login do rclone) ficam na sua própria configuração, nunca no banco do OWL, nos logs nem neste repositório.
- **Fora do snapshot**: as imagens (`<OWL_DATA_DIR>/attachments/`) e os seus arquivos de agentes. Copie com o [restic](https://restic.net) (criptografado, deduplicado) para o mesmo lugar, ou com a ferramenta que preferir. Para replicação contínua do próprio banco, o [Litestream](https://litestream.io) funciona com o SQLite em modo WAL do OWL.
- **Nunca** ponha o `owl.sqlite` em uso (nem `-wal`/`-shm`) no Dropbox/Drive/OneDrive: pode corromper. Só os snapshots são seguros para sincronizar.

### Restaurar
Pare o servidor e rode:
```bash
pnpm owl restore caminho/owl-2026-10-15.db                        # snapshot simples
pnpm owl restore caminho/owl-2026-10-15.db.age --identity key.txt # criptografado
pnpm owl restore <arquivo> --data-dir /outro/lugar               # testar sem mexer nos seus dados
```
O snapshot é verificado antes; o banco que estava lá fica ao lado como `owl.sqlite.before-restore-…`. Restaure a pasta `attachments/` a partir da sua própria cópia; imagens que faltarem simplesmente não aparecem.

## Lixeira e limpeza
As conversas ficam 30 dias na lixeira (configurável, dá para desligar) e depois são excluídas. Ao iniciar e a cada 3 horas o OWL também remove
imagens que nenhuma conversa usa e arquivos de `attachments/` sem registro, e devolve o espaço livre ao disco. Imagens enviadas na última hora
são poupadas (talvez você ainda não as tenha mandado). Só são removidos arquivos que o próprio OWL nomeou (`ab/<hash>.webp`).

## Onde os agentes podem trabalhar (`OWL_WORKSPACE_ROOTS`)
A pasta de um projeto, e qualquer pasta usada por um run, precisa estar **dentro de uma dessas raízes**. Isso impede que um pedido
errado (ou malicioso) aponte um agente para o disco inteiro.

- O padrão é a sua pasta pessoal. Para ser mais restrito: `OWL_WORKSPACE_ROOTS=$HOME/projetos`.
- **Pastas ocultas abaixo de uma raiz são sempre recusadas** (`~/.ssh`, `~/.config`, …), e os symlinks são resolvidos antes da checagem, então um link não escapa.
- A checagem roda ao criar o projeto **e de novo a cada run**.

## Quem pode chamar a API
- O servidor só responde em `127.0.0.1`, e só a requisições cujo `Host` seja `127.0.0.1`, `localhost` ou `[::1]` (isso bloqueia DNS rebinding).
- Uma requisição de navegador que traga `Origin` precisa vir da própria página do OWL; outros sites recebem `403` (isso bloqueia requisições
  entre sites que usariam a sua CLI logada). O servidor de desenvolvimento do Vite não precisa de exceção: ele faz proxy de `/api` para o servidor.
- `OWL_ALLOWED_ORIGINS` serve só para um front end servido de outra origem, por exemplo `http://localhost:5173` se você mudar o proxy.

## Opções de provedor
Provedor, modelo e refinador são escolhidos na interface. O agente refinador e suas alternativas ficam em
[`examples/agents/refinador-de-prompt.md`](../../examples/agents/refinador-de-prompt.md) (`provedor`, `modelo`, `fallback`).
O OWL **remove as variáveis de chave de API** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) do ambiente das CLIs que ele inicia, para que usem
o **login da sua assinatura** e nunca cobrem uma chave de API por surpresa.
