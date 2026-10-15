import { agentActor, BoardError, type Decision, HUMAN, LocalBoard, SYSTEM, ticketBrief, ticketContext, estimateTokens } from '@owl/board';
import { analyzeTools, CLASSIFIER_PROMPT, complexityOf, fromClassification, needsApproval, routeByRules, withEscalation, type AgentDefinition, type RouteDecision, type Tier } from '@owl/core';
import type { Actor, createRepos, Project, Run, Ticket } from '@owl/db';
import { z } from 'zod';
import type { Executor, StepOutcome } from './executor.js';
import type { Library } from './library.js';
import { WARN_AT, type RouterService } from './router.js';
import { WorktreeError, type WorktreeService } from './worktrees.js';

type Repos = ReturnType<typeof createRepos>;

/** Tokens the facts and the summary may take in an agent's prompt. */
const CONTEXT_TOKENS = 1500;
/** Rough size of an answer, added to the prompt when checking the ticket's token ceiling. */
const EXPECTED_OUTPUT_TOKENS = 2000;
const MAX_SUBTASKS = 8;
const TIER_NAMES = new Set<string>(['pequeno', 'medio', 'forte']);
/** Roles that do not take over the ticket: it stays in its column while they work. */
const STAYS = new Set(['po', 'techlead', 'qa', 'revisor', 'memoria']);

const poOutput = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(20_000).optional(),
  criterios_aceite: z.union([z.string(), z.array(z.string())]).optional(),
});
const leadOutput = z.object({
  subtarefas: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(200),
        descricao: z.string().trim().max(20_000).optional(),
        criterios_aceite: z.union([z.string(), z.array(z.string())]).optional(),
        agente: z.string().max(64).optional(),
      }),
    )
    .min(1)
    .max(MAX_SUBTASKS),
});

const bullets = (v: string | string[] | undefined): string | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v.map((x) => `- ${x.replace(/^[-*]\s*/, '')}`).join('\n') : v;

/** The last fenced ```json block, else the outermost {...} of the text. Undefined when neither parses. */
export function extractJson(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1] ?? '');
  const candidates = [...fences.reverse()];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

/** "VEREDITO: aprovado|reprovado" (any case, accents optional). Undefined when the agent did not say. */
export function parseVerdict(text: string): 'aprovado' | 'reprovado' | undefined {
  const m = [...text.matchAll(/veredito\s*[:\-]\s*\**\s*(aprovad[oa]|reprovad[oa])/gi)].pop();
  if (!m?.[1]) return undefined;
  return m[1].toLowerCase().startsWith('aprov') ? 'aprovado' : 'reprovado';
}

/** Summary and facts out of the memory agent's answer ("1. Resumo ... 2. Fatos ..."). */
export function parseMemoryOutput(text: string): { resumo: string; fatos: string[] } {
  const at = text.search(/^[^\w\n]*(\d+\.\s*)?\**fatos\**[ \t]*:?/im);
  const head = at >= 0 ? text.slice(0, at) : text;
  const tail = at >= 0 ? text.slice(at).split('\n').slice(1).join('\n') : '';
  const resumo = head.replace(/^[^\w\n]*(\d+\.\s*)?\**resumo\**[ \t]*:?\s*/i, '').trim();
  const fatos = tail
    .split('\n')
    .map((l) => l.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/)?.[1])
    .filter((l): l is string => Boolean(l))
    .map((l) => l.replace(/\*\*/g, '').slice(0, 200))
    .slice(0, 10);
  return { resumo: resumo.slice(0, 4000), fatos };
}

export interface BoardFlowDeps {
  repos: Repos;
  executor: Executor;
  library: Library;
  board: LocalBoard;
  /** One git worktree per development ticket; agents that write only run inside one. */
  worktrees: WorktreeService;
  /** Tiers, confidence threshold and daily budget (prompt 15). */
  router: RouterService;
  /** Working folder of a project's runs (already checked against the allowed roots). */
  cwdOf: (project: Project) => string;
  /** Agent names of the example flow (override to use other ones). */
  agentes?: Partial<Record<'po' | 'techlead' | 'memoria' | 'qa' | 'dev', string>>;
}

const MEMORY_TASK = 'Resuma o que foi decidido e entregue neste ticket e liste os fatos duráveis.';
const QA_TASK = 'Verifique a entrega contra os critérios de aceite, um a um. Termine com uma linha "VEREDITO: aprovado" ou "VEREDITO: reprovado" e o motivo.';

/**
 * `force`: an approved cost gate lets this step past the budgets. `tier`: a person approved this tier (gate `confianca`).
 * `decision`: the router already decided (the classifier answered), so it is not asked again.
 */
interface RunOptions {
  force?: boolean;
  /** A person chose to run a ticket that other tickets still block. */
  ignorarBloqueio?: boolean;
  tier?: Tier;
  decision?: RouteDecision;
}

type Role = 'po' | 'techlead' | 'dev' | 'qa' | 'revisor' | 'memoria' | string;

/**
 * Drives agents over tickets. State lives in the database (ticket status, gates, comments), not in memory: each agent
 * result is handled by what the ticket and the agent's role say, so a restart only loses the run in flight (the ticket
 * is then `bloqueado` and a person can run it again). Nothing here moves a ticket the rules do not allow an agent to
 * move: the gates are in `LocalBoard`.
 *
 * Example flow: objective → `po` writes the ticket → `tech-lead` splits it → `dev-*` execute each sub-task → `qa`
 * verifies → delivery gate (person approves) → `memoria` summarizes and records facts.
 */
export class BoardFlow {
  private readonly names: Required<NonNullable<BoardFlowDeps['agentes']>>;

  constructor(private readonly deps: BoardFlowDeps) {
    this.names = { po: 'po', techlead: 'tech-lead', memoria: 'memoria', qa: 'qa', dev: 'dev-back', ...deps.agentes };
  }

  /** Creates the goal ticket and hands it to the product owner. */
  startGoal(project: Project, objetivo: string): { ticket: Ticket; run: Run | undefined } {
    const ticket = this.deps.board.createTicket({ projectId: project.id, titulo: objetivo.slice(0, 200), descricao: objetivo, status: 'backlog' }, HUMAN);
    return { ticket, run: this.run(ticket.id, this.names.po, 'Transforme este objetivo em um ticket claro, com critérios de aceite verificáveis.') };
  }

  /**
   * Runs `agente` on a ticket with `tarefa`. Returns undefined when a gate stopped it (ceiling exceeded: a person
   * decides) or the agent cannot run (the reason becomes a comment and the ticket is blocked).
   */
  run(ticketId: string, agente: string, tarefa: string, opts: RunOptions = {}): Run | undefined {
    const { repos, board } = this.deps;
    const ticket = this.need(ticketId);
    const project = repos.projects.get(ticket.projectId)!;
    let def: AgentDefinition;
    let systemAppend: string;
    try {
      def = this.deps.library.agent(agente);
      systemAppend = this.deps.library.systemPrompt(def);
    } catch (e) {
      this.fail(ticket, agente, e instanceof Error ? e.message : String(e));
      return undefined;
    }
    this.deps.library.sync();
    const agentRow = repos.agents.byName(agente);

    // Once a project has a team, only its members work on its tickets; the team role can differ from the agent's own.
    let teamRole: string | null = null;
    if (repos.teams.hasRoster(project.id)) {
      const mine = agentRow ? repos.teams.membershipsInProject(project.id, agentRow.id) : [];
      if (mine.length === 0) {
        this.fail(ticket, agente, `"${agente}" não está em nenhuma equipe do projeto ${project.nome}; adicione-o na tela da equipe ou use outro agente`);
        return undefined;
      }
      teamRole = mine.find((m) => m.papel)?.papel ?? null;
    }

    // Tools: reading is free, anything that writes or runs commands happens only inside the ticket's worktree.
    const tools = analyzeTools(def.ferramentas);
    if (tools.problems.length) {
      this.fail(ticket, agente, `ferramentas do agente não são permitidas: ${tools.problems.join('; ')}`);
      return undefined;
    }
    // A ticket that other tickets still block does not start by itself; a person can run it anyway (`force`).
    const open = opts.ignorarBloqueio || agente === this.names.memoria ? [] : board.openBlockers(ticketId);
    if (open.length) {
      this.fail(ticket, agente, `bloqueado por ${open.map((b) => `${b.identificador} (${b.status})`).join(', ')}; termine-o antes ou rode ignorando o bloqueio`);
      return undefined;
    }
    const projectCwd = this.deps.cwdOf(project);
    let cwd = projectCwd;
    if (tools.writes) {
      try {
        cwd = this.deps.worktrees.ensure(ticket, project);
      } catch (e) {
        if (!(e instanceof WorktreeError)) throw e;
        this.fail(ticket, agente, e.message);
        return undefined;
      }
    } else {
      // Reviewers and QA look at the developer's work, so they run where it is.
      cwd = this.deps.worktrees.existingCwd(ticket, project) ?? projectCwd;
    }

    const parent = ticket.parentId ? (repos.tickets.get(ticket.parentId) ?? null) : null;
    const brief = ticketBrief({ ticket, comments: repos.tickets.comments(ticketId), parent, children: repos.tickets.children(ticketId), tarefa });
    // What the project knows, then what THIS agent remembers in THIS project (never its memory in another project).
    const facts = [
      ...repos.facts.listScope({ projectId: project.id, apenasFixados: true }).map((f) => f.texto),
      ...(agentRow ? repos.facts.listAgent({ projectId: project.id, agentId: agentRow.id, apenasFixados: true }).map((f) => f.texto) : []),
    ];
    const memory = ticketContext({ fatos: facts, resumo: ticket.resumo ?? parent?.resumo, orcamentoTokens: CONTEXT_TOKENS });
    const texto = `${memory}${brief}`;

    const estimate = estimateTokens(texto + systemAppend) + EXPECTED_OUTPUT_TOKENS;
    const resume = { agente, tarefa, statusAnterior: ticket.status === 'aguardando_aprovacao' ? 'em_andamento' : ticket.status };
    if (!opts.force && board.overBudget(ticketId, estimate)) {
      const u = repos.tickets.usage(ticketId);
      board.requestGate(
        ticketId,
        {
          tipo: 'custo',
          motivo: `Custo acima do teto do ticket: ${u.tokensIn + u.tokensOut} de ${ticket.orcamentoTokens} tokens já usados; o próximo passo (${agente}) passaria do limite`,
          retomar: resume,
        },
        agentActor(agente),
      );
      return undefined;
    }
    if (!opts.force && this.deps.router.overDaily(estimate)) {
      const d = this.deps.router.dayUsage();
      board.requestGate(
        ticketId,
        {
          tipo: 'custo',
          motivo: `Orçamento diário estourado: ${d.usado} de ${d.limite} tokens usados hoje; o próximo passo (${agente}) passaria do limite`,
          retomar: resume,
        },
        agentActor(agente),
      );
      return undefined;
    }

    const role = teamRole ?? def.papel ?? '';
    // Tier routing: only for agents that ask for it (`roteamento: auto`); the others always run on their own provider.
    let provider = def.provedor;
    let model = def.modelo;
    let routing: { complexidade: string; tier: string; detalhe: Record<string, unknown> } | undefined;
    if (def.roteamento === 'auto') {
      const routed = this.route({ ticket, project, role, agente, tarefa, opts, cwd: projectCwd, falhas: this.deps.router.failures(ticketId) });
      if ('done' in routed) return routed.done;
      const d = routed.decision;
      const t = this.deps.router.target(d.tier, { semFerramentas: def.ferramentas.length === 0 });
      provider = t.provedor;
      model = t.modelo;
      routing = { complexidade: d.complexidade, tier: d.tier, detalhe: { origem: d.origem, motivo: d.motivo, confianca: d.confianca, falhas: routed.falhas } };
      repos.tickets.addEvent({ ticketId, ator: agentActor(agente), tipo: 'roteamento', para: d.tier, detalhe: `${agente} → ${t.provedor}${t.modelo ? `/${t.modelo}` : ''} (${d.complexidade}, ${d.origem}): ${d.motivo}`.slice(0, 500) });
    }

    // Planners, reviewers and the memory agent work on the ticket where it is; an executor puts it in progress.
    const keepsStatus = STAYS.has(role);
    const expected = keepsStatus ? ticket.status : 'em_andamento';
    if (!keepsStatus) {
      if (ticket.status !== 'em_andamento') board.updateStatus(ticketId, 'em_andamento', SYSTEM);
      if (!ticket.responsavelAgentId && agentRow) board.assign(ticketId, agentRow.id, SYSTEM);
    }
    const sessionId = this.sessionOf(ticket);
    repos.tickets.addEvent({ ticketId, ator: agentActor(agente), tipo: 'execucao', detalhe: tarefa.slice(0, 300) });
    return this.deps.executor.submit({
      sessionId,
      texto,
      provider,
      ...(model ? { model } : {}),
      ...(routing ? { routing } : {}),
      cwd,
      systemAppend,
      etapa: `quadro:${def.papel ?? agente}`,
      ...(agentRow ? { agentId: agentRow.id } : {}),
      ticketId,
      stateless: true,
      recordUserMessage: false,
      storeAs: false,
      ...(def.ferramentas.length ? { allowedTools: def.ferramentas } : {}),
      noTools: def.ferramentas.length === 0,
      after: (outcome) => this.afterRun(ticketId, agente, role, expected, outcome, tools.writes),
    });
  }

  /**
   * Picks the tier for a step of an `auto` agent: free rules first, then (only if they do not decide) a small model, and
   * a person when the model is not sure. Returns the decision, or `done` when the step was handed to the classifier or
   * to a gate (the caller returns that run).
   */
  private route(a: { ticket: Ticket; project: Project; role: string; agente: string; tarefa: string; opts: RunOptions; cwd: string; falhas: number }): { decision: RouteDecision; falhas: number } | { done: Run | undefined } {
    const { router, repos, board, worktrees } = this.deps;
    const { ticket, opts } = a;
    if (opts.tier) {
      // A person already chose this tier at the gate: no rules, no model, no escalation on top.
      return { decision: { complexidade: complexityOf(opts.tier), tier: opts.tier, confianca: 1, motivo: 'aprovado por uma pessoa', origem: 'manual' }, falhas: a.falhas };
    }
    let base = opts.decision;
    if (!base) {
      const stat = ['qa', 'revisor'].includes(a.role) ? worktrees.diffStat(ticket, a.project) : undefined;
      const request = this.requestText(ticket, a.tarefa);
      base = routeByRules({
        papel: a.role,
        texto: request,
        criterios: (ticket.criteriosAceite ?? '').split('\n').filter((l) => l.trim()).length,
        subtarefas: repos.tickets.children(ticket.id).length,
        ...(stat ? { arquivos: stat.arquivos, linhasDiff: stat.linhas } : {}),
      });
      if (!base) return { done: this.classify({ ...a, request }) };
    }
    const decision = withEscalation(base, a.falhas);
    if (needsApproval(decision, router.settings().limiarConfianca)) {
      board.requestGate(
        ticket.id,
        {
          tipo: 'confianca',
          motivo: `O roteador não tem certeza (${Math.round(decision.confianca * 100)}%): sugere o tier ${decision.tier} para ${a.agente}. ${decision.motivo}`.slice(0, 500),
          retomar: { agente: a.agente, tarefa: a.tarefa, tier: decision.tier, statusAnterior: ticket.status === 'aguardando_aprovacao' ? 'em_andamento' : ticket.status },
        },
        agentActor(a.agente),
      );
      return { done: undefined };
    }
    return { decision, falhas: a.falhas };
  }

  /** The request as the router reads it: the ticket's own words plus the instruction (never comments or history). */
  private requestText(ticket: Ticket, tarefa: string): string {
    return [ticket.titulo, ticket.descricao, ticket.criteriosAceite, tarefa].filter(Boolean).join('\n');
  }

  /**
   * Phase 2: a small model classifies the request. Its answer (or its failure) is turned into a decision and the step
   * starts over with it, so the budget checks and the gates see the classifier's own tokens. A reply that is not
   * valid JSON has confidence 0: a person decides, nothing is guessed.
   */
  private classify(a: { ticket: Ticket; role: string; agente: string; tarefa: string; opts: RunOptions; cwd: string; request: string }): Run {
    const { router, library } = this.deps;
    const target = router.target('pequeno', { semFerramentas: true });
    let system = CLASSIFIER_PROMPT;
    try {
      system = library.systemPrompt(library.agent('roteador'));
    } catch {
      /* no agent file: the built-in prompt */
    }
    // Strip until stable: a single pass turns `</pe</pedido>dido>` back into a closing tag.
    let safe = a.request.slice(0, 4000);
    for (let prev = ''; prev !== safe; ) {
      prev = safe;
      safe = safe.replace(/<\/?pedido>/gi, '');
    }
    return this.deps.executor.submit({
      sessionId: this.sessionOf(a.ticket),
      texto: `Papel de quem vai executar: ${a.role || 'desconhecido'}\n<pedido>\n${safe}\n</pedido>`,
      provider: target.provedor,
      ...(target.modelo ? { model: target.modelo } : {}),
      cwd: a.cwd,
      systemAppend: system,
      etapa: 'roteador',
      ticketId: a.ticket.id,
      stateless: true,
      recordUserMessage: false,
      storeAs: false,
      noTools: true,
      after: (outcome) => {
        const parsed = outcome.status === 'ok' ? fromClassification(extractJson(outcome.result)) : undefined;
        const decision: RouteDecision = parsed ?? {
          complexidade: 'media',
          tier: 'medio',
          confianca: 0,
          motivo: outcome.status === 'ok' ? 'o classificador não devolveu um JSON válido' : `o classificador falhou: ${outcome.error ?? outcome.status}`,
          origem: 'modelo',
        };
        this.run(a.ticket.id, a.agente, a.tarefa, { ...a.opts, decision });
      },
    });
  }

  /** Continues after a person decided a gate: resumes the paused step, or re-runs the author after a rejection. */
  onDecision(decision: Decision, decisao: 'aprovado' | 'rejeitado'): Run | undefined {
    const { ticket, approval } = decision;
    if (decision.approval.retomar?.acao) {
      this.branchAction(ticket, decision.approval.retomar.acao, decisao);
      return undefined;
    }
    if (decisao === 'aprovado') {
      if (approval.tipo === 'entrega' && ticket.status === 'concluido') {
        this.settle(ticket.id);
        return this.run(ticket.id, this.names.memoria, MEMORY_TASK);
      }
      const r = decision.retomar;
      // The paused step goes on; an approved cost gate lets exactly this step past the ceiling.
      if (r?.agente && r.tarefa) {
        const tier = approval.tipo === 'confianca' && TIER_NAMES.has(r.tier ?? '') ? (r.tier as Tier) : undefined;
        return this.run(ticket.id, r.agente, r.tarefa, { force: approval.tipo === 'custo', ignorarBloqueio: true, ...(tier ? { tier } : {}) });
      }
      // A reproval the person confirmed: the author reworks it.
      if (approval.tipo === 'reprovacao') return this.rework(ticket);
      return undefined;
    }
    // Rejected delivery or reproval: the ticket is back in progress with the person's comment on it, and the
    // responsible agent tries again. Rejecting a cost, destructive or low-confidence gate means "do not": nothing runs.
    return approval.tipo === 'entrega' || approval.tipo === 'reprovacao' ? this.rework(ticket) : undefined;
  }

  /** A finished ticket gives its worktree back (the branch stays until merged or discarded). Never throws: it is a note on the ticket. */
  settle(ticketId: string): void {
    const t = this.deps.repos.tickets.get(ticketId);
    if (!t || t.status !== 'concluido' || t.worktreeEstado !== 'ativo') return;
    try {
      this.deps.worktrees.release(t, this.deps.repos.projects.get(t.projectId)!);
    } catch (e) {
      this.deps.board.comment(t.id, SYSTEM, `Não consegui liberar o worktree: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Asks for approval to merge the ticket branch into the project's base branch, or to throw the branch away. */
  requestBranchAction(ticketId: string, acao: 'merge' | 'descartar', who: Actor = HUMAN): Ticket {
    const t = this.need(ticketId);
    const project = this.deps.repos.projects.get(t.projectId)!;
    if (!t.branch || !t.worktreeEstado || t.worktreeEstado === 'mesclado' || t.worktreeEstado === 'descartado') {
      throw new BoardError(409, 'no_branch', 'Este ticket não tem uma branch pendente');
    }
    if (acao === 'merge' && this.deps.repos.tickets.runs(t.id).some((r) => r.status === 'rodando')) {
      throw new BoardError(409, 'ticket_busy', 'Um agente ainda está trabalhando neste ticket');
    }
    const base = this.deps.worktrees.baseOf(project) ?? 'a branch base';
    const motivo =
      acao === 'merge'
        ? `Mesclar a branch ${t.branch} em ${base} (merge)`
        : `Descartar o trabalho: apagar o worktree e a branch ${t.branch} (apagar)`;
    return this.deps.board.requestGate(t.id, { tipo: 'destrutiva', motivo, retomar: { acao, statusAnterior: t.status } }, who);
  }

  /** Runs the approved action (and only that), or just records that it was refused. */
  private branchAction(ticket: Ticket, acao: 'merge' | 'descartar', decisao: 'aprovado' | 'rejeitado'): void {
    const { repos, board, worktrees } = this.deps;
    if (decisao === 'rejeitado') return;
    const t = this.need(ticket.id);
    const project = repos.projects.get(t.projectId)!;
    try {
      const r = acao === 'merge' ? worktrees.merge(t, project) : worktrees.discard(t, project);
      board.comment(t.id, SYSTEM, r.ok ? r.resumo : `Não foi possível ${acao === 'merge' ? 'mesclar' : 'descartar'}: ${r.erro}`);
    } catch (e) {
      board.comment(t.id, SYSTEM, `Falha na ação ${acao}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Tells the ticket (once) when its token ceiling reaches 80%, and the day's budget once per day. Exceeding either stops the next step at a gate. */
  private warnBudgets(ticket: Ticket): void {
    const { repos, board, router } = this.deps;
    if (ticket.orcamentoTokens != null) {
      const u = repos.tickets.usage(ticket.id);
      const used = u.tokensIn + u.tokensOut;
      const warned = repos.tickets.events(ticket.id).some((e) => e.tipo === 'aviso' && e.para === 'orcamento-ticket');
      if (!warned && used >= ticket.orcamentoTokens * WARN_AT && used < ticket.orcamentoTokens) {
        repos.tickets.addEvent({ ticketId: ticket.id, ator: SYSTEM, tipo: 'aviso', para: 'orcamento-ticket', detalhe: `${used} de ${ticket.orcamentoTokens} tokens` });
        board.comment(ticket.id, SYSTEM, `Atenção: o ticket já usou ${Math.floor((used / ticket.orcamentoTokens) * 100)}% do teto (${used} de ${ticket.orcamentoTokens} tokens). Ao passar do teto, o próximo passo pede aprovação.`);
      }
    }
    const day = router.takeDailyWarning();
    if (day) board.comment(ticket.id, SYSTEM, day);
  }

  private rework(ticket: Ticket): Run | undefined {
    const t = this.need(ticket.id);
    if (t.status !== 'em_andamento' || !t.responsavel) return undefined;
    return this.run(t.id, t.responsavel, 'A entrega foi devolvida. Leia os últimos comentários, corrija o que foi apontado e responda com a versão revisada.');
  }

  private afterRun(ticketId: string, agente: string, role: Role, expected: string, outcome: StepOutcome, wrote: boolean): void {
    const { repos, board } = this.deps;
    const ticket = repos.tickets.get(ticketId);
    if (!ticket) return;
    const who = agentActor(agente);
    this.warnBudgets(ticket);
    if (outcome.status !== 'ok' || !outcome.result.trim()) {
      const why = outcome.status === 'cancelado' ? 'execução cancelada' : (outcome.error ?? 'o agente não devolveu nenhum texto');
      this.fail(ticket, agente, why, outcome.run.id);
      return;
    }
    const text = outcome.result.trim();
    board.comment(ticketId, who, text, outcome.run.id);
    // What the agent changed becomes a commit on the ticket branch, so QA, the reviewer and the merge all see the same thing.
    if (wrote) {
      try {
        const done = this.deps.worktrees.commitAll(ticket, `${ticket.identificador}: ${ticket.titulo} (${agente})`, repos.projects.get(ticket.projectId)!);
        if (done || !STAYS.has(role)) board.comment(ticketId, SYSTEM, done ? `Alterações commitadas na branch ${repos.tickets.get(ticketId)?.branch}.` : 'O agente não alterou nenhum arquivo.');
      } catch (e) {
        this.fail(ticket, agente, e instanceof Error ? e.message : String(e), outcome.run.id);
        return;
      }
    }
    // A person may have moved the card while the agent worked: then the answer is only a comment.
    if (ticket.status !== expected) return;

    switch (role) {
      case 'po':
        return this.afterPo(ticket, text, who);
      case 'techlead':
        return this.afterLead(ticket, text, who);
      case 'qa':
      case 'revisor':
        return this.afterReview(ticket, role, agente, text, who, outcome.run.id);
      case 'memoria':
        return this.afterMemory(ticket, text, outcome.run.id);
      default:
        // A developer (or any other executor) delivered: it goes to review.
        board.updateStatus(ticketId, 'em_revisao', who);
        this.run(ticketId, this.names.qa, QA_TASK);
    }
  }

  private afterPo(ticket: Ticket, text: string, who: Actor): void {
    const { repos, board } = this.deps;
    const parsed = poOutput.safeParse(extractJson(text));
    if (!parsed.success) return this.unreadable(ticket, who, 'o product owner não devolveu o ticket no formato esperado (JSON com titulo, descricao e criterios_aceite)');
    const o = parsed.data;
    repos.tickets.update(ticket.id, { titulo: o.titulo, descricao: o.descricao ?? ticket.descricao, criteriosAceite: bullets(o.criterios_aceite) ?? null });
    board.updateStatus(ticket.id, 'pronto', who);
    this.run(ticket.id, this.names.techlead, `Quebre este ticket em até ${MAX_SUBTASKS} subtarefas pequenas, cada uma com o agente que deve executar ("dev-front", "dev-back"...). Responda SOMENTE com um bloco json: {"subtarefas":[{"titulo":"...","descricao":"...","criterios_aceite":["..."],"agente":"dev-back"}]}`);
  }

  private afterLead(ticket: Ticket, text: string, who: Actor): void {
    const { repos, board, library } = this.deps;
    const parsed = leadOutput.safeParse(extractJson(text));
    if (!parsed.success) return this.unreadable(ticket, who, 'o tech lead não devolveu as subtarefas no formato esperado (JSON com "subtarefas")');
    const created: Ticket[] = [];
    for (const s of parsed.data.subtarefas) {
      const name = s.agente && repos.agents.byName(s.agente) && this.onTeam(ticket.projectId, s.agente) ? s.agente : this.names.dev;
      const agentRow = repos.agents.byName(name);
      const child = board.createTicket(
        {
          projectId: ticket.projectId,
          parentId: ticket.id,
          titulo: s.titulo,
          ...(s.descricao ? { descricao: s.descricao } : {}),
          ...((bullets(s.criterios_aceite) ?? ticket.criteriosAceite) ? { criteriosAceite: (bullets(s.criterios_aceite) ?? ticket.criteriosAceite)! } : {}),
          status: 'pronto',
          requerAprovacao: true,
          ...(ticket.orcamentoTokens != null ? { orcamentoTokens: ticket.orcamentoTokens } : {}),
          ...(agentRow ? { responsavelAgentId: agentRow.id } : {}),
        },
        who,
      );
      created.push(child);
    }
    // The parent now waits for its sub-tasks.
    if (ticket.status !== 'em_andamento') board.updateStatus(ticket.id, 'em_andamento', SYSTEM);
    library.sync();
    for (const child of created) {
      this.run(child.id, child.responsavel ?? this.names.dev, 'Implemente esta subtarefa conforme os critérios de aceite e responda com o resultado (diff ou passos) e o que verificou.');
    }
  }

  private afterReview(ticket: Ticket, role: Role, agente: string, text: string, who: Actor, runId: string): void {
    const { board } = this.deps;
    const verdict = parseVerdict(text);
    if (!verdict) return this.unreadable(ticket, who, `${agente} não disse "VEREDITO: aprovado" nem "VEREDITO: reprovado"`);
    if (verdict === 'aprovado') {
      // Needs approval → the delivery gate; otherwise the reviewer closes it.
      board.updateStatus(ticket.id, 'concluido', who);
      const t = this.need(ticket.id);
      if (t.status === 'concluido') {
        this.settle(t.id);
        this.run(ticket.id, this.names.memoria, MEMORY_TASK);
      }
      return;
    }
    board.requestGate(
      ticket.id,
      { tipo: 'reprovacao', motivo: `${agente} (${role}) reprovou a entrega`, runId, ...(ticket.responsavel ? { retomar: { agente: ticket.responsavel, statusAnterior: 'em_andamento' } } : {}) },
      who,
    );
  }

  private afterMemory(ticket: Ticket, text: string, runId: string): void {
    const { repos } = this.deps;
    const { resumo, fatos } = parseMemoryOutput(text);
    if (resumo) repos.tickets.update(ticket.id, { resumo });
    for (const f of fatos) repos.facts.add({ projectId: ticket.projectId, texto: f, fixado: false, origemRunId: runId });
  }

  /** True when the project has no roster yet, or the agent is on one of its teams. */
  private onTeam(projectId: string, agente: string): boolean {
    const { repos } = this.deps;
    if (!repos.teams.hasRoster(projectId)) return true;
    const row = repos.agents.byName(agente);
    return Boolean(row && repos.teams.membershipsInProject(projectId, row.id).length);
  }

  /** The answer cannot be used: say so on the ticket and block it, for a person to decide. */
  private unreadable(ticket: Ticket, who: Actor, why: string): void {
    this.deps.board.comment(ticket.id, SYSTEM, `Não consegui seguir: ${why}. O texto está nos comentários acima; ajuste o ticket e rode o agente de novo.`);
    this.block(ticket, who);
  }

  private fail(ticket: Ticket, agente: string, why: string, runId?: string): void {
    this.deps.board.comment(ticket.id, SYSTEM, `Falha ao executar "${agente}": ${why}`, runId);
    this.block(this.need(ticket.id), SYSTEM);
  }

  private block(ticket: Ticket, who: Actor): void {
    const t = this.need(ticket.id);
    if (t.status === 'bloqueado' || t.status === 'concluido' || t.status === 'aguardando_aprovacao') return;
    try {
      this.deps.board.updateStatus(t.id, 'bloqueado', who.tipo === 'agente' ? SYSTEM : who);
    } catch (e) {
      if (!(e instanceof BoardError)) throw e;
    }
  }

  /** Each ticket's agent runs live in a hidden conversation (not listed with the chats), one run at a time. */
  private sessionOf(ticket: Ticket): string {
    const { repos } = this.deps;
    const existing = ticket.sessionId && repos.sessions.get(ticket.sessionId);
    if (existing) return existing.id;
    const s = repos.sessions.create({ projectId: ticket.projectId, titulo: `${ticket.identificador} ${ticket.titulo}`.slice(0, 200) });
    repos.tickets.setSession(ticket.id, s.id);
    return s.id;
  }

  private need(id: string): Ticket {
    const t = this.deps.repos.tickets.get(id);
    if (!t) throw new BoardError(404, 'ticket_not_found', `Ticket not found: ${id}`);
    return t;
  }
}
