import type { ReactNode } from 'react';
/**
 * Um passo na linha do tempo da run (pensamento, chamada de ferramenta). Tempo na margem, como log de voo.
 * @startingPoint section="OWL" subtitle="Linha do tempo de execução" viewport="700x380"
 */
export interface RunStepProps {
  /** Relativo ao início, ex. "00:21" */
  time: string;
  /** Ferramenta ou "pensamento" */
  name: string;
  detail?: string;
  duration?: string;
  status?: 'done' | 'running' | 'think' | 'failed' | 'waiting';
  expanded?: boolean;
  onToggle?: () => void;
  last?: boolean;
  /** Entrada/saída em mono, mostrada quando expandido */
  children?: ReactNode;
}
export declare function RunStep(props: RunStepProps): JSX.Element;
