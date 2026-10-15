import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '../types.js';
import { createOllamaAdapter } from './ollama.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? (server.closeAllConnections(), server.close(() => r())) : r())));
async function fake(h: (path: string, res: import('node:http').ServerResponse) => void): Promise<string> {
  server = createServer((q, res) => {
    q.resume();
    q.on('end', () => h(q.url ?? '', res));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const collect = async (it: AsyncIterable<RunEvent>) => {
  const o: RunEvent[] = [];
  for await (const e of it) o.push(e);
  return o;
};
const req = { prompt: 'segredo do projeto', cwd: '/tmp', model: 'gemma:2b' };
const live = () => new AbortController().signal;

describe('ollama: redirects', () => {
  it('never follows a redirect, so the prompt cannot leave the loopback', async () => {
    let hitElsewhere = 0;
    const other = createServer((_q, res) => {
      hitElsewhere++;
      res.end('{}');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/api/chat`;
    const url = await fake((_p, res) => {
      res.writeHead(307, { location: target });
      res.end();
    });
    const events = await collect(createOllamaAdapter({ baseUrl: url }).run(req, live()));
    other.close();
    expect(hitElsewhere).toBe(0);
    expect(events.at(-1)?.type).toBe('error');
  });

  it('does not follow a redirect on the probe either', async () => {
    let hitElsewhere = 0;
    const other = createServer((_q, res) => {
      hitElsewhere++;
      res.end('{"models":[{"name":"x"}]}');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/api/tags`;
    const url = await fake((_p, res) => {
      res.writeHead(302, { location: target });
      res.end();
    });
    const a = createOllamaAdapter({ baseUrl: url });
    expect(await a.isAvailable()).toBe(false);
    expect(await a.listModels()).toEqual([]);
    other.close();
    expect(hitElsewhere).toBe(0);
  });
});

describe('ollama: limits', () => {
  it('fails a reply larger than the limit instead of growing without end', async () => {
    const url = await fake((_p, res) => {
      res.write(JSON.stringify({ message: { content: 'x'.repeat(600) } }) + '\n');
      res.write(JSON.stringify({ message: { content: 'x'.repeat(600) } }) + '\n');
      res.end(JSON.stringify({ message: { content: 'y' }, done: true }) + '\n');
    });
    const events = await collect(createOllamaAdapter({ baseUrl: url, maxReplyChars: 1000 }).run(req, live()));
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/larger than 1000/) });
    expect(events.some((e) => e.type === 'end')).toBe(false);
  });

  it('fails a line that never ends', async () => {
    const url = await fake((_p, res) => {
      res.write('x'.repeat(2000));
    });
    const events = await collect(createOllamaAdapter({ baseUrl: url, maxReplyChars: 1000 }).run(req, live()));
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/larger than/) });
  });

  it('gives up on a server that goes silent', async () => {
    const url = await fake((_p, res) => {
      res.write(JSON.stringify({ message: { content: 'a' } }) + '\n'); // then nothing
    });
    const events = await collect(createOllamaAdapter({ baseUrl: url, idleTimeoutMs: 150 }).run(req, live()));
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/no data from/) });
  });

  it('still reports a cancel as cancelled, not as a timeout', async () => {
    const url = await fake((_p, res) => {
      res.write(JSON.stringify({ message: { content: 'a' } }) + '\n');
    });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    const events = await collect(createOllamaAdapter({ baseUrl: url, idleTimeoutMs: 5000 }).run(req, ctl.signal));
    expect(events.at(-1)?.type).toBe('cancelled');
  });
});
