-- 0010_roteador_metricas (prompt 15): what the router decided for each run, and the indexes the metrics panel reads.
-- `complexidade` (0001) keeps baixa|media|alta; `tier` is the tier the run used; `roteamento_json` is why
-- ({origem, motivo, confianca, falhas}), so a decision can be audited and the rules tuned from real data.
ALTER TABLE runs ADD COLUMN tier TEXT;                -- pequeno | medio | forte; NULL = the agent's own provider/model
ALTER TABLE runs ADD COLUMN roteamento_json TEXT;

CREATE INDEX idx_runs_inicio ON runs(inicio);
CREATE INDEX idx_runs_agent ON runs(agent_id);
