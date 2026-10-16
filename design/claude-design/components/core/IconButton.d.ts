/** Botão só-ícone (trilho, barras de ferramenta). Sempre com label acessível. */
export interface IconButtonProps {
  /** Nome Lucide sem prefixo */
  icon: string;
  label: string;
  active?: boolean;
  /** 40 no trilho; 28–32 em barras */
  size?: number;
  disabled?: boolean;
  /** Contador âmbar (ex. aprovações pendentes) */
  badge?: number | string;
  onClick?: () => void;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
