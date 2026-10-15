# 17 — Motion e animações

**Agente:** `frontend`  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/05-ui/motion-and-animation.md`

## Tarefa
1. Adicionar `motion`, `@formkit/auto-animate` e `@dnd-kit/core` em `apps/web`/`packages/ui` (conferir licenças e versões atuais).
2. Hook `useMotionPreference()` respeitando `prefers-reduced-motion`.
3. Primitivas em `packages/ui`: `FadeIn`, `ListAnimated` (AutoAnimate), `Pulse`, `StreamCaret`.
4. Kanban: arrastar com dnd-kit e transição de card com `layoutId`.
5. Estados vazio/carregando com a coruja piscando (`brand/logo-animated.svg`).

## Critérios de aceite
- Com reduced motion ativo, nenhuma animação de movimento roda.
- Sem layout shift durante o stream de texto.
- Nenhuma lib de animação fora de `apps/web` e `packages/ui`.
