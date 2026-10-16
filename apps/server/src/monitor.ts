import { SYSTEM } from '@owl/board';
import type { createRepos } from '@owl/db';
import { z } from 'zod';
import type { BoardFlow } from './board-flow.js';
import type { RouterService } from './router.js';
import type { LocalBoard } from '@owl/board';

type Repos = ReturnType<typeof createRepos>;

const KEY = 'monitor';
const STATE_KEY = 'monitor_estado';
const MAX_NOTICES = 30;
/** A run this old with no end is reported (the executor has its own idle limit; this is the person-facing alarm). */
const STALE_MS = 45 * 60_000;
/** A ticket whose runs failed this many times is left for a person: retrying by itself would only burn tokens. */
const MAX_FAILED_RUNS = 2;
const TASK = 'Trabalhe neste ticket conforme a descrição e os critérios de aceite.';

export const monitorSchema = z.strictObject({
  /** The kill switch: off, the monitor starts nothing (it may still be asked for a status). */
  ativo: z.boolean(),
  intervaloMin: z.number().int().min(1).max(120),
  /** Share of the daily budget at which a warning is raised (the board keeps working). */
  avisoPct: z.number().min(0.1).max(1),
  /** Share of the daily budget at which the monitor stops starting tickets by itself. */
  paradaPct: z.number().min(0.1).max(1),
  /** Gates waiting for a person; at this many the monitor stops starting work (a person is the bottleneck). */
  maxPortoesPendentes: z.number().int().min(1).max(50),
  /** Project ids; empty means every project. */
  projetos: z.array(z.string()).max(100),
});
export type MonitorConfig = z.infer<typeof monitorSchema>;
export const DEFAULT_MONITOR: MonitorConfig = { ativo: false, intervaloMin: 5, avisoPct: 0.7, paradaPct: 0.9, maxPortoesPendentes: 3, projetos: [] };
export const monitorPatchSchema = monitorSchema.partial();

export interface MonitorNotice {
  em: string;
  nivel: 'aviso' | 'parada' | 'info';
  texto: string;
}
interface MonitorState {
  ultimoCiclo: string | null;
  parado: string | null;
  avisoDia: string | null;
  avisos: MonitorNotice[];
  iniciados: number;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const parseDb = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`);

export interface MonitorDeps {
  repos: Repos;
  board: LocalBoard;
  flow: BoardFlow;
  router: RouterService;
  now?: () => Date;
}

/**
 * Watches the board without a model: it costs no tokens. Each cycle it warns about stuck runs and the daily budget,
 * and, while the kill switch is on and the budget and the queue of gates allow, starts the next ticket that is ready.
 * It never decides a gate: those stay with a person.
 */
export class Monitor {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly deps: MonitorDeps) {}

  config(): MonitorConfig {
    const parsed = monitorSchema.safeParse({ ...DEFAULT_MONITOR, ...((this.deps.repos.settings.get(KEY) as object | undefined) ?? {}) });
    return parsed.success ? parsed.data : DEFAULT_MONITOR;
  }

  save(patch: { [K in keyof MonitorConfig]?: MonitorConfig[K] | undefined }): MonitorConfig {
    const next = monitorSchema.parse({ ...this.config(), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    if (next.paradaPct < next.avisoPct) throw new Error('paradaPct must not be below avisoPct');
    this.deps.repos.settings.set(KEY, next);
    if (patch.ativo === true) this.setState({ parado: null });
    if (this.timer) this.schedule();
    return next;
  }

  private state(): MonitorState {
    return { ultimoCiclo: null, parado: null, avisoDia: null, avisos: [], iniciados: 0, ...((this.deps.repos.settings.get(STATE_KEY) as Partial<MonitorState> | undefined) ?? {}) };
  }

  private setState(patch: Partial<MonitorState>): MonitorState {
    const next = { ...this.state(), ...patch };
    this.deps.repos.settings.set(STATE_KEY, next);
    return next;
  }

  private notice(nivel: MonitorNotice['nivel'], texto: string): void {
    const now = this.deps.now?.() ?? new Date();
    this.setState({ avisos: [{ em: stamp(now), nivel, texto }, ...this.state().avisos].slice(0, MAX_NOTICES) });
  }

  status() {
    return { config: this.config(), estado: this.state(), dia: this.deps.router.dayUsage(this.deps.now?.() ?? new Date()), rodando: this.timer !== undefined };
  }

  /** Starts the periodic cycle (the server does, tests call `tick`). */
  start(): void {
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick().catch((e: unknown) => console.error('owl monitor failed', e instanceof Error ? e.message : e)), this.config().intervaloMin * 60_000);
    this.timer.unref();
  }

  /** One cycle. Returns the tickets it started. */
  async tick(): Promise<string[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      return this.cycle();
    } finally {
      this.busy = false;
    }
  }

  private cycle(): string[] {
    const { repos, board, flow, router } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const cfg = this.config();
    this.setState({ ultimoCiclo: stamp(now) });
    const started: string[] = [];

    const usage = router.dayUsage(now);
    const state = this.state();
    if (usage.percentual !== null && usage.percentual >= cfg.avisoPct && state.avisoDia !== localDay(now)) {
      this.notice('aviso', `Uso do dia em ${Math.floor(usage.percentual * 100)}% do orçamento (${usage.usado} de ${usage.limite} tokens).`);
      this.setState({ avisoDia: localDay(now) });
    }

    const projects = repos.projects.list().filter((p) => cfg.projetos.length === 0 || cfg.projetos.includes(p.id));
    for (const project of projects) {
      const tickets = repos.tickets.list(project.id);
      for (const t of tickets) {
        for (const r of repos.tickets.runs(t.id)) {
          if (r.status === 'rodando' && now.getTime() - parseDb(r.inicio) > STALE_MS) {
            const key = `${t.identificador}:${r.id}`;
            if (!this.state().avisos.some((a) => a.texto.includes(key))) this.notice('aviso', `Execução parada há mais de 45 min em ${key}.`);
          }
        }
      }
      if (!cfg.ativo) continue;

      if (usage.limite === null) {
        if (this.state().parado !== 'sem orçamento diário') this.stopAuto('sem orçamento diário', 'Monitor parado: defina o orçamento diário do roteador para ele iniciar tickets sozinho.');
        continue;
      }
      if (usage.percentual !== null && usage.percentual >= cfg.paradaPct) {
        if (!this.state().parado) this.stopAuto('orçamento', `Monitor parado: uso do dia em ${Math.floor(usage.percentual * 100)}%, acima de ${Math.floor(cfg.paradaPct * 100)}%. Religa sozinho amanhã ou quando você reativar.`);
        continue;
      }
      if (this.state().parado === 'orçamento' || this.state().parado === 'sem orçamento diário') this.setState({ parado: null });

      const gates = repos.approvals.pendingByProject(project.id).length;
      if (gates >= cfg.maxPortoesPendentes) continue;
      const live = tickets.filter((t) => repos.tickets.runs(t.id).some((r) => r.status === 'rodando')).length;
      const room = (repos.projects.get(project.id)?.maxConcorrencia ?? 1) - live;
      if (room <= 0) continue;

      const ready = tickets
        .filter((t) => (t.status === 'pronto' || t.status === 'backlog') && t.responsavel)
        .filter((t) => repos.approvals.pendingByTicket(t.id).length === 0)
        .filter((t) => board.openBlockers(t.id).length === 0)
        .filter((t) => repos.tickets.runs(t.id).filter((r) => r.status === 'erro').length < MAX_FAILED_RUNS)
        .filter((t) => !repos.tickets.runs(t.id).some((r) => r.status === 'rodando'))
        .sort((a, b) => b.prioridade - a.prioridade || a.ordem - b.ordem);
      for (const t of ready.slice(0, room)) {
        if (router.overDaily(0, now)) break;
        const run = flow.run(t.id, t.responsavel!, TASK);
        if (run) {
          started.push(t.identificador);
          repos.tickets.addEvent({ ticketId: t.id, ator: SYSTEM, tipo: 'aviso', detalhe: 'Iniciado pelo monitor' });
        }
      }
    }
    if (started.length) {
      this.setState({ iniciados: this.state().iniciados + started.length });
      this.notice('info', `Iniciou: ${started.join(', ')}.`);
    }
    return started;
  }

  private stopAuto(motivo: string, texto: string): void {
    this.setState({ parado: motivo });
    this.notice('parada', texto);
  }
}
