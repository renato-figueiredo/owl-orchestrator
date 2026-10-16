/**
 * Card de ticket do Quadro. Sem borda: a zona (Agentes/Você/Feito) dá o contexto.
 * @startingPoint section="OWL" subtitle="Ticket com agente, gate, bloqueio, falha" viewport="700x300"
 */
export interface TicketCardProps {
  /** Identificador mono, ex. "OWL-133" */
  id: string;
  title: string;
  priority?: 'P1' | 'P2' | 'P3';
  labels?: string[];
  agent?: string;
  provider?: string;
  running?: boolean;
  /** Progresso de subtickets, ex. "1/3" */
  subtasks?: string;
  /** Tipo do gate pendente, ex. "Push" */
  gate?: string;
  blockedBy?: string;
  failure?: string;
  onClick?: () => void;
}
export declare function TicketCard(props: TicketCardProps): JSX.Element;
