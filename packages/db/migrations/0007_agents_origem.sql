-- 0007_agents_origem: where an indexed agent comes from (the user's library or the examples bundled with OWL).
-- The files stay the source of truth; the table is an index that is rebuilt whenever the folders are read.
ALTER TABLE agents ADD COLUMN origem TEXT NOT NULL DEFAULT 'exemplo';
ALTER TABLE agents ADD COLUMN descricao TEXT;
ALTER TABLE agents ADD COLUMN atualizado_em TEXT;
