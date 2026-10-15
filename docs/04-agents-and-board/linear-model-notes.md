# Linear-style local board — data model notes

Source: Linear's **public** GraphQL schema (`linear/linear`, `packages/sdk/src/schema.graphql`, cloned in
`references/linear-sdk`). We borrow the *shape* of the data model, not any proprietary code or UI assets.

## Entities worth mirroring (names verified against the schema)
| Linear type | OWL table | Notes |
|---|---|---|
| `Team` | `teams` | Own workflow states, cycle config (`cycleDuration`, `cycleStartDay`), `defaultIssueState`, sub-teams (`parent`/`children`) |
| `WorkflowState` | `workflow_states` | `type` ∈ `triage, backlog, unstarted, started, completed, canceled, duplicate`; `position` (float) orders columns; per team |
| `Issue` | `tickets` | `identifier` (e.g. `OWL-12`), `number`, `priority` (0–4), `estimate`, `sortOrder` (float, for drag & drop), `parent` (sub-issues), `dueDate`, `triagedAt`, `completedAt`, `canceledAt` |
| `IssueLabel` | `labels` | Per team or workspace (`team = null`), grouping via `parent`/`isGroup` |
| `IssueRelation` | `ticket_relations` | `type` ∈ blocks / related / duplicate |
| `Comment` | `comments` | `parent` for threads, author = human **or agent**, `resolvedAt` |
| `Cycle` | `cycles` | `number`, `startsAt`, `endsAt`, progress/scope history |
| `Project` / `ProjectMilestone` | `projects` / `milestones` | Status type ∈ `backlog, planned, started, paused, completed, canceled` |

## Mapping to our states (`docs/04-agents-and-board/agents-teams-board.md`)
| OWL state | Linear `WorkflowState.type` |
|---|---|
| `backlog` | `backlog` |
| `pronto` | `unstarted` |
| `em_andamento`, `em_revisao` | `started` |
| `aguardando_aprovacao` | `started` (plus a label or a custom state) |
| `concluido` | `completed` |
| `bloqueado` | `started` + relation `blocked by` |
| (cancelado) | `canceled` |

## Design decisions
- **Float `sortOrder`/`position`** like Linear: reorder by averaging neighbours, no mass renumbering.
- **Per-team workflow states**, with a fixed set of *types* so agents and the router can reason on types, not names.
- **Agents are actors** on comments and history (`actor_kind: human | agent`, `agent_id`, `run_id`).
- **The local board is the source of truth.** The Linear provider (prompt 16) only mirrors it.
- Optional later: Linear's `AgentSession` concept is worth reading before designing run ↔ ticket linking.

## Not copying
UI assets, icons, copy, keyboard-shortcut maps as a product clone, or anything from the Linear web bundle.

## Status
Implementado no prompt 16: `IssueLabel` → `labels`, `IssueRelation` → `ticket_relations`, `Cycle` → `cycles`, `estimate` e `dueDate` em `tickets`. Ainda não: estados de workflow por equipe, `triage`, `duplicate` como estado, histórico de escopo do ciclo.
