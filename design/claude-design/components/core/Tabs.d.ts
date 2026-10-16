/** Controle segmentado (troca de visão: Quadro/Lista, Execução/Memória). */
export interface TabsProps {
  items: Array<string | { value: string; label: string }>;
  value: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
}
export declare function Tabs(props: TabsProps): JSX.Element;
