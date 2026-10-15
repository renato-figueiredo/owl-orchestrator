import { randomUUID } from 'node:crypto';
import { assertSafeArg } from '../process.js';
import type { ProviderAdapter, RunEvent, RunRequest } from '../types.js';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export interface OllamaOptions {
  /** Base URL of the Ollama server (default `OLLAMA_URL` or `http://127.0.0.1:11434`). Loopback only unless `allowRemote`. */
  baseUrl?: string;
  /** Model used when a request names none. */
  defaultModel?: string;
  /**
   * Reasoning mode (default false). Thinking models answer slowly when it is on, and a classifier or a prompt refiner
   * does not need it, so it is off unless the caller asks.
   */
  think?: boolean;
  /** Accept a non-loopback server. Off by default: prompts and project text would leave the machine. */
  allowRemote?: boolean;
  /** Milliseconds to wait for the server to answer a probe (default 1500). */
  probeTimeoutMs?: number;
  /** Replaceable for tests. */
  fetch?: typeof fetch;
}

export interface OllamaModel {
  name: string;
  /** Bytes on disk. */
  size?: number;
}

const SAFE_MODEL = /^[\w.:/@-]+$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The server URL without a trailing slash; throws for anything but http(s), or for a remote host without `allowRemote`. */
export function normalizeOllamaUrl(raw: string, allowRemote = false): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Ollama URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Invalid Ollama URL (http or https only): ${JSON.stringify(raw)}`);
  if (url.username || url.password) throw new Error('Ollama URL must not carry credentials');
  if (!allowRemote && !LOOPBACK.has(url.hostname)) {
    throw new Error(`Ollama URL ${url.host} is not on this machine; set OWL_OLLAMA_ALLOW_REMOTE=1 to send prompts there`);
  }
  return url.origin;
}

interface ChatLine {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

const errorText = async (res: Response): Promise<string> => {
  const raw = (await res.text().catch(() => '')).slice(0, 2000);
  try {
    const j = JSON.parse(raw) as { error?: unknown };
    if (typeof j.error === 'string') return j.error;
  } catch {
    /* not JSON */
  }
  return raw.trim() || res.statusText;
};

export interface OllamaAdapter extends ProviderAdapter {
  /** Models installed on the server (empty when it does not answer). */
  listModels(signal?: AbortSignal): Promise<OllamaModel[]>;
}

/**
 * Adapter over Ollama's local HTTP API (`POST /api/chat`, streamed JSON lines). Text only, one turn per run:
 * Ollama keeps no session (`resumeSessionId` is ignored; OWL's memory layer carries the context), has no tools
 * (`allowedTools` is ignored, so route agents that need tools elsewhere) and `images` are refused.
 */
export function createOllamaAdapter(opts: OllamaOptions = {}): OllamaAdapter {
  const baseUrl = normalizeOllamaUrl(opts.baseUrl ?? process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL, opts.allowRemote ?? false);
  const doFetch = opts.fetch ?? fetch;
  const probeTimeout = opts.probeTimeoutMs ?? 1500;
  const think = opts.think ?? false;

  const probe = (signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(probeTimeout);
    return doFetch(`${baseUrl}/api/tags`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  };

  async function listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    try {
      const res = await probe(signal);
      if (!res.ok) return [];
      const body = (await res.json()) as { models?: Array<{ name?: unknown; size?: unknown }> };
      return (body.models ?? []).flatMap((m) =>
        typeof m.name === 'string' && SAFE_MODEL.test(m.name) ? [{ name: m.name, ...(typeof m.size === 'number' ? { size: m.size } : {}) }] : [],
      );
    } catch {
      return [];
    }
  }

  async function* run(req: RunRequest, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const runId = req.runId ?? randomUUID();
    const model = req.model ?? opts.defaultModel;
    yield { type: 'start', runId, provider: 'ollama', ...(model ? { model } : {}) };

    if (!model) {
      yield { type: 'error', message: 'ollama: no model chosen (set one on the agent, the tier or OLLAMA_MODEL)' };
      return;
    }
    try {
      assertSafeArg('model', model, SAFE_MODEL);
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
      return;
    }
    if (req.images?.length) {
      yield { type: 'error', message: 'ollama: images are not supported by this adapter' };
      return;
    }
    if (signal.aborted) {
      yield { type: 'cancelled' };
      return;
    }

    const messages = [...(req.systemAppend ? [{ role: 'system', content: req.systemAppend }] : []), { role: 'user', content: req.prompt }];
    const post = (withThink: boolean) =>
      doFetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, ...(withThink ? { think } : {}) }),
        signal,
      });

    let text = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      let res = await post(true);
      // Models without a reasoning mode refuse the `think` field: ask again without it.
      if (res.status === 400) {
        const why = await errorText(res);
        if (!/think/i.test(why)) {
          yield { type: 'error', message: `ollama: ${why}` };
          return;
        }
        res = await post(false);
      }
      if (!res.ok) {
        yield { type: 'error', message: `ollama: ${await errorText(res)}` };
        return;
      }
      if (!res.body) {
        yield { type: 'error', message: 'ollama: empty response' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      const handle = function* (raw: string): Generator<RunEvent> {
        if (!raw.trim()) return;
        let line: ChatLine;
        try {
          line = JSON.parse(raw) as ChatLine;
        } catch {
          return;
        }
        if (typeof line.error === 'string') {
          finished = true;
          yield { type: 'error', message: `ollama: ${line.error}` };
          return;
        }
        const delta = line.message?.content;
        if (delta) {
          text += delta;
          yield { type: 'text', delta };
        }
        if (line.done) {
          finished = true;
          inputTokens = line.prompt_eval_count;
          outputTokens = line.eval_count;
          if (inputTokens !== undefined || outputTokens !== undefined) {
            yield { type: 'usage', ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
          }
          yield { type: 'end', result: text };
        }
      };

      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          yield* handle(raw);
          if (finished) return;
        }
      }
      buffer += decoder.decode();
      yield* handle(buffer);
      if (!finished) yield { type: 'error', message: 'ollama: the stream ended without a result' };
    } catch (e) {
      if (signal.aborted) yield { type: 'cancelled' };
      else yield { type: 'error', message: `ollama: could not reach ${baseUrl}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return {
    id: 'ollama',
    isAvailable: async () => {
      try {
        return (await probe()).ok;
      } catch {
        return false;
      }
    },
    listModels,
    run,
  };
}
