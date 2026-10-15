-- 0003_runs_sem_estado: marks runs that neither resume nor update the session's CLI conversation (summarizer, refiner),
-- so "what did the CLI already see" ignores them.
ALTER TABLE runs ADD COLUMN sem_estado INTEGER NOT NULL DEFAULT 0;
