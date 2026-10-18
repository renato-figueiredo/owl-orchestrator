import { describe, expect, it, vi } from 'vitest';
import { LocalModels } from './local-models.js';
import { OllamaControl, type Shell } from './ollama-control.js';

function setup(opts: { up?: boolean; podman?: boolean; container?: string; program?: boolean; podmanStartCode?: number; comesUpAfter?: number }) {
  let calls = 0;
  const probe = {
    isAvailable: async () => {
      calls++;
      return opts.up === true || (opts.comesUpAfter !== undefined && calls > opts.comesUpAfter);
    },
    listModels: async () => [{ name: 'gemma4:e4b' }],
  };
  const local = new LocalModels(probe);
  const run = vi.fn(async (file: string, args: string[]) => {
    if (args[0] === 'ps') return { code: 0, out: opts.container ?? '' };
    return { code: opts.podmanStartCode ?? 0, out: opts.podmanStartCode ? 'Error: no such container' : 'ollama' };
  });
  const detach = vi.fn();
  const shell: Shell = { run, detach, has: (f) => (f === 'podman' ? opts.podman === true : opts.program === true) };
  return { control: new OllamaControl(local, shell), run, detach };
}

describe('OllamaControl', () => {
  it('says it is up, with its models, and offers nothing to turn on', async () => {
    const { control } = setup({ up: true });
    expect(await control.state()).toEqual({ disponivel: true, modelos: ['gemma4:e4b'], via: null, dica: null });
  });

  it('offers the stopped container, and starts it with podman and a fixed name', async () => {
    const { control, run } = setup({ podman: true, container: 'exited', comesUpAfter: 3 });
    expect((await control.state()).via).toBe('container');
    const s = await control.start();
    expect(s.disponivel).toBe(true);
    expect(run).toHaveBeenCalledWith('podman', ['start', 'ollama'], 25_000);
  }, 15_000);

  it('starts the installed program in the background when there is no container', async () => {
    const { control, detach, run } = setup({ podman: true, container: '', program: true, comesUpAfter: 2 });
    expect((await control.state()).via).toBe('programa');
    expect((await control.start()).disponivel).toBe(true);
    expect(detach).toHaveBeenCalledWith('ollama', ['serve']);
    expect(run).not.toHaveBeenCalledWith('podman', ['start', 'ollama'], expect.anything());
  }, 15_000);

  it('does not install or create anything: with neither, it only says how', async () => {
    const { control, detach, run } = setup({ podman: true, container: '' });
    const s = await control.start();
    expect(s).toMatchObject({ disponivel: false, via: null });
    expect(s.dica).toContain('docs/06-research/ollama.md');
    expect(detach).not.toHaveBeenCalled();
    expect(run.mock.calls.every(([, args]) => args[0] === 'ps')).toBe(true);
  });

  it('reports a container that would not start', async () => {
    const { control } = setup({ podman: true, container: 'exited', podmanStartCode: 125 });
    expect((await control.start()).dica).toContain('Não consegui ligar o contêiner');
  });

  it('a running container that does not answer is not offered to start again', async () => {
    const { control } = setup({ podman: true, container: 'running' });
    const s = await control.state();
    expect(s.via).toBeNull();
    expect(s.dica).toContain('podman logs ollama');
  });
});
