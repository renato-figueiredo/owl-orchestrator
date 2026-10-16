/** Campo de texto (input ou textarea), com contador e erro. */
export interface InputProps {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (e: any) => void;
}
export declare function Input(props: InputProps): JSX.Element;
