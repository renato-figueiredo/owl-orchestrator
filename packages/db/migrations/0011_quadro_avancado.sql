-- 0011_quadro_avancado (prompt 16): labels, relations, cycles, estimate and due date. Shape from Linear's public schema
-- (IssueLabel, IssueRelation, Cycle); everything is local and per project.
CREATE TABLE cycles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  nome TEXT,
  inicio TEXT NOT NULL,          -- YYYY-MM-DD
  fim TEXT NOT NULL,             -- YYYY-MM-DD
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, numero)
);

ALTER TABLE tickets ADD COLUMN estimativa INTEGER;        -- points, NULL = not estimated
ALTER TABLE tickets ADD COLUMN prazo TEXT;                -- YYYY-MM-DD
ALTER TABLE tickets ADD COLUMN cycle_id TEXT REFERENCES cycles(id) ON DELETE SET NULL;

CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT '#8b8b99',
  UNIQUE (project_id, nome)
);
CREATE TABLE ticket_labels (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, label_id)
);

-- `ticket_id` blocks / duplicates / relates to `related_id`. A "related" pair is stored once, in either direction.
CREATE TABLE ticket_relations (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  related_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,            -- bloqueia | relacionado | duplicado
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ticket_id, related_id, tipo),
  CHECK (ticket_id <> related_id)
);
CREATE INDEX idx_relations_related ON ticket_relations(related_id);
CREATE INDEX idx_ticket_labels_label ON ticket_labels(label_id);
CREATE INDEX idx_tickets_cycle ON tickets(cycle_id);
