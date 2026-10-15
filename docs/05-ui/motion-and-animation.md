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
