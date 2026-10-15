import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOllamaAdapter, normalizeOllamaUrl } from './ollama.js';
import type { RunEvent } from '../types.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
async function fake(h: (body: string, res: import('node:http').ServerResponse) => void): Promise<string> {
  server = createServer((q, res) => {
    let b = '';
    q.on('data', (c) => (b += c));
    q.on('end', () => h(b, res));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const collect = async (it: AsyncIterable<RunEvent>) => {
  const o: RunEvent[] = [];
  for await (const e of it) o.push(e);
  return o;
};
const req = { prompt: 'oi', cwd: '/tmp', model: 'gemma:2b' };
const live = () => new AbortController().signal;

describe('QA ollama: URL', () => {
  it('rejects non-loopback hosts in the constructor, including look-alikes', () => {
    for (const u of ['http://192.168.0.2:11434', 'http://example.com', 'http://127.0.0.1.evil.com', 'http://0.0.0.0:11434', 'http://[2001:db8::1]:11434']) {
      expect(() => createOllamaAdapter({ baseUrl: u }), u).toThrow(/not on this machine/);
    }
  });
  it('accepts localhost and IPv6 loopback', () => {
    expect(normalizeOllamaUrl('http://[::1]:11434')).toBe('http://[::1]:11434');
    expect(normalizeOllamaUrl('https://localhost')).toBe('https://localhost');
  });
  it('accepts a remote host only with allowRemote', () => {
    expect(() => createOllamaAdapter({ baseUrl: 'http://10.1.1.1:11434', allowRemote: true })).not.toThrow();
  });
  it('rejects ftp and credentials', () => {
    expect(() => normalizeOllamaUrl('ftp://127.0.0.1')).toThrow(/http or https/);
    expect(() => normalizeOllamaUrl('http://a@127.0.0.1')).toThrow(/credentials/);
  });
});

describe('QA ollama: thinking', () => {
  it('sends think:false by default and think:true when asked', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const url = await fake((b, res) => {
      sent.push(JSON.parse(b));
      res.end(JSON.stringify({ message: { content: 'x' }, done: true }) + '\n');
    });
    await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    await collect(createOllamaAdapter({ baseUrl: url, think: true }).run(req, live()));
    expect(sent[0]!.think).toBe(false);
    expect(sent[1]!.think).toBe(true);
  });
  it('does not retry on a 400 unrelated to think', async () => {
    let n = 0;
    const url = await fake((_b, res) => {
      n++;
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid options' }));
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    expect(n).toBe(1);
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('invalid options') });
  });
});

describe('QA ollama: stream faults', () => {
  it('skips a malformed JSON line and still finishes', async () => {
    const url = await fake((_b, res) => {
      res.write('{not json\n');
      res.write(JSON.stringify({ message: { content: 'ok' }, done: false }) + '\n');
      res.end(JSON.stringify({ done: true }) + '\n');
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    expect(ev.map((e) => e.type)).toEqual(['start', 'text', 'end']);
    expect(ev.at(-1)).toEqual({ type: 'end', result: 'ok' });
  });
  it('handles a final done line without trailing newline', async () => {
    const url = await fake((_b, res) => res.end(JSON.stringify({ message: { content: 'z' }, done: true })));
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    expect(ev.at(-1)).toEqual({ type: 'end', result: 'z' });
  });
  it('errors (not hangs) when the connection is destroyed mid-stream', async () => {
    const url = await fake((_b, res) => {
      res.write(JSON.stringify({ message: { content: 'a' }, done: false }) + '\n');
      setTimeout(() => res.destroy(), 20);
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    expect(ev.at(-1)?.type).toBe('error');
    expect(ev.filter((e) => e.type === 'end')).toHaveLength(0);
  });
  it('stops after done: nothing is emitted from later lines', async () => {
    const url = await fake((_b, res) =>
      res.end(JSON.stringify({ message: { content: 'a' }, done: true }) + '\n' + JSON.stringify({ message: { content: 'late' }, done: false }) + '\n'),
    );
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    expect(ev.filter((e) => e.type === 'text')).toHaveLength(1);
  });
  it('gives a multibyte character split across chunks back intact', async () => {
    const buf = Buffer.from(JSON.stringify({ message: { content: 'ação' }, done: true }) + '\n');
    const url = await fake((_b, res) => {
      const cut = buf.indexOf(0xc3) + 1;
      res.write(buf.subarray(0, cut));
      setTimeout(() => res.end(buf.subarray(cut)), 10);
    });
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    expect(ev.at(-1)).toEqual({ type: 'end', result: 'ação' });
  });
  it('cancelling while waiting for headers yields cancelled', async () => {
    const url = await fake(() => {
      /* never answers */
    });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    const ev = await collect(createOllamaAdapter({ baseUrl: url }).run(req, ctl.signal));
    expect(ev.map((e) => e.type)).toEqual(['start', 'cancelled']);
  });
  it('reports an unreachable server with an error naming the URL', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const ev = await collect(createOllamaAdapter({ baseUrl: 'http://127.0.0.1:9', fetch: f }).run(req, live()));
    expect(ev.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('127.0.0.1:9') });
  });
});

describe('QA ollama: probe', () => {
  it('isAvailable is false on 500 and on a probe timeout; listModels is [] for bad bodies', async () => {
    const url500 = await fake((_b, res) => {
      res.statusCode = 500;
      res.end('x');
    });
    const a = createOllamaAdapter({ baseUrl: url500 });
    expect(await a.isAvailable()).toBe(false);
    expect(await a.listModels()).toEqual([]);
    await new Promise<void>((r) => server!.close(() => r()));
    const hang = await fake(() => {
      /* hangs */
    });
    const t = createOllamaAdapter({ baseUrl: hang, probeTimeoutMs: 50 });
    expect(await t.isAvailable()).toBe(false);
    expect(await t.listModels()).toEqual([]);
  });
  it('listModels tolerates a body that is not JSON or has no models', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('<html>')).mockResolvedValueOnce(new Response('{}'));
    const a = createOllamaAdapter({ baseUrl: 'http://127.0.0.1:1', fetch: f });
    expect(await a.listModels()).toEqual([]);
    expect(await a.listModels()).toEqual([]);
  });
});
