# 15 — Roteador por complexidade e métricas

**Agente:** `backend` (painel com `frontend`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/02-architecture/routing-and-costs.md`

## Tarefa
1. Roteador em duas fases: regras (sem modelo) → modelo pequeno só se ambíguo (JSON validado).
2. Tiers configuráveis (`pequeno`, `medio`, `forte`) mapeados para provedor/modelo.
3. Escalonamento ao falhar testes/revisão; confiança baixa → aprovação.
4. Orçamentos por ticket e por dia; aviso em 80%; pausa ao estourar.
5. Painel de métricas: custo por ticket, por agente, por modelo; taxa de sucesso; retrabalho.

## Critérios de aceite
- Teste: regras decidem sem chamar modelo nos casos claros.
- Teste: orçamento estourado pausa e cria aprovação.
- Métricas batem com os `runs` gravados.
