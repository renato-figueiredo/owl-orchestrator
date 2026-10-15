# Configuração

[← Guia](README.pt-BR.md) · [English](configuration.md) · Português (BR)

O OWL lê variáveis de ambiente (veja [`.env.example`](../../.env.example); copie para `.env` se quiser, e nunca o versione).

| Variável | Padrão | O que faz |
|---|---|---|
| `OWL_PORT` | `4317` | Porta do servidor da API. |
| `OWL_DATA_DIR` | `./data` | Pasta do banco SQLite. Caminho relativo é relativo a onde o servidor roda (com `pnpm dev`: `apps/server/`). |
| `OWL_CONCURRENCY` | `1` | Runs executando ao mesmo tempo (1–16). Uma mesma conversa nunca roda dois ao mesmo tempo. |
| `OWL_MAX_ATTACHMENT_MB` | `10` | Maior imagem aceita ao anexar uma figura (0,1–100 MB, medida antes de o OWL reduzi-la). |
| `OWL_WORKSPACE_ROOTS` | sua pasta pessoal | Pastas onde projetos e runs podem trabalhar, separadas por `:`. Veja abaixo. |
| `OWL_ALLOWED_ORIGINS` | nenhuma | Origens de navegador extras autorizadas a chamar a API, separadas por vírgula. |
| `OWL_WEB_PORT` | `5173` | Porta do servidor web de desenvolvimento (só em desenvolvimento). |

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
