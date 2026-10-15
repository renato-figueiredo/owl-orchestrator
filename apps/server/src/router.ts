import { DEFAULT_ROUTER, routerConfigSchema, tierTargetSchema, type RouterConfig, type Tier } from '@owl/core';
import type { createRepos } from '@owl/db';
import { z } from 'zod';

type Repos = ReturnType<typeof createRepos>;

const KEY = 'router';
const WARNED_KEY = 'router_aviso_dia';
/** The share of a budget at which a person is told, before the budget stops anything. */
export const WARN_AT = 0.8;
/** What a run that has not finished yet is assumed to cost against the daily budget. */
const IN_FLIGHT_TOKENS = 4000;

const target = tierTargetSchema;
export const routerPatchSchema = z.strictObject({
  tiers: z.strictObject({ pequeno: target.optional(), medio: target.optional(), forte: target.optional() }).optional(),
  limiarConfianca: z.number().min(0).max(1).optional(),
  orcamentoDiaTokens: z.number().int().min(1).max(10_000_000_000).nullable().optional(),
});
export type RouterPatch = z.infer<typeof routerPatchSchema>;

export interface DayUsage {
  limite: number | null;
  usado: number;
  /** usado / limite (0..), null without a limit. */
  percentual: number | null;
  aviso: boolean;
  estourado: boolean;
}

/** `YYYY-MM-DD` of the local day: the budget resets at the user's midnight, not at UTC's. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Router settings (tiers, confidence threshold, daily budget) and the daily budget's bookkeeping. */
export class RouterService {
  constructor(private readonly deps: { repos: Repos }) {}

  settings(): RouterConfig {
    const stored = this.deps.repos.settings.get(KEY);
    // A damaged or outdated value never stops the board: each field that does not validate falls back to its default, the valid ones are kept
    // (so a corrupted tier never switches off a valid daily budget).
    const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    const tiers = (s.tiers && typeof s.tiers === 'object' ? s.tiers : {}) as Record<string, unknown>;
    const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
      const r = schema.safeParse(value);
      return r.success ? r.data : fallback;
    };
    return {
      tiers: {
        pequeno: pick(tierTargetSchema, tiers.pequeno, DEFAULT_ROUTER.tiers.pequeno),
        medio: pick(tierTargetSchema, tiers.medio, DEFAULT_ROUTER.tiers.medio),
        forte: pick(tierTargetSchema, tiers.forte, DEFAULT_ROUTER.tiers.forte),
      },
      limiarConfianca: pick(routerConfigSchema.shape.limiarConfianca, s.limiarConfianca, DEFAULT_ROUTER.limiarConfianca),
      orcamentoDiaTokens: 'orcamentoDiaTokens' in s ? pick(routerConfigSchema.shape.orcamentoDiaTokens, s.orcamentoDiaTokens, DEFAULT_ROUTER.orcamentoDiaTokens) : DEFAULT_ROUTER.orcamentoDiaTokens,
    };
  }

  save(patch: RouterPatch): RouterConfig {
    const cur = this.settings();
    const next = routerConfigSchema.parse({
      ...cur,
      ...(patch.limiarConfianca !== undefined ? { limiarConfianca: patch.limiarConfianca } : {}),
      ...(patch.orcamentoDiaTokens !== undefined ? { orcamentoDiaTokens: patch.orcamentoDiaTokens } : {}),
      tiers: { ...cur.tiers, ...(patch.tiers ?? {}) },
    });
    this.deps.repos.settings.set(KEY, next);
    return next;
  }

  /** Provider and model of a tier. */
  target(tier: Tier) {
    return this.settings().tiers[tier];
  }

  /** How many times the work on this ticket came back: rejected deliveries and confirmed or contested reproofs. */
  failures(ticketId: string): number {
    return this.deps.repos.approvals.byTicket(ticketId).filter((a) => a.tipo === 'reprovacao' || (a.tipo === 'entrega' && a.status === 'rejeitado')).length;
  }

  /** UTC `YYYY-MM-DD HH:MM:SS` of the last local midnight, the way the database stores `runs.inicio`. */
  dayStart(now = new Date()): string {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  dayUsage(now = new Date()): DayUsage {
    const limite = this.settings().orcamentoDiaTokens;
    const usado = this.deps.repos.metrics.tokensSince(this.dayStart(now));
    const percentual = limite ? usado / limite : null;
    return { limite, usado, percentual, aviso: percentual !== null && percentual >= WARN_AT && percentual < 1, estourado: percentual !== null && percentual >= 1 };
  }

  /** The day's budget would be passed by a run of about `estimated` tokens. */
  overDaily(estimated: number, now = new Date()): boolean {
    const u = this.dayUsage(now);
    // Runs still going have not written their tokens yet: each one counts as an expected run, or parallel tickets would all pass the check.
    const inFlight = this.deps.repos.metrics.runningCount() * IN_FLIGHT_TOKENS;
    return u.limite !== null && u.usado + inFlight + estimated > u.limite;
  }

  /** Once per local day, the warning text when usage crossed 80%; undefined otherwise (or when it was already given). */
  takeDailyWarning(now = new Date()): string | undefined {
    const u = this.dayUsage(now);
    if (u.limite === null || u.percentual === null || u.percentual < WARN_AT) return undefined;
    const today = localDay(now);
    const warned = this.deps.repos.settings.get(WARNED_KEY) as { dia?: string } | undefined;
    if (warned?.dia === today) return undefined;
    this.deps.repos.settings.set(WARNED_KEY, { dia: today });
    return `Orçamento diário em ${Math.floor(u.percentual * 100)}%: ${u.usado} de ${u.limite} tokens usados hoje. Ao estourar, os próximos passos pedem aprovação.`;
  }
}
