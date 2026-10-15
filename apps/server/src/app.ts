import { listAdapters, type RunEvent } from '@owl/core';
import type { createRepos } from '@owl/db';
import { createReadStream } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { AttachmentError, AttachmentService, cleanName, HASH, MAX_NAME_CHARS } from './attachments.js';
import type { Executor } from './executor.js';
import { Library } from './library.js';
import { MemoryService, memorySettingsPatchSchema } from './memory.js';
import { PipelineError, PipelineRunner } from './pipeline-runner.js';
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
  /** Folder with `agents/` and `pipelines/` (default: the repo's `examples/`). */
  libraryDir?: string;
  /** Where processed images are stored (default: a folder in the system temp dir). */
  attachmentsDir?: string;
  /** Largest image accepted, in bytes (default 10 MB). */
  maxAttachmentBytes?: number;
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
// Same shape the adapters accept as an option value: never starts with "-".
const modelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/);
const attachmentRef = z.object({
  hash: z.string().regex(HASH),
  nome: z.string().max(MAX_NAME_CHARS * 4).optional(),
});
const sendMessage = z.object({
  /** May be empty when images are attached. */
  texto: z.string().trim().max(200_000).default(''),
  anexos: z.array(attachmentRef).max(10).default([]),
  provider: z.string().min(1).max(64).default('claude-cli'),
  model: modelId.optional(),
  /** Only for sessions without a project; a project session always runs in the project's folder. */
  cwd: z.string().min(1).max(4096).optional(),
  /** Run the "melhorar prompt" pipeline: a refiner agent rewrites the request first. */
  melhorarPrompt: z.boolean().default(false),
  /** With `melhorarPrompt`: stop after the refinement so the user can review and edit it. */
  editarAntes: z.boolean().default(false),
  /** Use this provider/model for the refiner instead of the agent's own (e.g. haiku after the limit ran out). */
  refinador: z.object({ provider: z.string().min(1).max(64), model: modelId.optional() }).optional(),
});
const factBody = z.object({
  projectId: z.string().min(1).optional(),
  texto: z.string().trim().min(1).max(500),
  fixado: z.boolean().default(false),
});
const factPatch = z.object({ texto: z.string().trim().min(1).max(500).optional(), fixado: z.boolean().optional() });
const summaryBody = z.object({ resumo: z.string().trim().min(1).max(8000) });
const continueBody = z.object({ texto: z.string().max(200_000).optional() });
const retryBody = z.object({ provider: z.string().min(1).max(64), model: modelId.optional() });

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
  const library = new Library(deps.libraryDir);
  const runner = new PipelineRunner({ repos, executor, library });
  const memory = new MemoryService({ repos, executor });
  const attachments = new AttachmentService({
    repos,
    executor,
    ...(deps.attachmentsDir ? { dir: deps.attachmentsDir } : {}),
    ...(deps.maxAttachmentBytes ? { maxBytes: deps.maxAttachmentBytes } : {}),
    describer: () => memory.settings().resumidor,
  });

  // Images arrive as the raw request body (no multipart): the file name travels in the query string.
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: attachments.maxBytes }, (_req, body, done) => done(null, body));
  }

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
    if (err instanceof PipelineError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 413) return reply.status(413).send({ error: { code: 'too_large', message: 'The request body is too large' } });
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
    const messages = repos.messages.list(id);
    const byMessage = new Map<number, unknown[]>();
    for (const x of repos.attachments.forMessages(messages.map((m) => m.id))) {
      byMessage.set(x.messageId, [
        ...(byMessage.get(x.messageId) ?? []),
        { hash: x.blobHash, nome: x.nomeOriginal, largura: x.largura, altura: x.altura, url: `/attachments/${x.blobHash}` },
      ]);
    }
    return {
      session,
      messages: messages.map((m) => (byMessage.has(m.id) ? { ...m, anexos: byMessage.get(m.id) } : m)),
      runs: repos.runs.listBySession(id),
      approvals: repos.approvals.pendingBySession(id).filter((a) => !a.runId || runner.isWaiting(a.runId)),
    };
  });

  app.post('/attachments', async (req, reply) => {
    const q = z.object({ nome: z.string().max(MAX_NAME_CHARS * 4).optional() }).parse(req.query);
    if (!Buffer.isBuffer(req.body)) {
      throw new HttpError(415, 'unsupported_type', 'Send the image as the request body with Content-Type image/png, image/jpeg or image/webp');
    }
    try {
      const blob = await attachments.store(req.body);
      const nome = cleanName(q.nome);
      return reply.status(201).send({
        attachment: { hash: blob.hash, ...(nome ? { nome } : {}), mime: blob.mime, bytes: blob.bytes, largura: blob.largura, altura: blob.altura, url: `/attachments/${blob.hash}` },
      });
    } catch (e) {
      if (e instanceof AttachmentError) throw new HttpError(e.status, e.code, e.message);
      throw e;
    }
  });

  app.get('/attachments/:hash', async (req, reply) => {
    const { hash } = z.object({ hash: z.string() }).parse(req.params);
    const file = attachments.pathOf(hash);
    if (!file) throw new HttpError(404, 'attachment_not_found', 'Attachment not found');
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(createReadStream(file));
  });

  app.post('/sessions/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = sendMessage.parse(req.body);
    const session = liveSession(id);
    if (!listAdapters().some((a) => a.id === body.provider)) {
      throw new HttpError(400, 'unknown_provider', `Unknown provider: ${body.provider}`);
    }
    if (!body.texto && body.anexos.length === 0) throw new HttpError(400, 'invalid_request', 'texto: write something or attach an image');
    const missing = body.anexos.find((x) => !attachments.exists(x.hash));
    if (missing) throw new HttpError(400, 'attachment_not_found', `Attachment not found: ${missing.hash}`);
    const anexos = body.anexos.map((x) => ({ hash: x.hash, ...(cleanName(x.nome) ? { nome: cleanName(x.nome) } : {}) }));
    const texto = body.texto || 'Veja a imagem anexa.';

    const project = session.projectId ? repos.projects.get(session.projectId) : undefined;
    if (project && body.cwd) {
      throw new HttpError(400, 'cwd_not_allowed', 'cwd cannot be set for a session that belongs to a project');
    }
    // Checked on every run, not only at creation: the folder may have been removed or replaced by a symlink since.
    const cwd = folder(project?.pasta ?? body.cwd ?? deps.defaultCwd ?? process.cwd());

    repos.sessions.setTitleIfEmpty(id, texto.replace(/\s+/g, ' ').slice(0, 60));
    const systemAppend = project ? projectInstructions(project.configJson) : undefined;
    for (const p of [body.refinador?.provider].filter((x): x is string => !!x)) {
      if (!listAdapters().some((a) => a.id === p)) throw new HttpError(400, 'unknown_provider', `Unknown provider: ${p}`);
    }
    if (body.melhorarPrompt) {
      const first = runner.start(
        {
          sessionId: id,
          pedido: texto,
          ...(anexos.length ? { anexos } : {}),
          cwd,
          editarAntes: body.editarAntes,
          executar: {
            provider: body.provider,
            ...(body.model ? { model: body.model } : {}),
            ...(systemAppend ? { systemAppend } : {}),
          },
          ...(body.refinador ? { refinador: { provider: body.refinador.provider, ...(body.refinador.model ? { model: body.refinador.model } : {}) } } : {}),
        },
        { melhorarPrompt: true },
      );
      return reply.status(202).send({ runId: first.id, etapa: first.etapa });
    }
    const run = executor.submit({
      sessionId: id,
      texto,
      ...(anexos.length ? { anexos } : {}),
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

  // ---- memory: settings, facts, summary ---------------------------------------------------------------------

  app.get('/settings', async () => ({ memory: memory.settings() }));

  app.put('/settings', async (req) => {
    const patch = z.object({ memory: memorySettingsPatchSchema }).parse(req.body);
    const provider = patch.memory.resumidor?.provider;
    if (provider && !listAdapters().some((a) => a.id === provider)) {
      throw new HttpError(400, 'unknown_provider', `Unknown provider: ${provider}`);
    }
    return { memory: memory.save(patch.memory) };
  });

  app.get('/facts', async (req) => {
    const q = listSessions.parse(req.query);
    return { facts: repos.facts.listScope({ projectId: q.projectId ?? null }) };
  });

  app.post('/facts', async (req, reply) => {
    const body = factBody.parse(req.body);
    if (body.projectId && !repos.projects.get(body.projectId)) {
      throw new HttpError(404, 'project_not_found', `Project not found: ${body.projectId}`);
    }
    const fact = repos.facts.add({ texto: body.texto, fixado: body.fixado, ...(body.projectId ? { projectId: body.projectId } : {}) });
    return reply.status(201).send({ fact });
  });

  app.patch('/facts/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const changes = factPatch.parse(req.body);
    if (!repos.facts.get(id)) throw new HttpError(404, 'fact_not_found', `Fact not found: ${id}`);
    return {
      fact: repos.facts.update(id, {
        ...(changes.texto !== undefined ? { texto: changes.texto } : {}),
        ...(changes.fixado !== undefined ? { fixado: changes.fixado } : {}),
      }),
    };
  });

  app.delete('/facts/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!repos.facts.get(id)) throw new HttpError(404, 'fact_not_found', `Fact not found: ${id}`);
    repos.facts.delete(id);
    return { status: 'deleted' };
  });

  app.put('/sessions/:id/summary', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = summaryBody.parse(req.body);
    liveSession(id);
    repos.sessions.editSummary(id, body.resumo);
    return { session: repos.sessions.get(id) };
  });

  app.post('/sessions/:id/summary/undo', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const session = liveSession(id);
    if (session.resumoAnterior === null) throw new HttpError(409, 'nothing_to_undo', 'There is no previous summary');
    repos.sessions.swapSummary(id);
    return { session: repos.sessions.get(id) };
  });

  /** Writes the summary now and answers when it is done (a few seconds with a small model). */
  app.post('/sessions/:id/summarize', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    liveSession(id);
    const result = await memory.summarize(id);
    return { ...result, session: repos.sessions.get(id) };
  });

  app.get('/refiner', async () => {
    const a = library.agent('refinador-de-prompt');
    return { provedor: a.provedor, modelo: a.modelo ?? null, fallback: a.fallback };
  });

  app.post('/runs/:id/continue', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = continueBody.parse(req.body ?? {});
    const run = runner.continue(id, body.texto);
    return reply.status(202).send({ runId: run.id, etapa: run.etapa });
  });

  app.post('/runs/:id/retry', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = retryBody.parse(req.body);
    if (!listAdapters().some((a) => a.id === body.provider)) {
      throw new HttpError(400, 'unknown_provider', `Unknown provider: ${body.provider}`);
    }
    const run = runner.retry(id, { provider: body.provider, ...(body.model ? { model: body.model } : {}) });
    return reply.status(202).send({ runId: run.id, etapa: run.etapa });
  });

  app.post('/runs/:id/discard', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    runner.discard(id);
    return reply.status(200).send({ status: 'discarded' });
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
