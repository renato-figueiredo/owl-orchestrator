/**
 * Status de execução: forma + texto, nunca só cor.
 * @startingPoint section="Status" subtitle="Pílula de status de run" viewport="700x200"
 */
export interface StatusPillProps {
  status: 'running' | 'waiting' | 'queued' | 'failed' | 'done' | 'cancelled';
  /** Sobrescreve o rótulo padrão pt-BR */
  label?: string;
  /** Duração mono, ex. "01:12" */
  time?: string;
  /** Sem fundo, para linhas densas */
  bare?: boolean;
}
export declare function StatusPill(props: StatusPillProps): JSX.Element;
