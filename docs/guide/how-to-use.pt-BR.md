# Como usar

[← Guia](README.pt-BR.md) · [English](how-to-use.md) · Português (BR)

## Projetos e conversas
- Um **projeto** é um nome, uma **pasta** de trabalho e **instruções** opcionais. Tudo fica dentro do projeto: as conversas rodam na
  pasta dele e recebem as instruções dele, e nada vaza para outros projetos.
- As conversas ficam na barra à esquerda, agrupadas por projeto (**Sem projeto** = sem projeto, rodam na pasta do servidor).
  O título vem da sua primeira mensagem.
- Crie uma conversa em **Nova conversa** (sem projeto) ou no **+** ao lado de um projeto.

## Conversando
- **Enter** envia, **Shift+Enter** quebra a linha.
- **Provedor**: `claude-cli` ou `codex-cli`. Um que não esteja instalado fica desabilitado.
- **Modelo**: opcional. Vazio usa o padrão da CLI, ou digite um (no Claude: `haiku`, `sonnet`, `opus`).
- As respostas chegam em stream, com Markdown e blocos de código com botão **Copiar**.
- **Cancelar** interrompe uma resposta em andamento; o processo é encerrado e o run fica como cancelado.
- Pode recarregar a página: o histórico volta e um run ainda em andamento é retomado.
- As mensagens seguintes continuam a mesma sessão nativa da CLI (`--resume`), então a CLI mantém o próprio contexto.

## O painel de execução (à direita)
- **Status**, provedor e modelo do run atual.
- **Ferramentas**: o que o agente usou (por exemplo, um comando de shell), em tempo real.
- **Tokens** (e custo, quando a CLI informa: o Claude informa, o Codex não).
- **Execuções da conversa**: cada run com seus tokens e o **total da sessão**. As etapas de um pipeline aparecem encadeadas e recuadas.
- A seta no topo recolhe o painel.

## Melhorar prompt
Marque **Melhorar prompt** e um agente *refinador* reescreve o seu pedido (objetivo, contexto, restrições, formato de saída) antes do
run de verdade. O prompt melhorado é o que o provedor principal recebe; a sua mensagem original continua no histórico.

- **Refinador**: o padrão é o Codex. Escolha **haiku** (Claude) para usar a assinatura do Claude, por exemplo quando o limite do Codex acabar.
- **Editar antes de executar**: o fluxo para depois da reescrita. Aparece um cartão com o prompt melhorado numa caixa editável:
  - **Executar** (ou **Executar com a minha edição**): roda; o que vale é *a sua edição*.
  - **Melhorar de novo …**: reescreve outra vez com outro modelo.
  - **Descartar**: descarta o pedido, nada mais roda.
- Sem essa opção, as duas etapas rodam em sequência e aparecem encadeadas no painel, cada uma com seus tokens.
- Se o refinador **falhar** (limite, CLI ausente) ou responder vazio, o OWL **não** troca de modelo sozinho. Ele mostra o motivo e
  pergunta: tentar com outro modelo, **executar sem melhorar** ou descartar.

O refinador é um arquivo comum: [`examples/agents/refinador-de-prompt.md`](../../examples/agents/refinador-de-prompt.md), e o fluxo é
[`examples/pipelines/melhorar-e-executar.yaml`](../../examples/pipelines/melhorar-e-executar.yaml). Edite e o próximo pedido já usa a mudança (sem reiniciar).

## Teclado e temas
- Na lista de conversas: **↑ / ↓** movem, **Enter** abre, **Tab** sai da lista.
- O botão ☾ / ☀ alterna claro e escuro (começa pela configuração do sistema e lembra a sua escolha).

## O que os agentes fazem (e não fazem) hoje
- O Codex roda num **sandbox somente leitura**. O Claude roda sem nenhuma ferramenta pré-aprovada, e no modo não interativo a CLI nega o resto.
  Na prática os agentes **leem e explicam, ainda não editam seus arquivos**. O acesso seguro de escrita (git worktrees, aprovações) está no [roadmap](../roadmap.md).
- Excluir conversas, anexos/imagens e memória entre conversas ainda não existem.
