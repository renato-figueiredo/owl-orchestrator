-- 0005_runs_memoria_chamadas: which memory tools (MCP) the model called during a run, as JSON {"buscar_memoria": 2}.
ALTER TABLE runs ADD COLUMN memoria_chamadas TEXT;
