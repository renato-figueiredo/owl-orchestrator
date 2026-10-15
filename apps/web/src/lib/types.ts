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
  /** Most runs of this project at once; null = the server default. */
  maxConcorrencia?: number | null;
  branchBase?: string | null;
}
export interface TeamMember {
  agentId: string;
  agente: string;
  papel: string | null;
}
export interface Team {
  id: string;
  projectId: string;
  nome: string;
  membros: TeamMember[];
}
export interface ProjectView {
  project: Project;
  instrucoes: string | null;
  git: boolean;
  branchAtual: string | null;
  branchBase: string | null;
  concorrencia: { projeto: number; padraoDoServidor: number; global: number; emExecucao: number };
  equipes: Team[];
}
export interface AgentProject {
  projectId: string;
  projeto: string;
  teamId: string;
  equipe: string;
  papel: string | null;
}
export interface AgentFact {
  id: string;
  texto: string;
  fixado: boolean;
}
export interface BranchInfo {
  branch: string | null;
  worktree: string | null;
  estado: 'ativo' | 'removido' | 'mesclado' | 'descartado' | null;
  base: string | null;
  commitsAdiante: number | null;
  alterado: boolean;
}
export interface Session {
  id: string;
  projectId: string | null;
  titulo: string | null;
  criadoEm: string;
  /** The CLI that owns the conversation's native session (null until the first run finishes). */
  cliProvider?: string | null;
  resumo?: string | null;
  resumoAnterior?: string | null;
  resumoAteMessageId?: number | null;
}
export interface Fact {
  id: string;
  projectId: string | null;
  texto: string;
  fixado: boolean;
}
export interface MemorySettings {
  ultimasN: number;
  resumirACada: number;
  orcamentoTokens: number;
  resumoAutomatico: boolean;
  trechosFts: boolean;
  mcpMemoria: boolean;
  resumidor: { provider: string; model?: string };
}
export type SummarizeResult =
  | { ok: true; runId: string; resumo: string; fatosNovos: number }
  | { ok: false; runId?: string; error: string; code: 'nothing_to_summarize' | 'invalid_output' | 'run_failed' };
export interface Message {
  id: number;
  sessionId: string;
  runId: string | null;
  papel: 'usuario' | 'assistente' | 'sistema' | 'agente';
  conteudo: string;
  criadoEm: string;
  /** Images attached to a user message. */
  anexos?: Attachment[];
}
export interface Attachment {
  hash: string;
  nome: string | null;
  largura: number | null;
  altura: number | null;
  /** Path on the API (`/attachments/<hash>`); prefix it with `API`. */
  url: string;
}
export interface Run {
  id: string;
  etapa: string | null;
  parentRunId: string | null;
  provedor: string;
  modelo: string | null;
  status: RunStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  custoEstimado: number | null;
  inicio: string;
  fim: string | null;
  erro: string | null;
  /** Memory tools the model called (MCP), by name. */
  memoriaChamadas?: Record<string, number> | null;
}
export interface ProviderInfo {
  id: string;
  available: boolean;
}
export interface Approval {
  id: string;
  runId: string;
  motivo: string;
}
export interface RefinerInfo {
  provedor: string;
  modelo: string | null;
  fallback: Array<{ provedor: string; modelo?: string }>;
}
export interface SessionDetail {
  session: Session;
  messages: Message[];
  runs: Run[];
  approvals: Approval[];
}
export interface TrashSettings {
  diasRetencao: number;
  purgaAutomatica: boolean;
}
export interface BackupSettings {
  ativo: boolean;
  retencao: number;
  intervaloHoras: number;
}
export interface BackupStatus {
  em: string;
  ok: boolean;
  arquivo?: string;
  criptografado?: boolean;
  enviado?: boolean;
  erro?: string;
}
export interface BackupFile {
  nome: string;
  bytes: number;
  criptografado: boolean;
  em: string;
}
export interface BackupInfo {
  settings: BackupSettings;
  destinos: { criptografia: boolean; envio: boolean };
  ultimo: BackupStatus | null;
  arquivos: BackupFile[];
}
export interface PurgeResult {
  sessionId: string;
  blobsRemoved: number;
  /** The conversation had a native CLI session whose transcript stays in the CLI's own folder. */
  cliSession?: { provider: string; id: string };
}
export interface SweepReport {
  orphanBlobs: number;
  strayFiles: number;
  missingFiles: number;
  freedPages: number;
}

export interface AgentSummary {
  nome: string;
  descricao: string | null;
  papel: string | null;
  provedor: string;
  modelo: string | null;
  ferramentas: string[];
  skills: string[];
  podeAprovar: boolean;
  /** `usuario`: the user's own file (editable); `exemplo`: bundled with OWL (edit or delete creates/removes an override). */
  origem: 'usuario' | 'exemplo';
  /** A bundled agent with the same name is hidden behind this one. */
  sobrescreve: boolean;
}

export interface LibraryProblem {
  arquivo: string;
  origem: 'usuario' | 'exemplo';
  erro: string;
}

export interface AgentLibrary {
  agents: AgentSummary[];
  problemas: LibraryProblem[];
}

// ---- Board (prompt 13) ----
export const TICKET_STATUSES = ['backlog', 'pronto', 'em_andamento', 'em_revisao', 'aguardando_aprovacao', 'concluido', 'bloqueado'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TicketUsage {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  custoEstimado: number;
}
export interface Ticket {
  id: string;
  projectId: string;
  parentId: string | null;
  identificador: string;
  titulo: string;
  descricao: string | null;
  criteriosAceite: string | null;
  status: TicketStatus;
  responsavel: string | null;
  prioridade: number;
  ordem: number;
  orcamentoTokens: number | null;
  requerAprovacao: boolean;
  resumo: string | null;
  uso?: TicketUsage;
}
export type GateKind = 'entrega' | 'custo' | 'destrutiva' | 'reprovacao' | 'confianca';
export interface TicketApproval {
  id: string;
  ticketId: string;
  motivo: string;
  tipo: GateKind | null;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  comentario: string | null;
  criadoEm: string | null;
  ticketIdentificador?: string;
  ticketTitulo?: string;
}
export interface BoardData {
  estados: TicketStatus[];
  tickets: Ticket[];
  aprovacoes: TicketApproval[];
}
export interface TicketComment {
  id: string;
  autor: string;
  autorTipo: 'humano' | 'agente' | 'sistema';
  texto: string;
  criadoEm: string;
}
export interface TicketEvent {
  id: number;
  autor: string;
  autorTipo: 'humano' | 'agente' | 'sistema';
  tipo: 'criado' | 'status' | 'atribuido' | 'comentario' | 'aprovacao' | 'execucao';
  de: string | null;
  para: string | null;
  detalhe: string | null;
  criadoEm: string;
}
export interface TicketRun {
  id: string;
  agente: string | null;
  etapa: string | null;
  provedor: string;
  modelo: string | null;
  status: string;
  tokensIn: number | null;
  tokensOut: number | null;
  custoEstimado: number | null;
  erro: string | null;
}
export interface TicketDetail {
  ticket: Ticket;
  parent: Ticket | null;
  children: Ticket[];
  comments: TicketComment[];
  events: TicketEvent[];
  runs: TicketRun[];
  uso: TicketUsage;
  aprovacoes: TicketApproval[];
  branch?: BranchInfo | null;
}
