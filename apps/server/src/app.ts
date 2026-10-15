import { listAdapters, type RunEvent } from '@owl/core';
import type { createRepos } from '@owl/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import type { Executor } from './executor.js';
import { FolderError, registerGuards, resolveWorkspace } from './security.js';

type Repos = ReturnType<typeof createRepos>;

export interface AppDeps {
  repos: Repos;
  executor: Executor;
  /** Working folder for sessions that belong to no project. */
  defaultCwd?: string;
  /** Folders projects and runs may use (see `resolveWorkspace`). */
  workspaceRoots: string[];
  /** Extra browser origins allowed to call the API (e.g. the Vite dev server). */
  allowedOrigins?: string[];
}

/** Error with an HTTP status, rendered as `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const createProject = z.object({
  nome: z.string().trim().min(1).max(200),
  pasta: z.string().min(1).max(4096),
  /** Instructions appended to the system prompt of every run in this project. */
  instrucoes: z.string().max(50_000).optional(),
});
const createSession = z.object({
  projectId: z.string().min(1).optional(),
  titulo: z.string().trim().min(1).max(200).optional(),
});
const listSessions = z.object({ projectId: z.string().min(1).optional() });
const sendMessage = z.object({
  texto: z.string().trim().min(1).max(200_000),
  provider: z.string().min(1).max(64).default('claude-cli'),
  // Same shape the adapters accept as an option value: never starts with "-".
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/).optional(),
  /** Only for sessions without a project; a project session always runs in the project's folder. */
  cwd: z.string().min(1).max(4096).optional(),
});

function projectInstructions(configJson: string | null): string | undefined {
  if (!configJson) return undefined;
  try {
    const v = (JSON.parse(configJson) as { instrucoes?: unknown }).instrucoes;
    return typeof v === 'string' && v.trim() ? v : undefined;
  } catch {
    return undefined;
  }
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { repos, executor } = deps;
  const app = Fastify({ logger: false });

  registerGuards(app, deps.allowedOrigins);

  const folder = (dir: string) => {
    try {
      return resolveWorkspace(dir, deps.workspaceRoots);
    } catch (e) {
      if (e instanceof FolderError) throw new HttpError(e.code === 'invalid_folder' ? 400 : 403, e.code, e.message);
      throw e;
    }
  };

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return reply.status(400).send({ error: { code: 'invalid_request', message } });
    }
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: err instanceof Error ? err.message : 'Bad request' } });
    }
    return reply.status(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );

  const liveSession = (id: string) => {
    const s = repos.sessions.get(id);
    if (!s || s.deletedAt) throw new HttpError(404, 'session_not_found', `Session not found: ${id}`);
    return s;
  };

  app.get('/health', async () => ({ status: 'ok', name: 'owl' }));

  app.get('/providers', async () => ({
    providers: await Promise.all(listAdapters().map(async (a) => ({ id: a.id, available: await a.isAvailable() }))),
  }));

  app.post('/projects', async (req, reply) => {
    const body = createProject.parse(req.body);
    const project = repos.projects.create({
      nome: body.nome,
      pasta: folder(body.pasta),
      ...(body.instrucoes ? { config: { instrucoes: body.instrucoes } } : {}),
    });
    return reply.status(201).send({ project });
  });

  app.get('/projects', async () => ({ projects: repos.projects.list() }));

  app.post('/sessions', async (req, reply) => {
    const body = createSession.parse(req.body ?? {});
    if (body.projectId && !repos.projects.get(body.projectId)) {
      throw new HttpError(404, 'project_not_found', `Project not found: ${body.projectId}`);
    }
    return reply.status(201).send({ session: repos.sessions.create({
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.titulo ? { titulo: body.titulo } : {}),
    }) });
  });

  app.get('/sessions', async (req) => {
    const q = listSessions.parse(req.query);
    return { sessions: repos.sessions.list(q.projectId ? { projectId: q.projectId } : {}) };
  });

  app.get('/sessions/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const session = liveSession(id);
    return { session, messages: repos.messages.list(id), runs: repos.runs.listBySession(id) };
  });

  app.post('/sessions/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = sendMessage.parse(req.body);
    const session = liveSession(id);
    if (!listAdapters().some((a) => a.id === body.provider)) {
      throw new HttpError(400, 'unknown_provider', `Unknown provider: ${body.provider}`);
    }

    const project = session.projectId ? repos.projects.get(session.projectId) : undefined;
    if (project && body.cwd) {
      throw new HttpError(400, 'cwd_not_allowed', 'cwd cannot be set for a session that belongs to a project');
    }
    // Checked on every run, not only at creation: the folder may have been removed or replaced by a symlink since.
    const cwd = folder(project?.pasta ?? body.cwd ?? deps.defaultCwd ?? process.cwd());

    repos.sessions.setTitleIfEmpty(id, body.texto.replace(/\s+/g, ' ').slice(0, 60));
    const systemAppend = project ? projectInstructions(project.configJson) : undefined;
    const run = executor.submit({
      sessionId: id,
      texto: body.texto,
      provider: body.provider,
      cwd,
      ...(body.model ? { model: body.model } : {}),
      ...(systemAppend ? { systemAppend } : {}),
    });
    return reply.status(202).send({ runId: run.id });
  });

  app.get('/runs/:id/stream', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const run = repos.runs.get(id);
    if (!run) throw new HttpError(404, 'run_not_found', `Run not found: ${id}`);

    const write = (e: RunEvent) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const head = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    };
    reply.hijack();
    reply.raw.writeHead(200, head);

    const sub = executor.subscribe(id, (event) => {
      write(event);
      if (['end', 'error', 'cancelled'].includes(event.type)) reply.raw.end();
    });
    if (!sub) {
      // No longer in memory (old run or server restart): report the stored outcome.
      write({ type: 'start', runId: id, provider: run.provedor, ...(run.modelo ? { model: run.modelo } : {}) });
      write(
        run.status === 'ok'
          ? { type: 'end' }
          : run.status === 'cancelado'
            ? { type: 'cancelled' }
            : { type: 'error', message: run.erro ?? 'Run did not finish' },
      );
      reply.raw.end();
      return;
    }
    for (const event of sub.history) write(event);
    if (sub.done) reply.raw.end();
    req.raw.on('close', () => sub.unsubscribe());
  });

  app.post('/runs/:id/cancel', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const outcome = executor.cancel(id);
    if (outcome === 'not_found') throw new HttpError(404, 'run_not_found', `Run not found: ${id}`);
    if (outcome === 'finished') throw new HttpError(409, 'run_finished', 'Run already finished');
    return reply.status(202).send({ status: 'cancelling' });
  });

  return app;
}
