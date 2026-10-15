# Motion & animation

Principles: motion explains state change (a ticket moved, a run streamed), never decorates. Everything respects
`prefers-reduced-motion`. Keep it cheap: transform/opacity only, no layout thrash.

## Libraries (all permissive licenses — confirm in each repo before adding)
| Need | Library | Repo (cloned in `references/`) |
|---|---|---|
| Component & layout animation, gestures, shared-layout transitions (kanban card moving columns) | **Motion** (`motion`, ex-Framer Motion) | `motiondivision/motion` |
| Zero-config list add/remove/reorder animation (chat messages, ticket lists) | **AutoAnimate** | `formkit/auto-animate` |
| Accessible drag & drop for the kanban | **dnd-kit** | `clauderic/dnd-kit` |
| Copy-paste animated components (shimmer, marquee, number ticker, border beam) for inspiration | **Magic UI** (copy, don't depend) | `magicuidesign/magicui` |
| Tailwind animation utilities | `tw-animate-css` | — |
| Brand: blinking owl | CSS in `brand/logo-animated.svg` | — |

## Where motion is used
- **Streaming text**: caret + soft fade-in per chunk; no per-character layout shifts.
- **Run status**: running agent shows the owl-eyes pulse; tool calls slide into a timeline.
- **Kanban**: Motion `layoutId` for card travel, dnd-kit for dragging, spring settle.
- **Approvals queue**: gate appears with a gentle attention pulse (one-shot, not looping).
- **Empty / loading states**: owl blink (`logo-animated.svg`).

## Rules
1. Durations 120–250 ms for UI feedback, up to 400 ms for page-level transitions.
2. Springs for physical moves, ease-out for appear, ease-in for disappear.
3. Wrap with a `useMotionPreference()` hook; reduced motion = instant or opacity-only.
4. No animation libraries in `packages/core`/`db`/`server`; they live in `apps/web` and `packages/ui`.

## Implementation (prompt 17)
- `packages/ui` is the only place that depends on `motion` and `@formkit/auto-animate`; `apps/web` imports them
  through `@owl/ui` (`motion`, `LayoutGroup`, `FadeIn`, `Pulse`, `ListAnimated`, `StreamCaret`). `@dnd-kit/core`
  stays in `apps/web`. Boundary tests: `apps/web/src/motion.test.tsx` and `qa-motion.test.tsx`.
- `useMotionPreference()` returns `{ reduced }` from `prefers-reduced-motion`, follows live changes and is `false`
  when `matchMedia` is missing.
- `FadeIn` renders visible at once under reduced motion; `Pulse` is a one-shot ring (none when reduced);
  `ListAnimated` wraps AutoAnimate (which also honours reduced motion, and is disabled on unmount);
  `StreamCaret` has a fixed `0.5ch` inline-block width so it never shifts layout, and is static when reduced. It is
  used for "Pensando…"; streamed text uses the CSS `.owl-caret`.
- CSS: `.owl-caret::after` and `.owl-blink .owl-eyes` set `animation: none` under `prefers-reduced-motion: reduce`.
- Kanban card: the `<li>` carries Motion's `layoutId` + `layout: 'position'` (spring) for travel between columns;
  the inner `<div>` carries dnd-kit's drag transform, so the two never compete for the same `transform`. Under
  reduced motion the `<li>` gets `layout: false` and no `layoutId`: the card appears in place. Dragging still follows
  the pointer (direct user action).
