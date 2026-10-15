import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOllamaAdapter, normalizeOllamaUrl } from './ollama.js';
import type { RunEvent } from '../types.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
async function fake(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const collect = async (it: AsyncIterable<RunEvent>) => {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
const lines = (...o: object[]) => o.map((x) => JSON.stringify(x)).join('\n') + '\n';
const req = { prompt: 'oi', cwd: '/tmp', model: 'gemma:2b' };

describe('ollama adapter', () => {
  it('streams text, reports usage and ends with the full text; thinking is off by default', async () => {
    let sent: Record<string, unknown> = {};
    const url = await fake((_q, res, body) => {
      sent = JSON.parse(body);
      res.write(lines({ message: { content: 'Olá' }, done: false }));
      // a line split across two chunks
      const l = JSON.stringify({ message: { content: ' mundo' }, done: false });
      res.write(l.slice(0, 10));
      res.write(l.slice(10) + '\n');
      res.end(lines({ message: { content: '' }, done: true, prompt_eval_count: 7, eval_count: 3 }));
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run({ ...req, systemAppend: 'seja breve' }, new AbortController().signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'text', 'text', 'usage', 'end']);
    expect(ev[0]).toMatchObject({ provider: 'ollama', model: 'gemma:2b' });
    expect(ev.at(-1)).toEqual({ type: 'end', result: 'Olá mundo' });
    expect(ev[3]).toEqual({ type: 'usage', inputTokens: 7, outputTokens: 3 });
    expect(sent).toMatchObject({ model: 'gemma:2b', stream: true, think: false });
    expect(sent.messages).toEqual([{ role: 'system', content: 'seja breve' }, { role: 'user', content: 'oi' }]);
  });

  it('does not show the reasoning text', async () => {
    const url = await fake((_q, res) => {
      res.end(lines({ message: { content: '', thinking: 'hmm' }, done: false }, { message: { content: 'ok' }, done: true }));
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, new AbortController().signal));
    expect(ev.filter((e) => e.type === 'text')).toEqual([{ type: 'text', delta: 'ok' }]);
  });

  it('retries without `think` for a model that does not support it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const url = await fake((_q, res, body) => {
      bodies.push(JSON.parse(body));
      if ('think' in bodies.at(-1)!) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '"x" does not support thinking' }));
      } else res.end(lines({ message: { content: 'ok' }, done: true }));
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, new AbortController().signal));
    expect(ev.at(-1)).toEqual({ type: 'end', result: 'ok' });
    expect(bodies).toHaveLength(2);
  });

  it('turns an HTTP error (unknown model) into one error event', async () => {
    const url = await fake((_q, res) => {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "model 'nope' not found" }));
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run({ ...req, model: 'nope' }, new AbortController().signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'error']);
    expect(ev[1]).toMatchObject({ message: expect.stringContaining("model 'nope' not found") });
  });

  it('turns an error in the middle of the stream into the terminal event', async () => {
    const url = await fake((_q, res) => {
      res.end(lines({ message: { content: 'a' }, done: false }, { error: 'out of memory' }, { message: { content: 'b' }, done: true }));
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, new AbortController().signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'text', 'error']);
  });

  it('errors when the stream ends without `done`', async () => {
    const url = await fake((_q, res) => res.end(lines({ message: { content: 'a' }, done: false })));
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'error' });
  });

  it('cancels mid-stream with a single `cancelled`', async () => {
    const url = await fake((_q, res) => {
      res.write(lines({ message: { content: 'a' }, done: false }));
      // never finishes
    });
    const ctl = new AbortController();
    const ev: RunEvent[] = [];
    for await (const e of createOllamaAdapter({ baseUrl: url }).run(req, ctl.signal)) {
      ev.push(e);
      if (e.type === 'text') ctl.abort();
    }
    expect(ev.map((e) => e.type)).toEqual(['start', 'text', 'cancelled']);
  });

  it('reports a server that is down as an error, and as unavailable', async () => {
    const url = await fake((_q, res) => res.end());
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    const a = createOllamaAdapter({ baseUrl: url });
    expect(await a.isAvailable()).toBe(false);
    expect(await a.listModels()).toEqual([]);
    const ev = await collect(a.run(req, new AbortController().signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'error']);
  });

  it('checks the endpoint and lists installed models', async () => {
    const url = await fake((q, res) => {
      expect(q.url).toBe('/api/tags');
      res.end(JSON.stringify({ models: [{ name: 'gemma4:e2b', size: 5 }, { name: '--bad' + ' x' }, { name: 'qwen2.5-coder:7b' }] }));
    });
    const a = createOllamaAdapter({ baseUrl: url });
    expect(await a.isAvailable()).toBe(true);
    expect((await a.listModels()).map((m) => m.name)).toEqual(['gemma4:e2b', 'qwen2.5-coder:7b']);
  });

  it('refuses a missing model, an unsafe model, images and an already cancelled run without calling the server', async () => {
    let calls = 0;
    const url = await fake((_q, res) => {
      calls++;
      res.end();
    });
    const a = createOllamaAdapter({ baseUrl: url });
    const live = new AbortController().signal;
    const noModel = { prompt: req.prompt, cwd: req.cwd };
    expect((await collect(a.run(noModel, live))).at(-1)).toMatchObject({ type: 'error' });
    expect((await collect(a.run({ ...req, model: '-x' }, live))).at(-1)).toMatchObject({ type: 'error' });
    expect((await collect(a.run({ ...req, images: ['/a.png'] }, live))).at(-1)).toMatchObject({ type: 'error' });
    const dead = new AbortController();
    dead.abort();
    expect((await collect(a.run(req, dead.signal))).at(-1)).toEqual({ type: 'cancelled' });
    expect(calls).toBe(0);
  });

  it('uses the default model when the request has none', async () => {
    let sent: Record<string, unknown> = {};
    const url = await fake((_q, res, body) => {
      sent = JSON.parse(body);
      res.end(lines({ message: { content: 'ok' }, done: true }));
    });
    const noModel = { prompt: req.prompt, cwd: req.cwd };
    await collect(createOllamaAdapter({ baseUrl: url, defaultModel: 'm:1' }).run(noModel, new AbortController().signal));
    expect(sent.model).toBe('m:1');
  });
});

describe('normalizeOllamaUrl', () => {
  it('accepts loopback and strips the path', () => {
    expect(normalizeOllamaUrl('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaUrl('http://localhost:1/x')).toBe('http://localhost:1');
  });
  it('refuses remote hosts unless allowed, other schemes and credentials', () => {
    expect(() => normalizeOllamaUrl('http://10.0.0.5:11434')).toThrow(/not on this machine/);
    expect(normalizeOllamaUrl('http://10.0.0.5:11434', true)).toBe('http://10.0.0.5:11434');
    expect(() => normalizeOllamaUrl('file:///etc/passwd')).toThrow();
    expect(() => normalizeOllamaUrl('http://u:p@127.0.0.1')).toThrow(/credentials/);
    expect(() => normalizeOllamaUrl('nope')).toThrow();
  });
});
