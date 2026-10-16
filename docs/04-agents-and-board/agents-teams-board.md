# 08 — Agentes, equipes, projetos e quadro

## Entidades
- **Agente** (biblioteca global, `~/.owl/agents/*.md` ou `agents/` do repo):
  papel, provedor/modelo preferido, skills, ferramentas permitidas, prompt de sistema.
- **Equipe**: agentes alocados a um projeto, com papéis.
- **Projeto**: pasta de trabalho, quadro, memória, pipelines próprios.
- Um agente (ex.: gerente) pode estar em várias equipes. A **memória é separada por projeto**.

## Formato de agente de execução (exemplo)
```markdown
---
nome: tech-lead
papel: techlead
provedor: claude-cli
modelo: padrao
ferramentas: [Read, Grep, Glob]
skills: [revisao-de-arquitetura]
pode_aprovar: false
roteamento: fixo   # ou auto: o roteador escolhe provedor/modelo pela complexidade (docs/02-architecture/routing-and-costs.md)
---
Você é o tech lead. Quebra tickets em subtarefas pequenas, define a abordagem técnica,
revisa entregas contra os critérios de aceite. Não escreve código de produção.
```

## Papéis iniciais (foco em código)
| Agente | Faz | Modelo sugerido |
|---|---|---|
| `po` | Escreve tickets e critérios de aceite, valida entrega do ponto de vista do usuário | médio |
| `tech-lead` | Quebra tarefas, define abordagem, revisa | forte |
| `dev-front` | Interface | forte |
| `dev-back` | API, banco, lógica | forte |
| `qa` | Testes e verificação dos critérios | médio |
| `revisor` | Revisão de código, idealmente **outro provedor** que o autor | médio/forte |
| `memoria` | Resume tickets fechados, grava fatos | pequeno |
| `roteador` | Classifica complexidade e escolhe modelo | pequeno/regras |
| `refinador-de-prompt` | Melhora o pedido do usuário | pequeno/Codex |

Começar com 3 papéis ativos (tech lead, dev, QA) por causa do custo.

## Quadro como barramento
Agentes se comunicam por **tickets e comentários**, não conversando entre si.
Cada agente lê só o ticket + resumo + fatos relevantes. Isso economiza tokens e deixa histórico auditável.

Estados: `backlog → pronto → em_andamento → em_revisao → aguardando_aprovacao → concluido`
(+ `bloqueado`).

Fluxo típico:
1. Usuário descreve o objetivo → `po` cria ticket com critérios de aceite.
2. `tech-lead` quebra em subtarefas e atribui.
3. `dev-*` executa em **git worktree próprio**.
4. `qa` roda testes; `revisor` revisa.
5. Portão de aprovação quando necessário → usuário aprova/rejeita.
6. `memoria` resume e grava fatos.

## Provedores de quadro
```ts
interface BoardProvider {
  listTickets(projectId: string, filtro?: object): Promise<Ticket[]>;
  createTicket(t: NovoTicket): Promise<Ticket>;
  updateStatus(id: string, status: Status): Promise<void>;
  comment(id: string, autor: string, texto: string): Promise<void>;
}
```
Implementações: `local` (SQLite, padrão), `linear` (API/MCP oficial, chave pessoal do usuário),
depois `github-issues`. Sincronização: o local é a referência; o externo espelha.

## Portões de aprovação
Criar `approval` pendente quando:
- custo estimado acima do teto do ticket;
- ação destrutiva (apagar arquivos, push, deploy, merge);
- reprovação do `tech-lead`/`po`;
- baixa confiança do roteador.
Aprovação pela interface (e, com Linear, mudando o estado lá).

## Isolamento
- Cada dev em um git worktree/branch próprio.
- Ferramentas por agente via `--allowedTools`.
- Nenhum merge automático sem aprovação.
- Concorrência máxima configurável (padrão 1–2).

## Skills
Pastas com `SKILL.md`. Seguir o mesmo formato do Claude Code para compatibilidade
(confirmar especificação atual na documentação oficial).
Organizar em **pacotes** (ex.: `pacote-codigo`, futuramente `pacote-video` com ffmpeg/Remotion).

## Decisões (prompt 12 — agentes como arquivos e pipelines)
- **Onde ficam**: `~/.owl/agents/*.md` (biblioteca do usuário, `OWL_LIBRARY_DIR`) e `examples/agents/` (exemplos do repositório, somente leitura).
  Mesmo nome nos dois: **vale o do usuário**; apagar o arquivo do usuário devolve o exemplo. Skills em `skills/<nome>/SKILL.md` e pipelines em
  `pipelines/<nome>.yaml`, com o mesmo layout e a mesma regra de precedência.
- **Campos do agente** (validados com zod, campo desconhecido é erro para pegar typo): `nome` (igual ao nome do arquivo), `descricao`, `papel`,
  `provedor`, `modelo`, `fallback` (alternativas oferecidas na falha), `ferramentas`, `skills`, `pode_aprovar` (usado pelo quadro, prompt 13).
  O provedor e as skills precisam existir. Arquivo inválido **aparece na biblioteca com o motivo** e é ignorado; não derruba nada. Um arquivo do
  usuário quebrado nunca roda: se houver exemplo de mesmo nome, ele é usado e o problema continua listado.
- **Índice**: a tabela `agents` (migração 0007) é só um índice, reconstruído a cada listagem e a cada início de pipeline; os arquivos são lidos do
  disco a cada uso, então **editar o arquivo vale na próxima execução**, sem reiniciar. `runs.agent_id` aponta para o índice (o id não muda ao editar).
- **Skills**: formato do Claude Code (`SKILL.md` com `name` e `description` no front matter; outras chaves como `allowed-tools` são aceitas e
  ignoradas). O OWL **não grava nada na pasta do projeto**: as instruções das skills que o agente declara são anexadas ao prompt de sistema, o que
  funciona igual para Claude e Codex (as CLIs rodam isoladas, sem skills nem slash commands próprios).
- **Pipeline**: cada etapa pode ter `agente`, `quando`, `entrada` (a saída de uma etapa vira entrada da seguinte via `{{ etapas.<id>.saida }}`),
  `tentativas` (1–5; tentativas automáticas no **mesmo** provedor antes de perguntar ao usuário) e `outroProvedorQue: <etapa anterior>`
  (o agente roda no primeiro provedor, entre o seu e os `fallback`, diferente do que executou aquela etapa; sem opção, a etapa falha com mensagem).
  Nunca se troca de provedor em silêncio: a troca é declarada no arquivo. A escolha "refinador" do usuário só vale para agentes de papel `refinador`.
- **Mesmo agente em duas sessões**: o agente é uma definição sem estado; cada etapa de agente roda `stateless` (não lê nem grava o `--resume` da conversa).
- **Ambiente do filho**: as CLIs recebem uma cópia filtrada do ambiente (`childEnv`: PATH, HOME, locale, XDG, certificados, proxy, `CLAUDE_*`,
  `CODEX_*`), não o do servidor. Para repassar mais variáveis: `OWL_ENV_PASSTHROUGH=NOME1,NOME2`.
- **Exemplos somente leitura**: `dev-front`, `dev-back` e `qa` têm só `Read/Grep/Glob` e entregam diffs; `Edit/Write/Bash` entram com os git worktrees (prompt 14).

## Decisões (prompt 13 — quadro local e portões)
- **Onde está o quê**: `packages/board` (`BoardProvider`, `LocalBoard`, regras de transição, `ticketBrief`), `packages/db` (migração 0008, repositório `tickets`, `approvals` com tipo), `apps/server/src/board-flow.ts` (o fluxo de exemplo, que roda os agentes) e `board-routes.ts` (HTTP). O `BoardProvider` aceita retorno síncrono ou `Promise` para que o espelho do Linear (prompt 16) caiba nele.
- **Identificador**: `PREFIXO-número`, número por projeto (`tickets.numero`), prefixo das 3 primeiras letras do nome do projeto. Posição na coluna é float (`ordem`), como o `sortOrder` do Linear: soltar entre dois cartões usa a média, sem renumerar.
- **Quem pode mover o quê**: a pessoa move para qualquer coluna. Um **agente** só segue `AGENT_TRANSITIONS` (`packages/board/src/rules.ts`) e nunca sai de `aguardando_aprovacao`/`concluido` por conta própria. Se um agente tenta fechar um ticket com `requer_aprovacao`, o quadro abre o portão de entrega no lugar. Mover o cartão à mão para `aguardando_aprovacao` abre o portão; tirá-lo de lá à mão encerra os portões abertos. As ações HTTP de agente (`agente` no corpo) usam as mesmas regras.
- **Portões** (`approvals.tipo`): `entrega` (aprovar → `concluido`), `custo` (o passo seguinte passaria de `orcamento_tokens`: tokens já gastos somados na soma das runs do ticket + estimativa do prompt; aprovar libera **só aquele passo**, o próximo pergunta de novo), `destrutiva` (`POST /tickets/:id/actions`: apagar/push/deploy/merge/drop... **sempre** abre portão; a lista é de propósito larga), `reprovacao` (QA ou revisor disse "VEREDITO: reprovado"; aprovar = confirmar o retrabalho), `confianca` (reservado ao roteador, prompt 15). O ticket fica em `aguardando_aprovacao` e a execução do passo pausa até a decisão. `retomar_json` guarda o agente, a tarefa e o estado anterior; as pausas sobrevivem a reinício.
- **Rejeição**: sempre volta o ticket para `em_andamento` e o comentário (obrigatório) vira comentário do ticket, que o agente lê. Rejeitar `entrega`/`reprovacao` roda de novo o agente responsável; rejeitar `custo`/`destrutiva` significa "não faça" e não roda nada.
- **O que o agente lê** (`ticketBrief` + `montarContexto`): o ticket, o título do pai, as subtarefas, os últimos 12 comentários (cercados como dado, não instrução), o resumo do ticket (ou do pai) e os fatos **fixados** do projeto, dentro de um orçamento. Nunca as conversas do chat. As execuções de um ticket usam uma conversa oculta (`tickets.session_id`, fora da lista de conversas), `stateless`, sem `--resume`.
- **Fluxo de exemplo** (`BoardFlow`): objetivo → `po` (JSON com título/descrição/critérios) → `tech-lead` (JSON com `subtarefas`, até 8, cada uma com o `agente`) → `dev-*` por subtarefa → `qa` (linha `VEREDITO: aprovado|reprovado`) → portão de entrega → `memoria` (resumo vai para o ticket, fatos para o projeto **não fixados**, para a pessoa revisar). Resposta que não segue o formato **bloqueia** o ticket com um comentário; nada é adivinhado. O estado fica no banco (status, portões, comentários), não na memória: após reinício, só a execução em andamento se perde (o ticket fica bloqueado e dá para rodar de novo).
- **Pai e subtarefas**: quando todas as subtarefas ficam `concluido`, o pai é fechado sozinho; se o pai tem `requerAprovacao`, ele **não fecha**: abre o portão de entrega (`aguardando_aprovacao`) e só conclui quando a pessoa aprova. No portão `reprovacao` os botões são "Confirmar e refazer" e "Refazer do meu jeito": nos dois casos o autor refaz, e o comentário vira a instrução.
- **Histórico**: `ticket_events` (quem, quando, de→para, run) + comentários com `autor_tipo`; o custo é a soma das `runs` ligadas ao ticket (`runs.ticket_id`), nada duplicado.
- **Concorrência**: as execuções de um mesmo ticket são sequenciais (mesma conversa oculta); tickets diferentes seguem o `concurrency` do executor.

## Decisões (prompt 14 — projetos, equipes e worktrees)
- **Projeto**: `PATCH /projects/:id` (nome, pasta, instruções, `branchBase`, `maxConcorrencia`) e `DELETE /projects/:id` (o corpo traz `confirmar` = nome do projeto;
  recusa com execução em andamento ou worktree aberto; apaga só o que está no banco, **nunca arquivos da pasta**). `GET /projects/:id` devolve também se a pasta é repositório git,
  a branch atual/base, a concorrência efetiva e as equipes.
- **Equipes**: `teams`/`team_members` (migração 0009 só acrescenta nome único por projeto). Enquanto o projeto não tem **nenhum membro em equipe nenhuma**, qualquer agente da
  biblioteca trabalha nos tickets; com ao menos um membro, **só membros** (o `tech-lead` também só escolhe subtarefas para membros, senão cai no `dev` padrão, que também precisa ser
  membro). O `papel` na equipe vale só naquele projeto e **substitui** o `papel` do arquivo do agente no fluxo do quadro (um gerente pode ser `techlead` aqui e `revisor` ali).
  O mesmo agente pode estar em equipes de projetos diferentes (`GET /agents/:nome/projects`).
- **Memória do agente por projeto**: `facts.agent_id` + `project_id`. `facts.listAgent` devolve só os fatos daquele par; `listScope` (fatos do projeto) continua com `agent_id IS NULL`,
  então a memória de um agente nunca vaza para o projeto nem para o mesmo agente em outro projeto. Fatos **fixados** do agente entram no prompt dele nos tickets daquele projeto
  (depois dos fatos do projeto). API: `GET|POST /projects/:id/agents/:agente/facts`; a tela da equipe lista, fixa, apaga e acrescenta.
- **Um worktree por ticket que escreve** (`apps/server/src/worktrees.ts`): pasta em `<OWL_DATA_DIR>/worktrees/<projeto>/<id-do-ticket>`, branch `owl/<id>-<titulo>` a partir da branch
  base do projeto (`branchBase` ou a branch em uso). Quem decide se um agente precisa de worktree é `analyzeTools` (`packages/core/src/tools.ts`): qualquer `Edit/Write/MultiEdit/NotebookEdit`
  ou `Bash(...)` marca o agente como **escritor**; escritor sem worktree possível (pasta sem git, sem commit, HEAD solto) **não roda** e o ticket é bloqueado com a instrução do que
  arrumar. Quem só lê (QA sem escrita, revisor, memória) roda no worktree do ticket se ele existir, senão na pasta do projeto. Chamadas ao git são `spawnSync` com vetor de argumentos
  (regra 4), sem hooks e com identidade fixa `OWL <owl@localhost>` nos commits do OWL; elas são síncronas de propósito (operações locais curtas, e o fluxo que as chama é síncrono).
- **Ciclo do worktree**: ao terminar uma execução que escreveu, o OWL **commita** tudo na branch do ticket (comentário no ticket). Ao **concluir** o ticket o worktree é removido
  (`removido`) e **a branch fica** guardando o trabalho. Reabrir/rejeitar a entrega recria o worktree sobre a mesma branch. Nada é apagado nem mesclado sozinho.
- **Mesclar e descartar exigem aprovação** (regra 5): `POST /tickets/:id/branch/merge|descartar` só abre um portão `destrutiva` com `retomar.acao`. Esse portão **não move o ticket**
  (rejeitar uma mesclagem não reabre um ticket concluído). Aprovado, o OWL faz `git merge --no-ff` na branch base, **só** se a pasta do projeto estiver nela e sem alterações
  não commitadas (senão recusa e diz por quê; nada é tocado); em conflito faz `merge --abort`. Descartar remove worktree e branch (`branch -D`) só depois de aprovado.
  `merge`/`push`/`deploy` nunca saem de um agente: nem o `Bash` escopado deixa (veja abaixo).
- **Ferramentas por agente** (`ferramentas` → `--allowedTools`): a biblioteca **recusa** o arquivo (aparece em "problemas") com `Bash` sem escopo, `Bash(...)` com comando fora da lista
  (`pnpm|npm|yarn` só scripts do projeto: test/run/lint/typecheck/build…; `npx` só vitest/tsc/eslint/prettier; `git` só status/diff/log/show/add/commit/branch/rev-parse/ls-files;
  `ls cat head tail wc rg grep pwd node`), com encadeamento/redirecionamento/`$()`, com palavra destrutiva (apagar, push, merge, deploy, `branch -D`…), `node -e`, ferramentas fora de
  `Read Grep Glob LS Edit Write MultiEdit NotebookEdit Bash(...)`, e escrita em agente de **Codex** (sandbox fixo somente leitura). É a inversão para lista de permissão que o roadmap pedia, feita
  na camada de ferramentas. No chat (pipelines) o agente **só lê**: ferramentas de escrita são descartadas, porque não há worktree.
- **Escrita confinada (verificado com o `claude` real)**: `--allowedTools Edit`/`Write` **sem caminho deixa o modelo gravar em qualquer lugar** (um `Write` criou um arquivo fora da pasta de
  trabalho). Só uma regra de caminho confina, e a CLI só honra `Edit(<caminho>)` (cobre Write/MultiEdit). Por isso o adaptador troca toda ferramenta de escrita por `Edit(//<cwd>/**)`
  (caminho dado e caminho real, por causa de symlinks como `/home → /var/home`). Limite que continua: o `Bash(pnpm test:*)` roda os scripts do próprio projeto e esses podem tocar fora do
  worktree; o isolamento total é o sandbox de container (opcional, ainda no roadmap).
- **Concorrência**: global `OWL_CONCURRENCY` (padrão 1) **e** por projeto (`projects.max_concorrencia`, ou `OWL_PROJECT_CONCURRENCY`, padrão 2); vale o mais restrito. O limite do projeto é lido a
  cada vez que a fila anda, então mudar na tela vale para a próxima execução. Chat sem projeto só obedece ao global. Para dois tickets rodarem em paralelo é preciso `OWL_CONCURRENCY ≥ 2`.
- **Interface**: seletor de projeto no cabeçalho do quadro e da tela do projeto; **Equipe** na barra lateral abre a tela do projeto (configurações, equipes, papéis, memória por agente);
  no painel do ticket, "Trabalho isolado" mostra a branch, os commits à frente e os dois pedidos de aprovação.


## Decisões (prompt 16 — quadro avançado: etiquetas, relações, ciclos)
O prompt 16 do pacote original era um espelho no Linear; foi **descartado** (o quadro é próprio, sem serviço de terceiros) e virou isto. Código em `packages/board/src/local.ts`, `packages/db/src/repos/quadro.ts`, rotas em `apps/server/src/board-routes.ts`, tela em `apps/web/src/components/BoardExtras.tsx`.
- **Etiquetas** por projeto (nome único ignorando maiúsculas, cor `#rrggbb`), várias por ticket; só do mesmo projeto. **Relações** `bloqueia | relacionado | duplicado` entre tickets do mesmo projeto; recusadas: a si mesmo, par repetido (`relacionado` e `duplicado` não têm direção), outro projeto e **ciclo de bloqueio** (direto ou por um caminho). Cada mudança entra no histórico dos dois tickets.
- **Bloqueio vale para agentes, não para pessoas**: um agente não move para `em_andamento` (409 `blocked_by_open_ticket`) e `BoardFlow.run` recusa rodar um ticket com bloqueador aberto (comentário do sistema + ticket `bloqueado`). A pessoa pode mover o cartão ou rodar com `ignorarBloqueio: true`. O bloqueador `concluido` libera.
- **Ciclos** por projeto: número sequencial, datas válidas, `fim >= inicio`; um ticket está em um ciclo por vez; progresso = tickets e pontos por estado (`GET /cycles/:id`). Apagar o ciclo mantém os tickets (`cycle_id` volta a `NULL`).
- **Estimativa** (0–1000 pontos) e **prazo** (data) em `tickets`. Sem ordenação/alerta por prazo ainda.
- **Rotas**: `/projects/:id/labels`, `/labels/:id`, `/tickets/:id/labels/:labelId` (PUT/DELETE), `/tickets/:id/relations` (POST), `/relations/:id` (DELETE), `/projects/:id/cycles`, `/cycles/:id`, `/tickets/:id/cycle` (PUT). `GET /projects/:id/board` traz `etiquetas`, `ciclos` e, por ticket, `etiquetas` e `bloqueadoPor`.
