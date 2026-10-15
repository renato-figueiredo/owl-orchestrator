// Mirrors the server's JSON. Kept local: the web app must not import Node-only packages.
export type RunEvent =
  | { type: 'start'; runId: string; provider: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input?: unknown }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'end'; result?: string; cliSessionId?: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export type RunStatus = 'rodando' | 'ok' | 'erro' | 'cancelado';

export interface Project {
  id: string;
  nome: string;
  pasta: string;
}
export interface Session {
  id: string;
  projectId: string | null;
  titulo: string | null;
  criadoEm: string;
}
export interface Message {
  id: number;
  sessionId: string;
  runId: string | null;
  papel: 'usuario' | 'assistente' | 'sistema' | 'agente';
  conteudo: string;
  criadoEm: string;
}
export interface Run {
  id: string;
  provedor: string;
  modelo: string | null;
  status: RunStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  custoEstimado: number | null;
  inicio: string;
  fim: string | null;
  erro: string | null;
}
export interface ProviderInfo {
  id: string;
  available: boolean;
}
export interface SessionDetail {
  session: Session;
  messages: Message[];
  runs: Run[];
}
