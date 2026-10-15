import type { Project, ProviderInfo, RefinerInfo, Session, SessionDetail } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const API = '/api';

export interface SendInput {
  texto: string;
  provider: string;
  model?: string;
  melhorarPrompt?: boolean;
  editarAntes?: boolean;
  refinador?: { provider: string; model?: string };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  providers: () => call<{ providers: ProviderInfo[] }>('GET', '/providers').then((r) => r.providers),
  projects: () => call<{ projects: Project[] }>('GET', '/projects').then((r) => r.projects),
  createProject: (input: { nome: string; pasta: string; instrucoes?: string }) =>
    call<{ project: Project }>('POST', '/projects', input).then((r) => r.project),
  sessions: () => call<{ sessions: Session[] }>('GET', '/sessions').then((r) => r.sessions),
  createSession: (input: { projectId?: string; titulo?: string }) =>
    call<{ session: Session }>('POST', '/sessions', input).then((r) => r.session),
  session: (id: string) => call<SessionDetail>('GET', `/sessions/${encodeURIComponent(id)}`),
  send: (sessionId: string, input: SendInput) =>
    call<{ runId: string }>('POST', `/sessions/${encodeURIComponent(sessionId)}/messages`, input).then((r) => r.runId),
  refiner: () => call<RefinerInfo>('GET', '/refiner'),
  /** Approve a paused pipeline. `texto` is the user's edit of the refined prompt (omit to keep it). */
  continueRun: (runId: string, texto?: string) =>
    call<{ runId: string }>('POST', `/runs/${encodeURIComponent(runId)}/continue`, texto ? { texto } : {}).then((r) => r.runId),
  retryRun: (runId: string, via: { provider: string; model?: string }) =>
    call<{ runId: string }>('POST', `/runs/${encodeURIComponent(runId)}/retry`, via).then((r) => r.runId),
  discardRun: (runId: string) => call<{ status: string }>('POST', `/runs/${encodeURIComponent(runId)}/discard`),
  cancel: (runId: string) => call<{ status: string }>('POST', `/runs/${encodeURIComponent(runId)}/cancel`),
};
