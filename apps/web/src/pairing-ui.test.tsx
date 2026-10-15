// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let paired: boolean;
let pairCalls: string[];

beforeEach(() => {
  paired = false;
  pairCalls = [];
  vi.stubGlobal(
    'EventSource',
    class {
      readyState = 1;
      addEventListener() {}
      close() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '');
      if (path === '/auth/status') return json({ required: true, authenticated: paired });
      if (path === '/auth/pair') {
        const code = (JSON.parse(String(init?.body)) as { code: string }).code;
        pairCalls.push(code);
        if (code !== 'certo') return json({ error: { code: 'invalid_code', message: 'Código errado ou já usado' } }, 401);
        paired = true;
        return json({ authenticated: true });
      }
      if (path === '/providers') return json({ providers: [] });
      if (path === '/projects') return json({ projects: [] });
      if (path === '/sessions') return json({ sessions: [] });
      return json({ error: { code: 'x', message: 'x' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('pairing', () => {
  it('asks for the code, shows a wrong one as an error, then opens the app', async () => {
    const user = userEvent.setup();
    render(<App />);
    const box = await screen.findByRole('textbox', { name: 'Código de pareamento' });
    await user.type(box, 'errado');
    await user.click(screen.getByRole('button', { name: 'Parear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código errado');
    await user.clear(box);
    await user.type(box, 'certo');
    await user.click(screen.getByRole('button', { name: 'Parear' }));
    expect(await screen.findByRole('button', { name: 'Agentes' })).toBeInTheDocument();
  });

  it('takes the code from ?pair= and removes it from the address bar', async () => {
    history.replaceState(null, '', '/?pair=certo');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Agentes' })).toBeInTheDocument();
    expect(pairCalls).toEqual(['certo']);
    await waitFor(() => expect(location.search).toBe(''));
  });
});
