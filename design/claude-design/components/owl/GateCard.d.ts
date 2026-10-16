import type { ReactNode } from 'react';
/**
 * O componente de maior peso: uma ação perigosa esperando o humano. Pulso único ao chegar.
 * @startingPoint section="OWL" subtitle="Gate de aprovação (cheio e compacto)" viewport="700x420"
 */
export interface GateCardProps {
  kind: 'Push' | 'Merge' | 'Deploy' | 'Exclusão' | 'Custo' | string;
  ticket: string;
  title?: string;
  /** O que será executado, em mono */
  command: string;
  /** Resumo mono, ex. "3 commits · 6 arquivos · +182 −40" */
  stats?: string;
  requester?: string;
  provider?: string;
  risk?: 'baixo' | 'médio' | 'alto';
  status?: 'pendente' | 'aprovado' | 'rejeitado';
  comment?: string;
  /** Versão inline (ticket, quadro) */
  compact?: boolean;
  onApprove?: () => void;
  onReject?: (motivo: string) => void;
  /** Diff/alvos extras na versão cheia */
  children?: ReactNode;
}
export declare function GateCard(props: GateCardProps): JSX.Element;
