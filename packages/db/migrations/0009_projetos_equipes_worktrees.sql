-- 0009_projetos_equipes_worktrees (prompt 14): per-project concurrency, teams used by the board, one git worktree per
-- development ticket. Teams and team_members already exist (0001); this only constrains and extends them.

ALTER TABLE projects ADD COLUMN max_concorrencia INTEGER;   -- NULL = the server default (OWL_PROJECT_CONCURRENCY)
ALTER TABLE projects ADD COLUMN branch_base TEXT;            -- branch the ticket branches start from and merge into; NULL = the folder's current branch

-- A team name is unique inside its project (two projects may both have a "Core" team).
CREATE UNIQUE INDEX idx_teams_nome ON teams(project_id, nome);
CREATE INDEX idx_team_members_agent ON team_members(agent_id);

-- Isolation: a development ticket works on its own branch, in its own folder. `worktree` is an absolute path inside the
-- OWL data folder and is NULL once removed; the branch stays until the work is merged or discarded (both need approval).
ALTER TABLE tickets ADD COLUMN branch TEXT;
ALTER TABLE tickets ADD COLUMN worktree TEXT;
ALTER TABLE tickets ADD COLUMN worktree_estado TEXT;         -- ativo | removido | mesclado | descartado
CREATE UNIQUE INDEX idx_tickets_branch ON tickets(project_id, branch) WHERE branch IS NOT NULL;

-- Memory of an agent inside a project (facts.agent_id already exists): look it up by (project, agent).
CREATE INDEX idx_facts_project_agent ON facts(project_id, agent_id);
