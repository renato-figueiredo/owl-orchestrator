import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export const TICKET_STATUSES = [
  'backlog',
  'pronto',
  'em_andamento',
  'em_revisao',
  'aguardando_aprovacao',
  'concluido',
  'bloqueado',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type ActorKind = 'humano' | 'agente' | 'sistema';
export interface Actor {
  /** Agent name, or 'humano' / 'sistema'. */
  nome: string;
  tipo: ActorKind;
}

export interface Ticket {
  id: string;
  projectId: string;
  parentId: string | null;
  /** Per-project counter: with the project prefix it forms the identifier (OWL-12). */
  numero: number;
  identificador: string;
  titulo: string;
  descricao: string | null;
  criteriosAceite: string | null;
  status: TicketStatus;
  responsavelAgentId: string | null;
  /** Library name of the assignee (joined from `agents`), for display. */
  responsavel: string | null;
  prioridade: number;
  ordem: number;
  orcamentoTokens: number | null;
  requerAprovacao: boolean;
  resumo: string | null;
  sessionId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  concluidoEm: string | null;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  autor: string;
  autorTipo: ActorKind;
  texto: string;
  runId: string | null;
  criadoEm: string;
}

export interface TicketEvent {
  id: number;
  ticketId: string;
  autor: string;
  autorTipo: ActorKind;
  tipo: 'criado' | 'status' | 'atribuido' | 'comentario' | 'aprovacao' | 'execucao';
  de: string | null;
  para: string | null;
  detalhe: string | null;
  runId: string | null;
  criadoEm: string;
}

export interface TicketUsage {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  custoEstimado: number;
}

interface Row extends Omit<Ticket, 'requerAprovacao' | 'identificador'> {
  requerAprovacao: number;
  prefixo: string | null;
  projetoNome: string;
}

const SELECT = `SELECT t.id, t.project_id AS projectId, t.parent_id AS parentId, t.numero, t.titulo, t.descricao,
  t.criterios_aceite AS criteriosAceite, t.status, t.responsavel_agent_id AS responsavelAgentId, a.nome AS responsavel,
  t.prioridade, t.ordem, t.orcamento_tokens AS orcamentoTokens, t.requer_aprovacao AS requerAprovacao, t.resumo,
  t.session_id AS sessionId, t.criado_em AS criadoEm, t.atualizado_em AS atualizadoEm, t.concluido_em AS concluidoEm,
  p.prefixo AS prefixo, p.nome AS projetoNome
  FROM tickets t JOIN projects p ON p.id = t.project_id LEFT JOIN agents a ON a.id = t.responsavel_agent_id`;

/** "OWL" for "Owl Orchestrator", "MEU" for "Meu app"... letters only, 2–4 of them. */
export function defaultPrefix(nome: string): string {
  const letters = nome.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'TKT').padEnd(2, 'X');
}

function toTicket(r: Row): Ticket {
  const { prefixo, projetoNome, requerAprovacao, ...rest } = r;
  return { ...rest, requerAprovacao: requerAprovacao === 1, identificador: `${prefixo ?? defaultPrefix(projetoNome)}-${r.numero}` };
}

export interface NewTicket {
  projectId: string;
  titulo: string;
  descricao?: string;
  criteriosAceite?: string;
  parentId?: string;
  status?: TicketStatus;
  responsavelAgentId?: string;
  prioridade?: number;
  orcamentoTokens?: number;
  requerAprovacao?: boolean;
}

export function ticketsRepo(db: Db) {
  const get = (id: string) => {
    const r = db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
    return r && toTicket(r);
  };
  const touch = (id: string) => db.prepare("UPDATE tickets SET atualizado_em = datetime('now') WHERE id = ?").run(id);
  const addEvent = (e: {
    ticketId: string;
    ator: Actor;
    tipo: TicketEvent['tipo'];
    de?: string | null;
    para?: string | null;
    detalhe?: string | null;
    runId?: string | null;
  }) => {
    db.prepare(
      'INSERT INTO ticket_events (ticket_id, autor, autor_tipo, tipo, de, para, detalhe, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(e.ticketId, e.ator.nome, e.ator.tipo, e.tipo, e.de ?? null, e.para ?? null, e.detalhe ?? null, e.runId ?? null);
  };
  /** Order value that puts a new ticket at the end of its column. */
  const lastOrder = (projectId: string, status: string): number =>
    (db.prepare('SELECT COALESCE(MAX(ordem), 0) AS m FROM tickets WHERE project_id = ? AND status = ?').get(projectId, status) as { m: number }).m;

  return {
    get,
    addEvent,
    create(input: NewTicket, ator: Actor): Ticket {
      const id = randomUUID();
      const status = input.status ?? 'backlog';
      db.transaction(() => {
        const numero =
          (db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM tickets WHERE project_id = ?').get(input.projectId) as { n: number }).n;
        db.prepare(
          `INSERT INTO tickets (id, project_id, parent_id, titulo, descricao, criterios_aceite, status, responsavel_agent_id,
             prioridade, orcamento_tokens, requer_aprovacao, numero, ordem)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.projectId,
          input.parentId ?? null,
          input.titulo,
          input.descricao ?? null,
          input.criteriosAceite ?? null,
          status,
          input.responsavelAgentId ?? null,
          input.prioridade ?? 0,
          input.orcamentoTokens ?? null,
          input.requerAprovacao ? 1 : 0,
          numero,
          lastOrder(input.projectId, status) + 1,
        );
        addEvent({ ticketId: id, ator, tipo: 'criado', para: status });
      })();
      return get(id)!;
    },
    list(projectId: string, filtro: { status?: TicketStatus; parentId?: string | null; responsavelAgentId?: string } = {}): Ticket[] {
      const rows = db
        .prepare(
          `${SELECT} WHERE t.project_id = @projectId
             AND (@status IS NULL OR t.status = @status)
             AND (@useParent = 0 OR t.parent_id IS @parentId)
             AND (@resp IS NULL OR t.responsavel_agent_id = @resp)
           ORDER BY t.ordem, t.numero`,
        )
        .all({
          projectId,
          status: filtro.status ?? null,
          useParent: filtro.parentId === undefined ? 0 : 1,
          parentId: filtro.parentId ?? null,
          resp: filtro.responsavelAgentId ?? null,
        }) as Row[];
      return rows.map(toTicket);
    },
    children: (id: string): Ticket[] =>
      (db.prepare(`${SELECT} WHERE t.parent_id = ? ORDER BY t.ordem, t.numero`).all(id) as Row[]).map(toTicket),
    /** Edits plain fields (never the status: that goes through `setStatus` and its rules). */
    update(
      id: string,
      changes: { titulo?: string; descricao?: string | null; criteriosAceite?: string | null; prioridade?: number; orcamentoTokens?: number | null; requerAprovacao?: boolean; resumo?: string | null },
    ): void {
      const sets: string[] = [];
      const values: unknown[] = [];
      const put = (col: string, v: unknown) => {
        sets.push(`${col} = ?`);
        values.push(v);
      };
      if (changes.titulo !== undefined) put('titulo', changes.titulo);
      if (changes.descricao !== undefined) put('descricao', changes.descricao);
      if (changes.criteriosAceite !== undefined) put('criterios_aceite', changes.criteriosAceite);
      if (changes.prioridade !== undefined) put('prioridade', changes.prioridade);
      if (changes.orcamentoTokens !== undefined) put('orcamento_tokens', changes.orcamentoTokens);
      if (changes.requerAprovacao !== undefined) put('requer_aprovacao', changes.requerAprovacao ? 1 : 0);
      if (changes.resumo !== undefined) put('resumo', changes.resumo);
      if (sets.length === 0) return;
      db.prepare(`UPDATE tickets SET ${sets.join(', ')}, atualizado_em = datetime('now') WHERE id = ?`).run(...values, id);
    },
    /** Moves a ticket to a column. `ordem` places it; by default it goes to the end. */
    setStatus(id: string, status: TicketStatus, ordem?: number): void {
      const t = get(id);
      if (!t) return;
      const o = ordem ?? lastOrder(t.projectId, status) + 1;
      db.prepare(
        `UPDATE tickets SET status = ?, ordem = ?, atualizado_em = datetime('now'),
           concluido_em = CASE WHEN ? = 'concluido' THEN datetime('now') ELSE NULL END WHERE id = ?`,
      ).run(status, o, status, id);
    },
    setOrder(id: string, ordem: number): void {
      db.prepare('UPDATE tickets SET ordem = ? WHERE id = ?').run(ordem, id);
    },
    setAssignee(id: string, agentId: string | null): void {
      db.prepare("UPDATE tickets SET responsavel_agent_id = ?, atualizado_em = datetime('now') WHERE id = ?").run(agentId, id);
    },
    setSession(id: string, sessionId: string): void {
      db.prepare('UPDATE tickets SET session_id = ? WHERE id = ?').run(sessionId, id);
    },
    addComment(input: { ticketId: string; ator: Actor; texto: string; runId?: string }): TicketComment {
      const id = randomUUID();
      db.transaction(() => {
        db.prepare('INSERT INTO ticket_comments (id, ticket_id, autor, autor_tipo, texto, run_id) VALUES (?, ?, ?, ?, ?, ?)').run(
          id,
          input.ticketId,
          input.ator.nome,
          input.ator.tipo,
          input.texto,
          input.runId ?? null,
        );
        addEvent({ ticketId: input.ticketId, ator: input.ator, tipo: 'comentario', runId: input.runId ?? null });
        touch(input.ticketId);
      })();
      return db
        .prepare(
          `SELECT id, ticket_id AS ticketId, autor, autor_tipo AS autorTipo, texto, run_id AS runId, criado_em AS criadoEm
           FROM ticket_comments WHERE id = ?`,
        )
        .get(id) as TicketComment;
    },
    comments: (ticketId: string): TicketComment[] =>
      db
        .prepare(
          `SELECT id, ticket_id AS ticketId, autor, autor_tipo AS autorTipo, texto, run_id AS runId, criado_em AS criadoEm
           FROM ticket_comments WHERE ticket_id = ? ORDER BY rowid`,
        )
        .all(ticketId) as TicketComment[],
    events: (ticketId: string): TicketEvent[] =>
      db
        .prepare(
          `SELECT id, ticket_id AS ticketId, autor, autor_tipo AS autorTipo, tipo, de, para, detalhe, run_id AS runId, criado_em AS criadoEm
           FROM ticket_events WHERE ticket_id = ? ORDER BY id`,
        )
        .all(ticketId) as TicketEvent[],
    /** Tokens and cost of every run linked to the ticket (what "how much did this cost" adds up). */
    usage(ticketId: string): TicketUsage {
      return db
        .prepare(
          `SELECT COUNT(*) AS runs, COALESCE(SUM(tokens_in), 0) AS tokensIn, COALESCE(SUM(tokens_out), 0) AS tokensOut,
                  COALESCE(SUM(custo_estimado), 0) AS custoEstimado
           FROM runs WHERE ticket_id = ?`,
        )
        .get(ticketId) as TicketUsage;
    },
    runs: (ticketId: string) =>
      db
        .prepare(
          `SELECT r.id, a.nome AS agente, r.etapa, r.provedor, r.modelo, r.status, r.tokens_in AS tokensIn,
                  r.tokens_out AS tokensOut, r.custo_estimado AS custoEstimado, r.inicio, r.fim, r.erro
           FROM runs r LEFT JOIN agents a ON a.id = r.agent_id WHERE r.ticket_id = ? ORDER BY r.inicio, r.rowid`,
        )
        .all(ticketId) as Array<{
        id: string;
        agente: string | null;
        etapa: string | null;
        provedor: string;
        modelo: string | null;
        status: string;
        tokensIn: number | null;
        tokensOut: number | null;
        custoEstimado: number | null;
        inicio: string;
        fim: string | null;
        erro: string | null;
      }>,
    delete(id: string): void {
      db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
    },
  };
}
