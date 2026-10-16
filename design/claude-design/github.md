repo: renato-figueiredo/owl-orchestrator
branch: main

## Last sync
date: 2026-10-16T14:26:36Z

### Updated in this project
- Tokens --c-* preservados; paleta trocada para navy + creme + âmbar
- Componentes core/status/owl e UI kit OWL App (Chat, Quadro, Ticket, Aprovações)
- Telas novas: Agentes, Pipelines, Memória, Métricas, Armazenamento, Pareamento, Estados

## Screen map
| Screen | Repo files |
|---|---|
| OWL App — Chat | apps/web/src/components/Chat.tsx, RunPanel.tsx, Sidebar.tsx |
| OWL App — Quadro | apps/web/src/components/Board.tsx, lib/types.ts |
| OWL App — Ticket | apps/web/src/components/Board.tsx, lib/types.ts (TicketDetail) |
| OWL App — Aprovações | apps/web/src/lib/types.ts (TicketApproval, GateKind) |
| OWL App — Agentes | apps/web/src/components/AgentLibrary.tsx, examples/agents/*.md |
| OWL App — Pipelines | examples/pipelines/refinar-executar-revisar.yaml |
| OWL App — Memória | apps/web/src/components/MemoryPanel.tsx |
| OWL App — Métricas | apps/web/src/components/MetricsPanel.tsx, lib/types.ts (Metrics) |
| OWL App — Armazenamento | apps/web/src/components/TrashPanel.tsx, StorageSettings.tsx |
| OWL App — Pareamento | apps/web/src/components/Pairing.tsx |
| tokens/colors.css | apps/web/src/index.css |
| components/* | packages/ui/src/primitives.tsx |
