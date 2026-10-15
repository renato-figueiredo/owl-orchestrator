-- 0006_facts_sessao: a conversation with no project keeps its facts for itself (no project, no sharing).
-- Older facts without project and without session stay in the database but no conversation sees them.
ALTER TABLE facts ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;
CREATE INDEX facts_session ON facts(session_id);
