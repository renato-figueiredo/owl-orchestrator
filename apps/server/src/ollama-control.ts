import { execFile, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { LocalModels } from './local-models.js';

/** The container the docs tell the person to create (`docs/06-research/ollama.md`). Fixed: nothing here takes a name from a request. */
export const OLLAMA_CONTAINER = 'ollama';
const WAIT_MS = 30_000;

export interface OllamaState {
  disponivel: boolean;
  modelos: string[];
  /** How OWL can turn it on: the stopped container, the `ollama` program, or not at all (it is not installed). */
  via: 'container' | 'programa' | null;
  /** Said when OWL cannot turn it on itself. */
  dica: string | null;
}

export interface Shell {
  /** Runs a program with an args array (never a shell string); resolves with its exit code and output. */
  run(file: string, args: string[], timeoutMs?: number): Promise<{ code: number; out: string }>;
  /** Starts a program that outlives this call. */
  detach(file: string, args: string[]): void;
  has(file: string): boolean;
}

export const realShell: Shell = {
  run: (file, args, timeoutMs = 20_000) =>
    new Promise((resolve) => {
      const child = execFile(file, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
        resolve({ code, out: `${stdout}${stderr}`.trim() });
      });
      child.stdin?.end();
    }),
  detach(file, args) {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  },
  has(file) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      try {
        accessSync(join(dir, file), constants.X_OK);
        return true;
      } catch {
        /* next */
      }
    }
    return false;
  },
};

const NOT_INSTALLED = 'O Ollama não está instalado aqui. Veja docs/06-research/ollama.md: um comando `podman run` cria o contêiner "ollama"; depois o OWL passa a poder ligá-lo.';

/**
 * Lets the interface say why the local model server is down and turn it on: `podman start ollama` for the container the
 * docs set up, or `ollama serve` when the program is installed. OWL never installs or creates anything here (pulling an
 * image or giving a container the graphics card is for the person to decide), and the container name is fixed.
 */
export class OllamaControl {
  private starting: Promise<OllamaState> | undefined;

  constructor(
    private readonly local: LocalModels | undefined,
    private readonly shell: Shell = realShell,
  ) {}

  private async container(): Promise<'rodando' | 'parado' | null> {
    if (!this.shell.has('podman')) return null;
    const r = await this.shell.run('podman', ['ps', '-a', '--filter', `name=^${OLLAMA_CONTAINER}$`, '--format', '{{.State}}'], 8_000);
    if (r.code !== 0 || r.out === '') return null;
    return r.out === 'running' ? 'rodando' : 'parado';
  }

  async state(): Promise<OllamaState> {
    const snap = this.local ? await this.local.refresh() : { disponivel: false, modelos: [] as string[] };
    if (snap.disponivel) return { ...snap, via: null, dica: null };
    const container = await this.container();
    if (container === 'parado') return { ...snap, via: 'container', dica: null };
    if (container === 'rodando') return { ...snap, via: null, dica: 'O contêiner "ollama" está rodando mas não respondeu. Pode estar carregando; veja `podman logs ollama`.' };
    if (this.shell.has('ollama')) return { ...snap, via: 'programa', dica: null };
    return { ...snap, via: null, dica: NOT_INSTALLED };
  }

  /** Turns it on and waits (up to 30 s) until it answers. One start at a time: a second click joins the first. */
  start(): Promise<OllamaState> {
    this.starting ??= this.doStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async doStart(): Promise<OllamaState> {
    const before = await this.state();
    if (before.disponivel || before.via === null) return before;
    if (before.via === 'container') {
      const r = await this.shell.run('podman', ['start', OLLAMA_CONTAINER], 25_000);
      if (r.code !== 0) return { ...before, dica: `Não consegui ligar o contêiner: ${r.out.slice(0, 300) || 'podman falhou'}` };
    } else {
      this.shell.detach('ollama', ['serve']);
    }
    const until = Date.now() + WAIT_MS;
    let now = await this.state();
    while (!now.disponivel && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1_000));
      now = await this.state();
    }
    return now.disponivel ? now : { ...now, dica: 'Liguei, mas ele ainda não respondeu em 30 s. Veja `podman logs ollama`.' };
  }
}
