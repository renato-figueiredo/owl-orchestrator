import { TICKET_STATUSES, type GateKind, type TicketStatus } from '@owl/db';

export { TICKET_STATUSES };

/**
 * Moves an AGENT may make by itself (docs/04-agents-and-board/agents-teams-board.md). A human may move a ticket
 * anywhere (the board is theirs); agents may not, and `aguardando_aprovacao` / `concluido` are left only through a
 * decision, never by an agent's own say-so.
 */
export const AGENT_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  backlog: ['pronto', 'bloqueado'],
  pronto: ['em_andamento', 'backlog', 'bloqueado'],
  em_andamento: ['em_revisao', 'pronto', 'bloqueado', 'aguardando_aprovacao'],
  em_revisao: ['em_andamento', 'aguardando_aprovacao', 'concluido', 'bloqueado'],
  aguardando_aprovacao: [],
  bloqueado: ['backlog', 'pronto', 'em_andamento'],
  concluido: [],
};

export const canAgentMove = (from: TicketStatus, to: TicketStatus): boolean => AGENT_TRANSITIONS[from].includes(to);

export const GATE_LABEL: Record<GateKind, string> = {
  entrega: 'Entrega aguardando aprovação',
  custo: 'Custo acima do teto do ticket',
  destrutiva: 'Ação destrutiva',
  reprovacao: 'Reprovação do revisor',
  confianca: 'Baixa confiança do roteador',
  permissao: 'Pedido de permissão',
  pergunta: 'Pergunta do agente',
};

export { isDestructive } from '@owl/core';
