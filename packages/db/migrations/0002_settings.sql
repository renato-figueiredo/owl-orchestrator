-- 0002_settings: key/value application settings (JSON), e.g. memory limits and the summarizer provider.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
