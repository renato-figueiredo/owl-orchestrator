-- 0001_initial: full schema (phase 1 + phase 2 structure). Source of truth: docs/03-data/database.md
-- auto_vacuum=INCREMENTAL is applied by openDb() before the first table exists (see src/connection.ts).

CREATE TABLE projects (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, pasta TEXT NOT NULL,
  config_json TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Biblioteca global de agentes (fonte da verdade são os arquivos; tabela é índice)
CREATE TABLE agents (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE, papel TEXT,
  provedor TEXT, modelo TEXT, arquivo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nome TEXT NOT NULL
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  papel TEXT,
  PRIMARY KEY (team_id, agent_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  titulo TEXT, resumo TEXT, resumo_anterior TEXT,
  resumo_ate_message_id INTEGER,
  cli_provider TEXT, cli_session_id TEXT,
  deleted_at TEXT,                         -- lixeira
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, descricao TEXT, criterios_aceite TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  responsavel_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  orcamento_tokens INTEGER,
  requer_aprovacao INTEGER NOT NULL DEFAULT 0,
  externo_provider TEXT, externo_id TEXT,  -- ex.: linear
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  parent_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  provedor TEXT NOT NULL, modelo TEXT, etapa TEXT,
  status TEXT NOT NULL,                    -- rodando | ok | erro | cancelado
  tokens_in INTEGER, tokens_out INTEGER, custo_estimado REAL,
  complexidade TEXT,                       -- do roteador
  inicio TEXT NOT NULL DEFAULT (datetime('now')), fim TEXT, erro TEXT
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  papel TEXT NOT NULL,                     -- usuario | assistente | sistema | agente
  conteudo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  conteudo, content='messages', content_rowid='id'
);
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, conteudo) VALUES (new.id, new.conteudo);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, conteudo) VALUES ('delete', old.id, old.conteudo);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, conteudo) VALUES ('delete', old.id, old.conteudo);
  INSERT INTO messages_fts(rowid, conteudo) VALUES (new.id, new.conteudo);
END;

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,  -- NULL = do projeto
  texto TEXT NOT NULL, fixado INTEGER NOT NULL DEFAULT 0,
  origem_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blobs (                       -- arquivos deduplicados
  hash TEXT PRIMARY KEY, caminho TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, largura INTEGER, altura INTEGER,
  descricao TEXT, ocr TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  blob_hash TEXT NOT NULL REFERENCES blobs(hash),
  nome_original TEXT
);

CREATE TABLE ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor TEXT NOT NULL,                     -- id do agente ou 'humano'
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  motivo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente | aprovado | rejeitado
  comentario TEXT, decidido_em TEXT
);

CREATE INDEX idx_messages_session ON messages(session_id, id);
CREATE INDEX idx_runs_session ON runs(session_id);
CREATE INDEX idx_runs_ticket ON runs(ticket_id);
CREATE INDEX idx_tickets_project_status ON tickets(project_id, status);
CREATE INDEX idx_attachments_blob ON attachments(blob_hash);
