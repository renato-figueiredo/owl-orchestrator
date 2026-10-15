import type { BackupInfo, BackupSettings, BackupStatus, Fact, MemorySettings, PurgeResult, SweepReport, TrashSettings, Project, ProviderInfo, RefinerInfo, Session, SessionDetail, SummarizeResult } from './types';

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
  anexos?: Array<{ hash: string; nome?: string }>;
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

/** Sends one image as the raw request body; the server shrinks it and answers with its hash. */
async function uploadAttachment(file: File): Promise<{ hash: string; nome?: string; url: string }> {
  const res = await fetch(`${API}/attachments?nome=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Upload failed (${res.status})`);
  }
  return (data as { attachment: { hash: string; nome?: string; url: string } }).attachment;
}

export const api = {
  uploadAttachment,
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
  settings: () => call<{ memory: MemorySettings }>('GET', '/settings').then((r) => r.memory),
  saveSettings: (patch: Partial<MemorySettings>) =>
    call<{ memory: MemorySettings }>('PUT', '/settings', { memory: patch }).then((r) => r.memory),
  trash: () => call<{ sessions: Session[] }>('GET', '/sessions?trash=1').then((r) => r.sessions),
  trashSession: (id: string) => call<{ session: Session }>('DELETE', `/sessions/${encodeURIComponent(id)}`),
  restoreSession: (id: string) => call<{ session: Session }>('POST', `/sessions/${encodeURIComponent(id)}/restore`),
  /** Deletes a conversation that is in the trash for good. */
  purgeSession: (id: string) => call<{ result: PurgeResult }>('DELETE', `/trash/${encodeURIComponent(id)}`).then((r) => r.result),
  emptyTrash: () => call<{ result: { purged: number; skipped: number } }>('DELETE', '/trash?confirmar=1').then((r) => r.result),
  trashSettings: () => call<{ lixeira?: TrashSettings }>('GET', '/settings').then((r) => r.lixeira ?? null),
  saveTrashSettings: (patch: Partial<TrashSettings>) =>
    call<{ lixeira: TrashSettings }>('PUT', '/settings', { lixeira: patch }).then((r) => r.lixeira),
  sweep: () => call<{ report: SweepReport }>('POST', '/maintenance/sweep').then((r) => r.report),
  backups: () => call<BackupInfo>('GET', '/backups'),
  runBackup: () => call<{ status: BackupStatus }>('POST', '/backups').then((r) => r.status),
  saveBackupSettings: (patch: Partial<BackupSettings>) =>
    call<{ backup: BackupSettings }>('PUT', '/settings', { backup: patch }).then((r) => r.backup),
  facts: (projectId: string | null, sessionId?: string) =>
    call<{ facts: Fact[] }>(
      'GET',
      `/facts${projectId ? `?projectId=${encodeURIComponent(projectId)}` : sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`,
    ).then((r) => r.facts),
  addFact: (input: { texto: string; projectId?: string; sessionId?: string; fixado?: boolean }) =>
    call<{ fact: Fact }>('POST', '/facts', input).then((r) => r.fact),
  updateFact: (id: string, changes: { texto?: string; fixado?: boolean }) =>
    call<{ fact: Fact }>('PATCH', `/facts/${encodeURIComponent(id)}`, changes).then((r) => r.fact),
  deleteFact: (id: string) => call<{ status: string }>('DELETE', `/facts/${encodeURIComponent(id)}`),
  saveSummary: (sessionId: string, resumo: string) =>
    call<{ session: Session }>('PUT', `/sessions/${encodeURIComponent(sessionId)}/summary`, { resumo }),
  undoSummary: (sessionId: string) => call<{ session: Session }>('POST', `/sessions/${encodeURIComponent(sessionId)}/summary/undo`),
  /** Writes the summary now; resolves when it is done (a few seconds). */
  summarize: (sessionId: string) => call<SummarizeResult>('POST', `/sessions/${encodeURIComponent(sessionId)}/summarize`),
  refiner: () => call<RefinerInfo>('GET', '/refiner'),
  /** Approve a paused pipeline. `texto` is the user's edit of the refined prompt (omit to keep it). */
  continueRun: (runId: string, texto?: string) =>
    call<{ runId: string }>('POST', `/runs/${encodeURIComponent(runId)}/continue`, texto ? { texto } : {}).then((r) => r.runId),
  retryRun: (runId: string, via: { provider: string; model?: string }) =>
    call<{ runId: string }>('POST', `/runs/${encodeURIComponent(runId)}/retry`, via).then((r) => r.runId),
  discardRun: (runId: string) => call<{ status: string }>('POST', `/runs/${encodeURIComponent(runId)}/discard`),
  cancel: (runId: string) => call<{ status: string }>('POST', `/runs/${encodeURIComponent(runId)}/cancel`),
};
