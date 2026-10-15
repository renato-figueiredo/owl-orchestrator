# 09 — Roteamento e custos

## Cuidado
O roteador também gasta tokens. Só vale se economizar mais do que custa.

## Ordem de decisão
1. **Regras gratuitas** (sem modelo): tipo de ticket, tamanho do pedido, arquivos tocados,
   tamanho do diff, palavras-chave ("refatorar tudo", "migração").
2. **Modelo pequeno** só se as regras não decidirem. Saída JSON:
   `{ "complexidade": "baixa|media|alta", "confianca": 0-1, "motivo": "..." }`.
3. **Escalonar** ao falhar: tentar com modelo mais barato; se o QA reprovar ou a entrega for rejeitada, subir de nível (a contagem vale para todos os agentes em `auto` do ticket).
4. Confiança baixa → portão de aprovação.

## Tiers (configuráveis)
- `pequeno`: refinar prompt, resumir, classificar.
- `medio`: QA, PO, revisões simples.
- `forte`: código complexo, arquitetura.

## Orçamentos
- Por ticket (`orcamento_tokens`) e por dia.
- Ao atingir 80%: avisar. Ao estourar: pausar e pedir aprovação.
- Plano Pro tem limite por janela de horas: mostrar gasto estimado por etapa na interface.

## Métricas
Por `run`: provedor, modelo, etapa, tokens in/out (quando a CLI informar), duração, status, complexidade.
Agregados: custo por ticket, taxa de sucesso por agente/modelo, retrabalho.
Usar os dados para ajustar as regras do roteador.

---

## Como está implementado (prompt 15)

Vale para o **quadro** (agentes que o `BoardFlow` executa). O chat e os pipelines YAML seguem com o provedor que escolhem; o roteador entra neles depois.

**Quem é roteado.** Só o agente com `roteamento: auto` no arquivo (padrão `fixo`). Os exemplos continuam `fixo`: ligar é uma linha no arquivo. `provedor`/`modelo` do arquivo viram só o plano B.

**Fase 1, regras (`packages/core/src/router.ts`, sem modelo).** Em ordem, a primeira que decidir vale, sempre com confiança 1:
1. palavra-chave de risco no pedido (migração, refatorar tudo, reescrever, arquitetura, segurança, autenticação, concorrência...) → `alta`;
2. diff grande (≥ 400 linhas ou ≥ 12 arquivos, medido na branch do ticket para `qa`/`revisor`) ou ≥ 5 subtarefas → `alta`;
3. papel: `memoria` → `baixa`; `po`, `qa`, `revisor` → `media`;
4. pedido muito longo (> 6000 caracteres) → `alta`;
5. mudança trivial ("typo", "renomear"...) ou pedido curto (≤ 600 caracteres, ≤ 2 critérios) → `baixa`.
Nada disso decidiu → ambíguo.

**Fase 2, modelo pequeno (só se ambíguo).** Uma execução `etapa: roteador` do tier `pequeno`, sem ferramentas, devolve `{"complexidade","confianca","motivo"}`, validado com zod. O prompt é o do agente `roteador` (se existir) ou o embutido. Resposta que não é JSON válido, ou classificador que falha, vale **confiança 0**: nunca se chuta, a pessoa decide. O pedido vai cercado em `<pedido>` e marcado como dado.

**Confiança baixa → portão `confianca`.** Abaixo do limiar (padrão 60%, configurável) o ticket espera. Aprovar roda o passo no tier proposto, sem perguntar ao modelo de novo; rejeitar não roda nada.

**Modelo local (prompt 18).** O tier `pequeno` usa o Ollama quando ele está no ar (`localPequeno.ativo`, padrão ligado) e o passo não usa ferramentas; senão, o provedor configurado. Detalhes em `docs/06-research/ollama.md`.

**Tiers.** `pequeno`, `medio`, `forte` apontam para `{provedor, modelo}`; padrão `claude-cli` com `haiku`, `sonnet`, `opus`. Edite na tela *Métricas e roteador* ou por `PUT /router`.

**Escalonamento.** Cada entrega rejeitada ou reprovação do revisor no ticket sobe um tier no retrabalho (`pequeno` → `medio` → `forte`; o `forte` fica no `forte`, e cada reprovação já pede uma pessoa). A decisão fica em `runs.tier`, `runs.complexidade` e `runs.roteamento_json` (`origem`: regra, modelo, escalonamento ou manual; motivo; confiança; falhas) e num evento `roteamento` do ticket.

**Orçamentos (em tokens).**
- *Por ticket* (`orcamento_tokens`): aviso em 80% (um comentário, uma vez); se o próximo passo passaria do teto, portão `custo`.
- *Por dia* (`orcamentoDiaTokens`, o dia vira à meia-noite local): soma os tokens de **todas** as execuções do dia, inclusive as do próprio roteador. Aviso em 80% uma vez por dia; se o próximo passo passaria do limite, portão `custo` ("Orçamento diário estourado"). Aprovar libera aquele passo. Cada ticket que tentar rodar depois também para no seu portão. Execuções ainda em andamento contam como uma execução esperada cada. **Só o quadro pausa**: conversa, pipelines YAML e memória continuam gastando (são ações diretas da pessoa), mas somam no total do dia. Configuração inválida de um campo volta ao padrão só daquele campo.
- A estimativa do próximo passo é o tamanho do prompt + 2000 tokens de resposta, então orçamentos abaixo de ~2000 tokens sempre pausam.

**Métricas (`GET /metrics?projectId&desde&ate`).** Tudo vem de `runs` (nada é guardado em duplicidade): custo e tokens por ticket, agente e modelo; taxa de sucesso = ok / (ok + erro), cancelamentos não contam; retrabalho = 2ª, 3ª... execução do mesmo agente no mesmo ticket (contada sobre todo o histórico do ticket, então não muda com o filtro de período; as do roteador não contam; inclui o QA revalidando e uma nova tentativa depois de erro, por isso tende a superestimar). O gasto do roteador aparece à parte, para conferir se ele economiza mais do que custa. Custo em dólar é só o que a CLI informou (Claude informa; Codex não), então tokens são a medida confiável.
