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
