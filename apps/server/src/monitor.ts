import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { SYSTEM } from '@owl/board';
import type { createRepos, Ticket } from '@owl/db';
import { z } from 'zod';
import type { BoardFlow } from './board-flow.js';
import type { RouterService } from './router.js';
import { triage } from './triage.js';
import type { LocalBoard } from '@owl/board';

type Repos = ReturnType<typeof createRepos>;

const KEY = 'monitor';
const STATE_KEY = 'monitor_estado';
const MAX_NOTICES = 30;
const MAX_ACTIVITY = 40;
/** Tickets the monitor touched wear this label, so the board shows where it has been. */
export const MONITOR_LABEL = 'monitor';
/** A run this old with no end is reported (the executor has its own idle limit; this is the person-facing alarm). */
const STALE_MS = 45 * 60_000;
/** A ticket whose runs failed this many times is left for a person: retrying by itself would only burn tokens. */
const MAX_FAILED_RUNS = 2;
const CYCLE_DAYS = 14;
const LABEL_COLORS: Record<string, string> = { frontend: '#6d8cff', backend: '#4fb286', banco: '#d49a3a', núcleo: '#a78bfa', memória: '#e08aa8', roteador: '#5ab4c5', ollama: '#9aa86a', segurança: '#e5605a', docs: '#8b8b99', testes: '#c7a14a' };
/** Title of the ticket the monitor opens when it sits idle; the triage and the starter leave it alone. */
export const IDLE_TITLE = 'Monitor ocioso: autorizar para prosseguir';
const TASK = 'Trabalhe neste ticket conforme a descrição e os critérios de aceite.';

export interface PlanUsage {
  /** Share (0..1) of the current session and of the week, as `claude -p /usage` prints them. */
  sessao: number;
  semana: number;
}

/** Reads "Current session: 40% used" and "Current week (all models): 61% used"; undefined when the text has another shape. */
export function parsePlanUsage(text: string): PlanUsage | undefined {
  const pct = (re: RegExp) => {
    const m = re.exec(text);
    return m ? Number(m[1]) / 100 : undefined;
  };
  const sessao = pct(/Current session:\s*(\d{1,3})%/i);
  const semana = pct(/Current week \(all models\):\s*(\d{1,3})%/i);
  return sessao === undefined || semana === undefined ? undefined : { sessao, semana };
}

/** `claude -p /usage` is answered by the CLI itself: it spends no tokens. */
export function readPlanUsage(): Promise<PlanUsage | undefined> {
  return new Promise((resolve) => {
    const child = execFile(process.env.OWL_CLAUDE_BIN || 'claude', ['-p', '/usage'], { cwd: tmpdir(), timeout: 30_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      resolve(err ? undefined : parsePlanUsage(stdout));
    });
    child.stdin?.end(); // otherwise the CLI waits 3 s for input that never comes
  });
}

export const monitorSchema = z.strictObject({
  /** The kill switch: off, the monitor starts nothing (it may still be asked for a status). */
  ativo: z.boolean(),
  intervaloMin: z.number().int().min(1).max(120),
  /** Fill in missing labels, priority, estimate, assignee and cycle of backlog tickets (never overwrites what is set). */
  triagem: z.boolean(),
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
export const DEFAULT_MONITOR: MonitorConfig = { ativo: false, intervaloMin: 5, triagem: true, avisoPct: 0.7, paradaPct: 0.9, maxPortoesPendentes: 3, projetos: [] };
export const monitorPatchSchema = monitorSchema.partial();

export interface MonitorNotice {
  em: string;
  nivel: 'aviso' | 'parada' | 'info';
  texto: string;
}
export interface MonitorActivity {
  em: string;
  projeto: string;
  /** Ticket identifier, or null for a note about the whole project. */
  ticket: string | null;
  acao: string;
}
interface MonitorState {
  /** Where the monitor looked last (project, ticket, what it did), kept after the cycle ends. */
  olhando: MonitorActivity | null;
  atividade: MonitorActivity[];
  planoLidoEm: string | null;
  planoErro: string | null;
  ultimoCiclo: string | null;
  parado: string | null;
  /** Projects where a person authorized the monitor to go on despite a full queue of gates. */
  autorizados: string[];
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
  /** How the plan's usage is read; defaults to `claude -p /usage`. */
  planUsage?: () => Promise<PlanUsage | undefined>;
}

/**
 * Watches the board without a model: it costs no tokens. Each cycle it warns about stuck runs and the daily budget,
 * and, while the kill switch is on and the budget and the queue of gates allow, starts the next ticket that is ready.
 * It never decides a gate: those stay with a person.
 */
export class Monitor {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private plan: PlanUsage | undefined;

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
    return { olhando: null, atividade: [], planoLidoEm: null, planoErro: null, ultimoCiclo: null, parado: null, autorizados: [], avisoDia: null, avisos: [], iniciados: 0, ...((this.deps.repos.settings.get(STATE_KEY) as Partial<MonitorState> | undefined) ?? {}) };
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

  private see(projeto: string, ticket: string | null, acao: string, now: Date): void {
    const a: MonitorActivity = { em: stamp(now), projeto, ticket, acao };
    this.setState({ olhando: a, atividade: [a, ...this.state().atividade].slice(0, MAX_ACTIVITY) });
  }

  /** Marks the ticket as touched by the monitor (a project label, created on first use). */
  private tag(projectId: string, ticketId: string): void {
    const { repos, board } = this.deps;
    const label = repos.quadro.labels.byName(projectId, MONITOR_LABEL) ?? board.createLabel(projectId, MONITOR_LABEL, '#e0a43a');
    board.addLabel(ticketId, label.id, SYSTEM);
  }

  status() {
    return { config: this.config(), estado: this.state(), plano: this.plan ?? null, dia: this.deps.router.dayUsage(this.deps.now?.() ?? new Date()), rodando: this.timer !== undefined };
  }

  /** Starts the periodic cycle (the server does, tests call `tick`). */
  start(): void {
    this.schedule();
    // The first reading should not wait a whole interval: the status shows the plan right after the server starts.
    void this.tick().catch((e: unknown) => console.error('owl monitor failed', e instanceof Error ? e.message : e));
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
      this.plan = await (this.deps.planUsage ?? readPlanUsage)();
      const at = stamp(this.deps.now?.() ?? new Date());
      this.setState(this.plan ? { planoLidoEm: at, planoErro: null } : { planoErro: `Não consegui ler \`claude -p /usage\` às ${at}` });
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
    const plan = this.plan;
    // The plan is what really limits the person; the token budget is an optional extra ceiling.
    const planPct = plan ? Math.max(plan.sessao, plan.semana) : undefined;
    const state = this.state();
    if (planPct !== undefined && planPct >= cfg.avisoPct && state.avisoDia !== localDay(now)) {
      this.notice('aviso', `Plano do Claude em ${Math.floor(planPct * 100)}% (sessão ${Math.floor(plan!.sessao * 100)}%, semana ${Math.floor(plan!.semana * 100)}%).`);
      this.setState({ avisoDia: localDay(now) });
    } else if (usage.percentual !== null && usage.percentual >= cfg.avisoPct && state.avisoDia !== localDay(now)) {
      this.notice('aviso', `Uso do dia em ${Math.floor(usage.percentual * 100)}% do orçamento (${usage.usado} de ${usage.limite} tokens).`);
      this.setState({ avisoDia: localDay(now) });
    }

    const projects = repos.projects.list().filter((p) => cfg.projetos.length === 0 || cfg.projetos.includes(p.id));
    for (const project of projects) {
      let tickets = repos.tickets.list(project.id);
      if (cfg.ativo) this.see(project.nome, null, `examinando ${tickets.filter((t) => t.status === 'backlog' || t.status === 'pronto').length} ticket(s) do backlog`, now);
      for (const t of tickets) {
        for (const r of repos.tickets.runs(t.id)) {
          if (r.status === 'rodando' && now.getTime() - parseDb(r.inicio) > STALE_MS) {
            const key = `${t.identificador}:${r.id}`;
            if (!this.state().avisos.some((a) => a.texto.includes(key))) this.notice('aviso', `Execução parada há mais de 45 min em ${key}.`);
          }
        }
      }
      if (!cfg.ativo) continue;
      if (this.releaseBlocked(project.nome, tickets, now)) tickets = repos.tickets.list(project.id);
      if (cfg.triagem) {
        this.triageProject(project.id, tickets, now);
        tickets = repos.tickets.list(project.id); // the triage changed assignees and cycles
      }

      // Without a reading of the plan, only an explicit token budget can vouch for it; with neither, nothing starts.
      if (planPct === undefined && usage.limite === null) {
        if (this.state().parado !== 'sem medida de uso') this.stopAuto('sem medida de uso', 'Monitor parado: não consegui ler o uso do plano (`claude -p /usage`) e não há orçamento diário definido.');
        continue;
      }
      if (planPct !== undefined && planPct >= cfg.paradaPct) {
        if (!this.state().parado) this.stopAuto('plano', `Monitor parado: plano do Claude em ${Math.floor(planPct * 100)}%, acima de ${Math.floor(cfg.paradaPct * 100)}%. Religa sozinho quando a sessão renovar ou quando você reativar.`);
        continue;
      }
      if (usage.percentual !== null && usage.percentual >= cfg.paradaPct) {
        if (!this.state().parado) this.stopAuto('orçamento', `Monitor parado: uso do dia em ${Math.floor(usage.percentual * 100)}% do orçamento de tokens, acima de ${Math.floor(cfg.paradaPct * 100)}%.`);
        continue;
      }
      if (this.state().parado) this.setState({ parado: null });

      const gates = repos.approvals.pendingByProject(project.id).length;
      const idleTicket = tickets.find((t) => t.titulo === IDLE_TITLE && t.status !== 'concluido');
      const authorized = this.state().autorizados.includes(project.id);
      const live = tickets.filter((t) => repos.tickets.runs(t.id).some((r) => r.status === 'rodando')).length;
      const working = live > 0 || tickets.some((t) => t.status === 'em_andamento' || t.status === 'em_revisao');
      // A person answered the idle ticket (moved it on): that is the authorization to go on past a full queue of gates.
      if (idleTicket && idleTicket.status !== 'bloqueado' && !authorized) {
        this.setState({ autorizados: [...this.state().autorizados, project.id] });
        this.see(project.nome, idleTicket.identificador, 'autorizado por você a prosseguir', now);
      }
      if (working) this.retract(project.id, now); // activity is back: the ticket is no longer needed
      const go = this.state().autorizados.includes(project.id);
      if (gates >= cfg.maxPortoesPendentes && !go) {
        this.see(project.nome, null, `não inicia nada: ${gates} portão(ões) esperando você`, now);
        if (!working) this.askToProceed(project.id, tickets, `${gates} portão(ões) esperando decisão`, now);
        continue;
      }
      const room = (repos.projects.get(project.id)?.maxConcorrencia ?? 1) - live;
      if (room <= 0) {
        this.see(project.nome, null, 'não inicia nada: limite de execuções simultâneas do projeto', now);
        continue;
      }

      const ready = tickets
        .filter((t) => (t.status === 'pronto' || t.status === 'backlog') && t.responsavel && t.titulo !== IDLE_TITLE)
        .filter((t) => repos.approvals.pendingByTicket(t.id).length === 0)
        .filter((t) => board.openBlockers(t.id).length === 0)
        .filter((t) => repos.tickets.runs(t.id).filter((r) => r.status === 'erro').length < MAX_FAILED_RUNS)
        .filter((t) => !repos.tickets.runs(t.id).some((r) => r.status === 'rodando'))
        .sort((a, b) => b.prioridade - a.prioridade || a.ordem - b.ordem);
      if (ready.length === 0 && !working) this.askToProceed(project.id, tickets, 'nenhum ticket livre para iniciar (todos bloqueados, com erro repetido ou sem responsável)', now);
      for (const t of ready.slice(0, room)) {
        if (router.overDaily(0, now)) break;
        const run = flow.run(t.id, t.responsavel!, TASK);
        if (run) {
          started.push(t.identificador);
          this.retract(project.id, now);
          this.tag(project.id, t.id);
          this.see(project.nome, t.identificador, `iniciou ${t.responsavel}`, now);
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

  /** Fills only what is empty, and says so in each ticket's history. */
  private triageProject(projectId: string, tickets: Ticket[], now: Date): void {
    const { repos, board } = this.deps;
    const open = tickets.filter((t) => (t.status === 'backlog' || t.status === 'pronto') && t.titulo !== IDLE_TITLE);
    if (open.length === 0) return;
    const today = localDay(now);
    let cycle = repos.quadro.cycles.list(projectId).find((c) => c.inicio <= today && today <= c.fim);
    let touched = 0;
    for (const t of open) {
      const changes: string[] = [];
      const plan = triage(t);
      if (t.prioridade === 0) {
        repos.tickets.update(t.id, { prioridade: plan.prioridade });
        changes.push(`prioridade ${plan.prioridade}`);
      }
      if (t.estimativa === null) {
        repos.tickets.update(t.id, { estimativa: plan.estimativa });
        changes.push(`estimativa ${plan.estimativa}`);
      }
      if (!t.responsavelAgentId) {
        const agent = repos.agents.byName(plan.agente);
        if (agent) {
          board.assign(t.id, agent.id, SYSTEM);
          changes.push(`responsável ${plan.agente}`);
        }
      }
      if (repos.quadro.labels.ofTicket(t.id).filter((l) => l.nome !== MONITOR_LABEL).length === 0) {
        for (const nome of plan.etiquetas) {
          const label = repos.quadro.labels.byName(projectId, nome) ?? board.createLabel(projectId, nome, LABEL_COLORS[nome] ?? '#8b8b99');
          board.addLabel(t.id, label.id, SYSTEM);
          changes.push(`#${nome}`);
        }
      }
      if (!t.cicloId) {
        cycle ??= board.createCycle(projectId, { inicio: today, fim: localDay(new Date(now.getTime() + (CYCLE_DAYS - 1) * 86_400_000)) });
        board.assignCycle(t.id, cycle.id, SYSTEM);
        changes.push(`Ciclo ${cycle.numero}`);
      }
      if (changes.length) {
        touched++;
        this.tag(projectId, t.id);
        this.see(repos.projects.get(projectId)?.nome ?? projectId, t.identificador, `triagem: ${changes.join(', ')}`, now);
        repos.tickets.addEvent({ ticketId: t.id, ator: SYSTEM, tipo: 'aviso', detalhe: `Triagem do monitor: ${changes.join(', ')}` });
      }
    }
    if (touched) this.notice('info', `Triagem: ${touched} ticket(s) completados com etiquetas, prioridade, estimativa, responsável e ciclo.`);
  }

  /**
   * A ticket parked in "bloqueado" only because an earlier run was refused for open blockers goes back to "pronto" once
   * none is left. Any other reason (agent missing, tool refused, server restart) stays with a person.
   */
  private releaseBlocked(projeto: string, tickets: Ticket[], now: Date): boolean {
    const { repos, board } = this.deps;
    let moved = false;
    for (const t of tickets) {
      if (t.status !== 'bloqueado' || t.titulo === IDLE_TITLE || !t.responsavelAgentId) continue;
      const last = repos.tickets.comments(t.id).at(-1);
      if (!last || last.autor !== SYSTEM.nome || !/^Falha ao executar .*bloqueado por /.test(last.texto)) continue;
      if (board.openBlockers(t.id).length > 0 || repos.approvals.pendingByTicket(t.id).length > 0) continue;
      board.updateStatus(t.id, 'pronto', SYSTEM, { comentario: 'Os bloqueadores terminaram: o monitor devolveu o ticket para Pronto.' });
      this.see(projeto, t.identificador, 'devolveu para Pronto: bloqueadores terminaram', now);
      moved = true;
    }
    return moved;
  }

  /** Opens (once) the ticket that asks a person to let the monitor go on, so it never sits idle without anyone knowing. */
  private askToProceed(projectId: string, tickets: Ticket[], motivo: string, now: Date): void {
    const { repos, board } = this.deps;
    const project = repos.projects.get(projectId)?.nome ?? projectId;
    const pending = repos.approvals.pendingByProject(projectId);
    const lista = pending.slice(0, 10).map((a) => `- ${a.ticketIdentificador}: ${a.ticketTitulo}`).join('\n');
    const existing = tickets.find((t) => t.titulo === IDLE_TITLE && t.status !== 'concluido');
    if (existing) return;
    // Idle with nothing left to do is just done: only ask while open work waits.
    if (!tickets.some((t) => t.titulo !== IDLE_TITLE && ['backlog', 'pronto', 'bloqueado', 'aguardando_aprovacao'].includes(t.status))) return;
    const t = board.createTicket(
      {
        projectId,
        titulo: IDLE_TITLE,
        descricao: `Nada está em andamento: ${motivo}.\n\n${lista ? `Esperando você:\n${lista}\n\n` : ''}**Para prosseguir:** decida os portões acima, ou mova este ticket para "Pronto" para autorizar o monitor a seguir mesmo com portões abertos. Se algo voltar a andar, o monitor retira este ticket sozinho.`,
        status: 'bloqueado',
      },
      SYSTEM,
    );
    this.tag(projectId, t.id);
    this.see(project, t.identificador, `abriu ticket pedindo autorização: ${motivo}`, now);
    this.notice('aviso', `Monitor ocioso em ${project}: ${motivo}. Abri ${t.identificador} pedindo autorização.`);
  }

  /** Removes the idle ticket (and the authorization it carried) once the monitor has work again. */
  private retract(projectId: string, now: Date): void {
    const { repos } = this.deps;
    const idle = repos.tickets.list(projectId).find((t) => t.titulo === IDLE_TITLE);
    if (idle) {
      repos.tickets.delete(idle.id);
      this.see(repos.projects.get(projectId)?.nome ?? projectId, idle.identificador, 'retirou o ticket de autorização: voltou a ter atividade', now);
    }
    if (this.state().autorizados.includes(projectId)) this.setState({ autorizados: this.state().autorizados.filter((p) => p !== projectId) });
  }

  private stopAuto(motivo: string, texto: string): void {
    this.setState({ parado: motivo });
    this.notice('parada', texto);
  }
}
