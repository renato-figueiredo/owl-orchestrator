# Primeiros passos

[← Guia](README.pt-BR.md) · [English](getting-started.md) · Português (BR)

O OWL roda na sua máquina e conversa com as **CLIs oficiais que você já usa**. Ele nunca vê suas senhas ou tokens: cada CLI
guarda o próprio login.

## Requisitos
- **Node.js 22+** e **pnpm** (o repositório fixa a versão do pnpm em `packageManager`).
- Pelo menos uma destas CLIs, instalada **e logada** (o OWL confere com `--version` e mostra o que encontrou):
  - `claude` (Claude Code)
  - `codex` (Codex CLI da OpenAI)
- Linux ou macOS. Windows não foi testado.

## Instalar e rodar
```bash
git clone https://github.com/renato-figueiredo/owl-orchestrator.git
cd owl-orchestrator
pnpm install
pnpm dev
```
O `pnpm dev` sobe dois processos:

| O quê | Endereço |
|---|---|
| Servidor da API | http://127.0.0.1:4317 (`/health` responde `{"status":"ok"}`) |
| Aplicação web | **http://127.0.0.1:5173** ← abra este |

Os dois escutam **só em loopback**: nada fica acessível a outras máquinas.

## Primeira conversa
1. Abra http://127.0.0.1:5173.
2. Clique em **Projeto +** e crie um projeto: um nome e a **pasta** em que ele trabalha (precisa estar dentro da sua pasta pessoal;
   veja [Configuração](configuration.pt-BR.md)). Opcional: instruções que todo run do projeto vai receber.
3. Clique no **+** ao lado do nome do projeto para iniciar uma conversa nele.
4. Escolha o provedor (`claude-cli` ou `codex-cli`; uma CLI não instalada aparece como indisponível), escreva e aperte **Enter**.
5. A resposta chega em stream. O painel à direita mostra status, ferramentas usadas e tokens.

Depois: [Como usar](how-to-use.pt-BR.md).

## Onde ficam seus dados
Conversas, execuções e projetos ficam num arquivo SQLite local (`OWL_DATA_DIR`, padrão `./data` relativo ao diretório onde o
servidor roda; com `pnpm dev` isso é `apps/server/data/`, ignorado pelo git). Nada sai da sua máquina, exceto para a CLI que você escolheu.
