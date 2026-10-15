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
