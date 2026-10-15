import type { Project, ProviderInfo, Session, SessionDetail } from './types';

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
  send: (sessionId: string, input: { texto: string; provider: string; model?: string }) =>
    call<{ runId: string }>('POST', `/sessions/${encodeURIComponent(sessionId)}/messages`, input).then((r) => r.runId),
  cancel: (runId: string) => call<{ status: string }>('POST', `/runs/${encodeURIComponent(runId)}/cancel`),
};
