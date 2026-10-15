import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export interface Team {
  id: string;
  projectId: string;
  nome: string;
}

export interface TeamMember {
  teamId: string;
  agentId: string;
  /** Library name of the agent (joined from `agents`). */
  agente: string;
  /** Role inside this team: the same agent may be a manager in one team and a reviewer in another. */
  papel: string | null;
}

const TEAM = 'id, project_id AS projectId, nome';
const MEMBER = `m.team_id AS teamId, m.agent_id AS agentId, a.nome AS agente, m.papel
  FROM team_members m JOIN agents a ON a.id = m.agent_id`;

/** Teams of a project and who is on them. Membership is per team; memory and tickets are per project. */
export function teamsRepo(db: Db) {
  const get = (id: string) => db.prepare(`SELECT ${TEAM} FROM teams WHERE id = ?`).get(id) as Team | undefined;
  const members = (teamId: string) =>
    db.prepare(`SELECT ${MEMBER} WHERE m.team_id = ? ORDER BY a.nome`).all(teamId) as TeamMember[];
  return {
    get,
    members,
    create(input: { projectId: string; nome: string }): Team {
      const id = randomUUID();
      db.prepare('INSERT INTO teams (id, project_id, nome) VALUES (?, ?, ?)').run(id, input.projectId, input.nome);
      return get(id)!;
    },
    rename(id: string, nome: string): Team | undefined {
      db.prepare('UPDATE teams SET nome = ? WHERE id = ?').run(nome, id);
      return get(id);
    },
    delete(id: string): void {
      db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    },
    byProject(projectId: string): Array<Team & { membros: TeamMember[] }> {
      const teams = db.prepare(`SELECT ${TEAM} FROM teams WHERE project_id = ? ORDER BY nome`).all(projectId) as Team[];
      return teams.map((t) => ({ ...t, membros: members(t.id) }));
    },
    /** Adds the agent, or changes its role when it is already on the team. */
    setMember(input: { teamId: string; agentId: string; papel?: string | null }): void {
      db.prepare(
        `INSERT INTO team_members (team_id, agent_id, papel) VALUES (?, ?, ?)
         ON CONFLICT(team_id, agent_id) DO UPDATE SET papel = excluded.papel`,
      ).run(input.teamId, input.agentId, input.papel ?? null);
    },
    removeMember(teamId: string, agentId: string): boolean {
      return db.prepare('DELETE FROM team_members WHERE team_id = ? AND agent_id = ?').run(teamId, agentId).changes === 1;
    },
    /** Every membership of an agent inside a project (it can be on several teams of the same project). */
    membershipsInProject(projectId: string, agentId: string): TeamMember[] {
      return db
        .prepare(`SELECT ${MEMBER} JOIN teams t ON t.id = m.team_id WHERE t.project_id = ? AND m.agent_id = ?`)
        .all(projectId, agentId) as TeamMember[];
    },
    /** True when the project has at least one team with at least one member: from then on the team decides who may work. */
    hasRoster(projectId: string): boolean {
      return (
        db
          .prepare('SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.project_id = ? LIMIT 1')
          .get(projectId) !== undefined
      );
    },
    /** Projects an agent works in, with the team and role: the "one manager, two projects" view. */
    projectsOfAgent(agentId: string): Array<{ projectId: string; projeto: string; teamId: string; equipe: string; papel: string | null }> {
      return db
        .prepare(
          `SELECT p.id AS projectId, p.nome AS projeto, t.id AS teamId, t.nome AS equipe, m.papel AS papel
           FROM team_members m JOIN teams t ON t.id = m.team_id JOIN projects p ON p.id = t.project_id
           WHERE m.agent_id = ? ORDER BY p.nome, t.nome`,
        )
        .all(agentId) as Array<{ projectId: string; projeto: string; teamId: string; equipe: string; papel: string | null }>;
    },
  };
}
