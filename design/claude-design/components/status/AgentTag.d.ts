/** Agente com marcador discreto de provedor (6px). Nome de provedor só como dado. */
export interface AgentTagProps {
  name: string;
  provider?: 'claude-cli' | 'codex-cli' | 'ollama' | string;
  model?: string;
  running?: boolean;
  showProvider?: boolean;
}
export declare function AgentTag(props: AgentTagProps): JSX.Element;
