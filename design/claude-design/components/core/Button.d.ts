import type { ReactNode, ButtonHTMLAttributes } from 'react';
/**
 * Botão do OWL. Âmbar (primary) só para a ação principal da tela ou Aprovar.
 * @startingPoint section="Core" subtitle="Primário âmbar, secundário, fantasma, destrutivo" viewport="700x260"
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Nome Lucide sem prefixo, ex. "check" */
  icon?: string;
  /** Atalho exibido à direita, ex. "⌘A" */
  kbd?: string;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  children?: ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
