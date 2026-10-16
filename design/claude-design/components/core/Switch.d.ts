/** Liga/desliga. Quadrado (raio 4), não pílula. */
export interface SwitchProps { checked: boolean; onChange?: (v: boolean) => void; label?: string; disabled?: boolean }
export declare function Switch(props: SwitchProps): JSX.Element;
