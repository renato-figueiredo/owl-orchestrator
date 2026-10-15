-- 0008_board: local board (prompt 13). Shape borrowed from Linear's public schema (docs/04-agents-and-board/linear-model-notes.md).
-- Tickets get a per-project number (OWL-12 style identifier), a float sort order for drag & drop, a priority, a rolling
-- summary and the hidden conversation their agent runs live in. The history and the gates are new tables/columns.

ALTER TABLE projects ADD COLUMN prefixo TEXT;

ALTER TABLE tickets ADD COLUMN numero INTEGER;
ALTER TABLE tickets ADD COLUMN prioridade INTEGER NOT NULL DEFAULT 0;      -- 0 none .. 4 urgent
ALTER TABLE tickets ADD COLUMN ordem REAL NOT NULL DEFAULT 0;              -- float sortOrder inside a column
ALTER TABLE tickets ADD COLUMN resumo TEXT;                                -- written by the memory agent on close
ALTER TABLE tickets ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN concluido_em TEXT;

ALTER TABLE ticket_comments ADD COLUMN autor_tipo TEXT NOT NULL DEFAULT 'humano';  -- humano | agente | sistema
ALTER TABLE ticket_comments ADD COLUMN run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;

-- Who did what, in order. Cost is not stored here: it is the sum of the runs linked to the ticket.
CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor TEXT NOT NULL,                      -- agent name or 'humano' or 'sistema'
  autor_tipo TEXT NOT NULL,                 -- humano | agente | sistema
  tipo TEXT NOT NULL,                       -- criado | status | atribuido | comentario | aprovacao | execucao
  de TEXT, para TEXT, detalhe TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gates: kind, and what to do when it is approved (agent to resume, status to return to), as JSON.
ALTER TABLE approvals ADD COLUMN tipo TEXT;                -- entrega | custo | destrutiva | reprovacao | confianca
ALTER TABLE approvals ADD COLUMN retomar_json TEXT;
ALTER TABLE approvals ADD COLUMN criado_em TEXT;

CREATE UNIQUE INDEX idx_tickets_numero ON tickets(project_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX idx_tickets_parent ON tickets(parent_id);
CREATE INDEX idx_events_ticket ON ticket_events(ticket_id, id);
CREATE INDEX idx_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX idx_approvals_ticket ON approvals(ticket_id, status);
