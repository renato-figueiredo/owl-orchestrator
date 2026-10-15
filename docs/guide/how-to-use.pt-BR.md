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

## Memória
O painel da direita tem duas abas: **Execução** e **Memória**.

- **Resumo da conversa**: um resumo curto que o OWL mantém em dia (a cada N mensagens, ou quando você aperta **Resumir agora**). Dá para editar, e
  **Desfazer** traz a versão anterior de volta. Um resumo que falha nunca substitui um bom.
- **Fatos**: afirmações curtas que devem valer daqui para frente ("usar pnpm", "responder em português"). Pertencem ao **projeto**: todas as conversas dele
  compartilham os fatos, e nenhum outro projeto os vê. **Só os fatos fixados (Fixar) são enviados ao modelo.** Quando o resumidor percebe uma decisão, ele a
  propõe como fato, *sem fixar*, para você revisar.
- **Configurações da memória**: quantas mensagens recentes (N), quando resumir, o orçamento do contexto em tokens, resumo automático, trechos
  relacionados, ferramentas de memória sob demanda e quem escreve os resumos (padrão: Claude haiku, para poupar um limite pequeno do Codex).
- **Ferramentas de memória sob demanda** (desligadas por padrão, só no Claude): o Claude pode buscar nas mensagens antigas do projeto, ler resumos e listar ou
  salvar fatos quando precisar, em vez de receber tudo no prompt. Ele só enxerga o projeto atual (uma conversa sem projeto enxerga só a si mesma), os fatos que
  ele salva nunca ficam fixados (quem decide é você) e o painel de execuções mostra quais ferramentas de memória foram chamadas.

Quando o modelo recebe a memória? Quando a CLI **não tem sessão para retomar**: uma conversa nova num projeto, ou depois de trocar de provedor. Uma
conversa que continua retomando a mesma sessão da CLI só recebe os fatos fixados *novos*.

### Trocar de provedor no meio da conversa
Cada CLI guarda uma sessão interna própria (resultados de ferramentas, cache). Trocar do Claude para o Codex (ou o contrário) **não leva isso junto**, então o OWL pergunta antes:
- **Resumir e trocar**: atualiza o resumo e só então envia. O novo provedor recebe os fatos fixados, o resumo e as últimas mensagens.
- **Trocar sem resumir**: envia agora, com o resumo que já existir.
- **Cancelar**: nada é enviado e o seu texto continua na caixa.
Se o resumo falhar, o OWL não troca sozinho: mostra o motivo e deixa você escolher.

## Imagens e prints
Cole (**Ctrl+V**), arraste um arquivo para a caixa de mensagem ou clique em 📎. PNG, JPEG e WebP até o limite configurado.
- O OWL reduz cada imagem para WebP (lado maior 1500 px) e remove os metadados. A mesma imagem enviada duas vezes é guardada uma vez.
- Na primeira vez que a imagem vai a um modelo, ele vê a figura em si. Depois um modelo barato (o mesmo que escreve os resumos) a descreve e lê o texto dela; daí em diante vai a **descrição no lugar da figura**, o que economiza tokens.
- Clique na miniatura na conversa para ver em tamanho real (**Esc** fecha).
- Uma imagem sozinha já é uma mensagem válida.

## Lixeira, exclusão e backup
- Passe o mouse sobre uma conversa e clique em **✕**: ela vai para a **Lixeira** (no fim da barra lateral), escondida mas recuperável. Uma conversa com execução em andamento não pode ser movida: cancele a execução antes.
- Na Lixeira: **Restaurar**, **Excluir de vez** (pede uma segunda confirmação) ou **Esvaziar lixeira**. Excluir de vez remove mensagens, execuções, os fatos que o resumidor extraiu daquela conversa (os fixados ficam) e toda imagem que nenhuma outra conversa usa.
- Passado o prazo (30 dias por padrão, veja **Armazenamento e backup**) o OWL esvazia a lixeira sozinho. Dá para desligar.
- **A sua CLI guarda uma cópia própria.** `claude` e `codex` guardam o histórico em pastas delas (`~/.claude/`, `~/.codex/`). Excluir no OWL **não** mexe nisso; o OWL avisa quando se aplica. Ele nunca apaga arquivos em pastas que não são dele.
- **Armazenamento e backup** (no fim da barra lateral): prazo da lixeira, backup automático opcional do banco (desligado por padrão) e *Limpar arquivos sem uso*, que remove imagens que ninguém mais usa. Veja [Configuração](configuration.pt-BR.md#backup) para criptografar e enviar a cópia para outro lugar.

## Agentes, skills e pipelines
Clique em **Agentes** (barra lateral) para abrir a biblioteca. Um agente é um arquivo Markdown com um cabeçalho curto (nome, provedor, modelo, ferramentas, skills) e as instruções dele.
- **Onde ficam**: sua biblioteca em `~/.owl/agents/` (mude com `OWL_LIBRARY_DIR`) e os exemplos que vêm com o OWL (`po`, `tech-lead`, `dev-front`, `dev-back`, `qa`, `revisor`, `memoria`, `roteador`, `refinador-de-prompt`). Um arquivo seu com o mesmo nome de um exemplo vale mais.
- **Editar** um exemplo salva *a sua cópia*; o exemplo continua intacto, e **Voltar ao exemplo** remove a sua cópia. **Duplicar** copia qualquer agente com outro nome. **Novo agente** parte de um modelo.
- Um arquivo com erro não quebra nada: aparece na lista com o motivo (ex.: `ferramentas: Invalid input`) e é ignorado. Editar o arquivo à mão vale na próxima execução.
- **Skills** são pastas com um `SKILL.md` (mesmo formato do Claude Code), em `skills/<nome>/`. O agente lista as skills que usa e as instruções delas vão junto do prompt dele.
- **Pipelines** (`pipelines/<nome>.yaml`) encadeiam etapas. Cada etapa pode nomear um agente, rodar só `quando` uma condição valer, receber a saída da etapa anterior, repetir (`tentativas`) e rodar em um provedor diferente de uma etapa anterior (`outroProvedorQue`). O exemplo `refinar-executar-revisar` melhora o prompt, executa e pede ao revisor que confira o resultado no outro provedor. Para usar, envie `pipeline: "refinar-executar-revisar"` à API; escolher na caixa de mensagem está no [roadmap](../roadmap.md).
- Os agentes de exemplo de desenvolvimento e QA são somente leitura de propósito: devolvem diffs. Escrever no seu projeto vem com os git worktrees.

## Teclado e temas
- Na lista de conversas: **↑ / ↓** movem, **Enter** abre, **Tab** sai da lista.
- O botão ☾ / ☀ alterna claro e escuro (começa pela configuração do sistema e lembra a sua escolha).

## O que os agentes fazem (e não fazem) hoje
- O Codex roda num **sandbox somente leitura**. O Claude roda sem nenhuma ferramenta pré-aprovada, e no modo não interativo a CLI nega o resto.
  Na prática os agentes **leem e explicam, ainda não editam seus arquivos**. O acesso seguro de escrita (git worktrees, aprovações) está no [roadmap](../roadmap.md).
- Excluir conversas ainda não existe; as imagens anexadas ficam no disco até lá.
