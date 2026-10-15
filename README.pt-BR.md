<p align="center"><img src="brand/logo-animated.svg" width="96" alt="Logo do OWL"></p>
<h1 align="center">OWL</h1>
<p align="center"><b>Orchestrator for Work &amp; LLMs</b><br>
Orquestrador local de agentes de IA para programar · <a href="README.md">English</a> · Português (BR)</p>

<p align="center">
<a href="https://github.com/renato-figueiredo/owl-orchestrator/actions/workflows/ci.yml"><img src="https://github.com/renato-figueiredo/owl-orchestrator/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT"></a>
<img src="https://img.shields.io/badge/status-pr%C3%A9--alfa-orange" alt="pré-alfa">
</p>

<!-- Os prints entram aqui depois de capturados: coloque os PNGs em docs/images/ (veja docs/images/README.md) e referencie, ex.:
<p align="center"><img src="docs/images/chat-dark.png" width="820" alt="Chat do OWL com o painel de execução"></p> -->

O OWL roda as **CLIs oficiais** que você já usa (Claude Code, Codex) e, depois, modelos locais (Ollama) como subprocessos **na sua
própria máquina**, com uma interface web local. Ele nunca lê, copia ou guarda suas credenciais: cada CLI mantém o próprio login.

> **Status: pré-alfa, a fase 1 (o núcleo do chat) está pronta.** Equipes de agentes e quadro estão planejados. Veja o [roadmap](docs/roadmap.md).

## O que funciona hoje
- Chat com streaming com o **Claude Code** e o **Codex**, com Markdown, blocos de código com cópia e botão de cancelar.
- **Projetos**: cada um tem a própria pasta e instruções, e as conversas nunca vazam entre projetos.
- **Melhorar prompt**: um agente refinador reescreve o seu pedido, você pode editar antes de rodar, e se o refinador falhar (por
  exemplo, o limite do Codex) o OWL pergunta qual modelo usar em vez de trocar em silêncio.
- **Memória**: fatos fixados por projeto e um resumo incremental editável da conversa; trocar de provedor no meio avisa e entrega o resumo à nova CLI.
- **Prints**: cole, arraste ou escolha imagens; ficam guardadas uma vez por conteúdo, aparecem na conversa e vão para a CLI.
- **Lixeira e backup**: conversas vão para uma lixeira recuperável; excluir de vez remove as linhas do banco, o índice de busca e os arquivos. Backup criptografado (age + rclone, opcional).
- **Memória via MCP**: as CLIs consultam a memória do projeto sob demanda, em vez de receber tudo a cada mensagem.
- Painel de execução com as ferramentas usadas, tokens, custo (quando a CLI informa) e as etapas encadeadas de um pipeline.
- Temas claro e escuro, navegação completa por teclado na lista de conversas.
- Seguro por padrão: só loopback, proteção contra DNS rebinding e requisições entre sites, agentes confinados às pastas que você permitir.

## O que vem a seguir
Agentes como arquivos, equipes e um quadro local
estilo Linear com portões de aprovação · git worktree por agente · roteamento por custo · espelho opcional no Linear e Ollama.
Detalhes no [roadmap](docs/roadmap.md).

## Início rápido
```bash
git clone https://github.com/renato-figueiredo/owl-orchestrator.git
cd owl-orchestrator
pnpm install
pnpm dev          # depois abra http://127.0.0.1:5173
```
Você precisa de Node 22+, pnpm, e da CLI `claude` e/ou `codex` instalada e logada.
Testes: `pnpm test` (unitários e API) e, depois de `pnpm exec playwright install chromium`, `pnpm --filter @owl/web test:e2e` (navegador, CLIs falsas, sem login).
Passo a passo: **[Primeiros passos](docs/guide/getting-started.pt-BR.md)**.

## Documentação
| | |
|---|---|
| [Primeiros passos](docs/guide/getting-started.pt-BR.md) | Instalar, rodar, primeira conversa |
| [Como usar](docs/guide/how-to-use.pt-BR.md) | Projetos, chat, melhorar prompt, painel de execução, teclado |
| [Configuração](docs/guide/configuration.pt-BR.md) | Variáveis de ambiente e o modelo de segurança |
| [Solução de problemas](docs/guide/troubleshooting.pt-BR.md) | Erros comuns e como resolver |
| [Desenvolvimento](docs/guide/development.pt-BR.md) | Estrutura, testes, como o projeto é construído |
| [Roadmap](docs/roadmap.md) · [Documentos de projeto](docs/README.md) | Para onde vai e por quê |

## Contribuindo
Leia o [CONTRIBUTING](CONTRIBUTING.md) e o [`CLAUDE.md`](CLAUDE.md). Relatos de segurança: [SECURITY](SECURITY.md).
Os documentos estão em português do Brasil; traduções para o inglês são bem-vindas.

## Aviso
Sem afiliação com Anthropic, OpenAI ou Linear. O OWL apenas executa as CLIs oficiais instaladas e autenticadas por você.
Você é responsável por respeitar os termos de cada provedor; as regras de assinatura mudam com frequência.

## Licença
[MIT](LICENSE)
