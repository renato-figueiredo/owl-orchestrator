import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { fmtCost, fmtTokens } from '../lib/format';
import type { DayUsage, Metrics, MetricsRow, Project, ProviderInfo, RouterSettings, Tier } from '../lib/types';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const TIERS: Array<{ id: Tier; label: string; hint: string }> = [
  { id: 'pequeno', label: 'Pequeno', hint: 'classificar, resumir, tarefas curtas' },
  { id: 'medio', label: 'Médio', hint: 'QA, product owner, revisões simples' },
  { id: 'forte', label: 'Forte', hint: 'código complexo, arquitetura' },
];
const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`);
/** Local `YYYY-MM-DD`, the way the API takes days. */
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => day(new Date(Date.now() - n * 86_400_000));

interface Props {
  projects: Project[];
  providers: ProviderInfo[];
  initialProjectId?: string | null;
  onClose: () => void;
}

/** What the runs cost and how they ended, by ticket, agent and model; plus the router's tiers and budgets. */
export function MetricsPanel({ projects, providers, initialProjectId, onClose }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : '');
  const [desde, setDesde] = useState('');
  const [ate, setAte] = useState('');
  const [data, setData] = useState<{ metrics: Metrics; dia: DayUsage } | null>(null);
  const [router, setRouter] = useState<RouterSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.metrics({ projectId, desde, ate }));
    } catch (e) {
      setError(message(e));
    }
  }, [projectId, desde, ate]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void api.router().then((r) => setRouter(r.router)).catch((e) => setError(message(e)));
  }, []);

  const saveRouter = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const budget = text('orcamentoDia').replace(/[.\s]/g, '');
    setError(null);
    setNotice(null);
    try {
      const saved = await api.saveRouter({
        tiers: Object.fromEntries(TIERS.map((t) => [t.id, { provedor: text(`${t.id}-provedor`), ...(text(`${t.id}-modelo`) ? { modelo: text(`${t.id}-modelo`) } : {}) }])),
        limiarConfianca: Number(text('limiar')) / 100,
        orcamentoDiaTokens: budget ? Number(budget) : null,
      });
      setRouter(saved.router);
      setNotice('Roteador salvo.');
      await load();
    } catch (err) {
      setError(message(err));
    }
  };

  const m = data?.metrics;
  return (
    <section aria-label="Métricas e roteador" className="min-w-0 flex-1 overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <h1 className="text-lg font-semibold">Métricas e roteador</h1>
        <button type="button" onClick={onClose} className="ml-auto rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Voltar às conversas
        </button>
      </header>
      <div className="space-y-6 p-4 text-sm">
        {error && <p role="alert" className="rounded border border-danger p-2 text-danger">{error}</p>}
        {notice && <p role="status" className="rounded border border-line p-2 text-muted">{notice}</p>}

        <form aria-label="Filtros" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
          <label className="block">
            Projeto
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 block rounded border border-line bg-bg px-2 py-1">
              <option value="">Todos os projetos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </label>
          <label className="block">
            De
            <input type="date" value={desde} max={ate || undefined} onChange={(e) => setDesde(e.target.value)} className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
          </label>
          <label className="block">
            Até
            <input type="date" value={ate} min={desde || undefined} onChange={(e) => setAte(e.target.value)} className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
          </label>
          <div className="flex gap-2" role="group" aria-label="Períodos">
            <button type="button" onClick={() => { setDesde(day(new Date())); setAte(day(new Date())); }} className="rounded border border-line px-3 py-1 hover:bg-raised">Hoje</button>
            <button type="button" onClick={() => { setDesde(daysAgo(6)); setAte(day(new Date())); }} className="rounded border border-line px-3 py-1 hover:bg-raised">7 dias</button>
            <button type="button" onClick={() => { setDesde(daysAgo(29)); setAte(day(new Date())); }} className="rounded border border-line px-3 py-1 hover:bg-raised">30 dias</button>
            <button type="button" onClick={() => { setDesde(''); setAte(''); }} className="rounded border border-line px-3 py-1 hover:bg-raised">Tudo</button>
          </div>
        </form>

        {data?.dia.limite != null && <DayBudget dia={data.dia} />}

        {m && (
          <>
            <dl aria-label="Totais" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Execuções" value={fmtTokens(m.totais.runs)} />
              <Stat label="Taxa de sucesso" value={pct(m.totais.taxaSucesso)} hint={`${m.totais.ok} ok · ${m.totais.erro} com erro · ${m.totais.cancelados} canceladas`} />
              <Stat label="Tokens" value={fmtTokens(m.totais.tokensIn + m.totais.tokensOut)} hint={`${fmtTokens(m.totais.tokensIn)} entrada · ${fmtTokens(m.totais.tokensOut)} saída`} />
              <Stat label="Custo informado" value={fmtCost(m.totais.custo)} hint="só o que a CLI informou" />
              <Stat label="Retrabalho" value={pct(m.totais.taxaRetrabalho)} hint={`${m.totais.retrabalho} execuções repetidas`} />
              <Stat label="Gasto do roteador" value={fmtTokens(m.totais.roteador.tokens)} hint={`${m.totais.roteador.runs} classificações`} />
            </dl>
            <Table title="Por ticket" first="Ticket" rows={m.porTicket.map((r) => ({ ...r, rotulo: r.titulo || r.rotulo }))} />
            <Table title="Por agente" first="Agente" rows={m.porAgente} />
            <Table title="Por modelo" first="Modelo" rows={m.porModelo} />
          </>
        )}

        {router && (
          <form onSubmit={saveRouter} aria-label="Roteador" className="space-y-3 rounded border border-line bg-raised p-3">
            <h2 className="font-semibold">Roteador</h2>
            <p className="text-muted">
              Vale para agentes com <code>roteamento: auto</code> no arquivo. Regras gratuitas decidem primeiro; só se não decidirem, o tier pequeno classifica. Cada reprovação sobe um tier.
            </p>
            <table className="w-full text-left">
              <thead className="text-xs text-muted">
                <tr><th>Tier</th><th>Provedor</th><th>Modelo</th></tr>
              </thead>
              <tbody>
                {TIERS.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1 pr-2">
                      {t.label}
                      <span className="block text-xs text-muted">{t.hint}</span>
                    </td>
                    <td className="pr-2">
                      <label className="sr-only" htmlFor={`${t.id}-provedor`}>Provedor do tier {t.label}</label>
                      <select id={`${t.id}-provedor`} name={`${t.id}-provedor`} defaultValue={router.tiers[t.id].provedor} className="rounded border border-line bg-bg px-2 py-1">
                        {[...new Set([router.tiers[t.id].provedor, ...providers.map((p) => p.id)])].map((id) => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${t.id}-modelo`}>Modelo do tier {t.label}</label>
                      <input id={`${t.id}-modelo`} name={`${t.id}-modelo`} defaultValue={router.tiers[t.id].modelo ?? ''} placeholder="padrão do provedor" maxLength={100} className="rounded border border-line bg-bg px-2 py-1" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                Confiança mínima para decidir sozinho (%)
                <input name="limiar" type="number" min={0} max={100} step={1} defaultValue={Math.round(router.limiarConfianca * 100)} className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
                <span className="text-xs text-muted">Abaixo disso o ticket espera a sua aprovação do tier.</span>
              </label>
              <label className="block">
                Orçamento diário (tokens)
                <input name="orcamentoDia" inputMode="numeric" defaultValue={router.orcamentoDiaTokens ?? ''} placeholder="sem limite" className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1" />
                <span className="text-xs text-muted">Aviso em 80%. Ao estourar, o próximo passo de cada ticket pede aprovação. O dia vira à meia-noite local.</span>
              </label>
            </div>
            <button type="submit" className="rounded bg-accent px-3 py-1.5 font-medium text-accent-fg">Salvar roteador</button>
          </form>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-line p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function DayBudget({ dia }: { dia: DayUsage }) {
  const share = Math.min(1, dia.percentual ?? 0);
  const tone = dia.estourado ? 'bg-danger' : dia.aviso ? 'bg-fg' : 'bg-accent';
  return (
    <section aria-label="Orçamento do dia" className="rounded border border-line p-3">
      <p>
        Hoje: <strong>{fmtTokens(dia.usado)}</strong> de {fmtTokens(dia.limite)} tokens ({pct(dia.percentual)})
        {dia.estourado && <span className="text-danger"> · estourado: os próximos passos pedem aprovação</span>}
        {dia.aviso && <span> · acima de 80%</span>}
      </p>
      <div role="progressbar" aria-label="Uso do orçamento diário" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} className="mt-2 h-2 overflow-hidden rounded bg-line">
        <div className={`h-full ${tone}`} style={{ width: `${share * 100}%` }} />
      </div>
    </section>
  );
}

function Table({ title, first, rows }: { title: string; first: string; rows: MetricsRow[] }) {
  return (
    <section aria-label={title} className="space-y-1">
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted">Nada no período.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th>{first}</th>
              <th className="text-right">Execuções</th>
              <th className="text-right">Sucesso</th>
              <th className="text-right">Retrabalho</th>
              <th className="text-right">Tokens</th>
              <th className="text-right">Custo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.chave} className="border-t border-line">
                <td className="py-1 pr-2">{r.rotulo}</td>
                <td className="text-right">{r.runs}</td>
                <td className="text-right">{pct(r.taxaSucesso)}</td>
                <td className="text-right">{r.retrabalho}</td>
                <td className="text-right">{fmtTokens(r.tokensIn + r.tokensOut)}</td>
                <td className="text-right">{fmtCost(r.custo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
