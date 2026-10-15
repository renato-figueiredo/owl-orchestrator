/** The part of the Ollama adapter this needs (so tests can pass a fake). */
export interface LocalProbe {
  isAvailable(): Promise<boolean>;
  listModels(): Promise<Array<{ name: string }>>;
}

export interface LocalSnapshot {
  disponivel: boolean;
  modelos: string[];
}

/**
 * Last known state of the local model server (Ollama). The router decides synchronously, so it reads this snapshot; the
 * server refreshes it at startup and every `intervalMs`, and the settings screen refreshes it on demand. A server that
 * is down simply means "not available": nothing here throws.
 */
export class LocalModels {
  private state: LocalSnapshot = { disponivel: false, modelos: [] };
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly probe: LocalProbe,
    private readonly fallbackModel?: string,
  ) {}

  snapshot(): LocalSnapshot {
    return { disponivel: this.state.disponivel, modelos: [...this.state.modelos] };
  }

  async refresh(): Promise<LocalSnapshot> {
    try {
      const up = await this.probe.isAvailable();
      this.state = up ? { disponivel: true, modelos: (await this.probe.listModels()).map((m) => m.name) } : { disponivel: false, modelos: [] };
    } catch {
      this.state = { disponivel: false, modelos: [] };
    }
    return this.snapshot();
  }

  /** Refreshes now and then every `intervalMs` until `stop()`. */
  start(intervalMs = 30_000): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The model to use now: the wanted one if installed, else `OLLAMA_MODEL` if installed, else the first installed; undefined when the server is down or has none. */
  pick(wanted?: string): string | undefined {
    const { disponivel, modelos } = this.state;
    if (!disponivel || modelos.length === 0) return undefined;
    for (const m of [wanted, this.fallbackModel]) if (m && modelos.includes(m)) return m;
    return modelos[0];
  }
}
