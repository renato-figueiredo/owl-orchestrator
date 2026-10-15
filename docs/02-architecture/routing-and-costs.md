# 09 — Roteamento e custos

## Cuidado
O roteador também gasta tokens. Só vale se economizar mais do que custa.

## Ordem de decisão
1. **Regras gratuitas** (sem modelo): tipo de ticket, tamanho do pedido, arquivos tocados,
   tamanho do diff, palavras-chave ("refatorar tudo", "migração").
2. **Modelo pequeno** só se as regras não decidirem. Saída JSON:
   `{ "complexidade": "baixa|media|alta", "confianca": 0-1, "motivo": "..." }`.
3. **Escalonar** ao falhar: tentar com modelo mais barato; se testes/revisão falharem, subir de nível.
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
