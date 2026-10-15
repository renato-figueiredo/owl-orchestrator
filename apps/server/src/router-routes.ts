import { BoardError } from '@owl/board';
import { listAdapters } from '@owl/core';
import type { createRepos } from '@owl/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { routerPatchSchema, type RouterService } from './router.js';

type Repos = ReturnType<typeof createRepos>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const query = z.object({ projectId: z.string().min(1).max(100).optional(), desde: day.optional(), ate: day.optional() });

/** Local midnight of `YYYY-MM-DD` (plus `plusDays`) in the form the database stores: UTC `YYYY-MM-DD HH:MM:SS`. */
function localMidnight(date: string, plusDays = 0): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Validate the day itself first: adding `plusDays` to a month's last day legitimately rolls into the next month.
  const day0 = new Date(y, m - 1, d);
  if (day0.getFullYear() !== y || day0.getMonth() !== m - 1 || day0.getDate() !== d) throw new BoardError(400, 'invalid_date', `Invalid date: ${date}`);
  const at = new Date(y, m - 1, d + plusDays);
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/** Router settings and the metrics panel (prompt 15). */
export function registerRouterRoutes(app: FastifyInstance, deps: { repos: Repos; router: RouterService }): void {
  const { repos, router } = deps;

  app.get('/router', async () => {
    await router.refreshLocal();
    return { router: router.settings(), dia: router.dayUsage(), local: router.localStatus() };
  });

  app.put('/router', async (req) => {
    const patch = routerPatchSchema.parse(req.body);
    const known = new Set(listAdapters().map((a) => a.id));
    for (const [tier, t] of Object.entries(patch.tiers ?? {})) {
      if (t && !known.has(t.provedor)) throw new BoardError(400, 'unknown_provider', `Unknown provider for tier ${tier}: ${t.provedor}`);
      // Same shape the CLI adapters accept, so a bad model fails here and not at the first run.
      if (t?.modelo && !/^[\w.:/[\]@-]+$/.test(t.modelo)) throw new BoardError(400, 'invalid_model', `Invalid model for tier ${tier}`);
    }
    const saved = router.save(patch);
    await router.refreshLocal();
    return { router: saved, dia: router.dayUsage(), local: router.localStatus() };
  });

  /** Cost, success and rework from the stored runs, optionally of one project and of a range of local days (both ends included). */
  app.get('/metrics', async (req) => {
    const q = query.parse(req.query);
    if (q.projectId && !repos.projects.get(q.projectId)) throw new BoardError(404, 'project_not_found', `Project not found: ${q.projectId}`);
    if (q.desde && q.ate && q.desde > q.ate) throw new BoardError(400, 'invalid_range', '"desde" is after "ate"');
    const metrics = repos.metrics.metrics({
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.desde ? { desde: localMidnight(q.desde) } : {}),
      ...(q.ate ? { ate: localMidnight(q.ate, 1) } : {}),
    });
    return { metrics, dia: router.dayUsage() };
  });
}
