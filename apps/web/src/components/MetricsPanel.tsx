import { Button, ProviderDot, Switch } from '@owl/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { fmtCompact, fmtUsd } from '../lib/format';
import type { DayUsage, LocalStatus, Metrics, MetricsRow, Project, ProviderInfo, RouterSettings, Tier } from '../lib/types';
import { ScreenHeader, field } from './desk/ScreenHeader';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const TIERS: Array<{ id: Tier; label: string; hint: string }> = [
  { id: 'pequeno', label: 'Pequeno', hint: 'classificar, resumir, tarefas curtas' },
  { id: 'medio', label: 'Médio', hint: 'QA, product owner, revisões simples' },
  { id: 'forte', label: 'Forte', hint: 'código complexo, arquitetura' },
];
const nf = new Intl.NumberFormat('pt-BR');
const pct = (n: number | null | undefined) => (n == null ? '–' : `${nf.format(Math.round(n * 1000) / 10)}%`);
/** 1.920.000 → "1,92M"; below a million falls back to the design's "18,4k". */
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}M` : fmtCompact(n));
/** Local `YYYY-MM-DD`, the way the API takes days. */
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => day(new Date(Date.now() - n * 86_400_000));
const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  const month = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'][Number(m) - 1] ?? m;
  return `${d} ${month}`;
};

type Range = 'hoje' | '7' | '30' | 'tudo' | null;
const RANGES: Array<{ id: Exclude<Range, null>; label: string }> = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
  { id: 'tudo', label: 'Tudo' },
];

interface Props {
  projects: Project[];
  providers: ProviderInfo[];
  initialProjectId?: string | null;
  onClose?: () => void;
}

/** What the runs cost and how they ended, by ticket, agent and model; plus the router's tiers and budgets. */
export function MetricsPanel({ projects, providers, initialProjectId }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : '');
  const [desde, setDesde] = useState('');
  const [ate, setAte] = useState('');
  const [range, setRange] = useState<Range>('tudo');
  const [data, setData] = useState<{ metrics: Metrics; dia: DayUsage } | null>(null);
  const [router, setRouter] = useState<RouterSettings | null>(null);
  const [local, setLocal] = useState<LocalStatus | null>(null);
  const [localAtivo, setLocalAtivo] = useState(false);
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
    void api
      .router()
      .then((r) => {
        setRouter(r.router);
        setLocal(r.local ?? null);
        setLocalAtivo(r.router.localPequeno.ativo);
      })
      .catch((e) => setError(message(e)));
  }, []);

  const pick = (r: Exclude<Range, null>) => {
    setRange(r);
    setDesde(r === 'tudo' ? '' : r === 'hoje' ? day(new Date()) : daysAgo(r === '7' ? 6 : 29));
    setAte(r === 'tudo' ? '' : day(new Date()));
  };

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
        localPequeno: { ativo: localAtivo, ...(text('localModelo') ? { modelo: text('localModelo') } : {}), memoria: text('localMemoria') as 'auto' | 'rapido' | 'economico' },
        limiarConfianca: Number(text('limiar')) / 100,
        orcamentoDiaTokens: budget ? Number(budget) : null,
      });
      setRouter(saved.router);
      setLocal(saved.local ?? null);
      setNotice('Roteador salvo.');
      await load();
    } catch (err) {
      setError(message(err));
    }
  };

  const m = data?.metrics;
  const project = projects.find((p) => p.id === projectId);
  const period = desde && ate ? (desde === ate ? shortDay(desde) : `${shortDay(desde)} → ${shortDay(ate)}`) : 'TODO O PERÍODO';
  const eyebrow = `${(project?.nome ?? 'TODOS OS PROJETOS').toUpperCase()} · ${period}`;

  return (
    <main aria-label="Métricas e roteador" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader eyebrow={eyebrow} title="Métricas">
        <span className="flex-1" />
        <form aria-label="Filtros" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Projeto
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
              <option value="">Todos os projetos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            De
            <input type="date" value={desde} max={ate || undefined} onChange={(e) => {
                setRange(null);
                setDesde(e.target.value);
              }} className={`${field} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Até
            <input type="date" value={ate} min={desde || undefined} onChange={(e) => {
                setRange(null);
                setAte(e.target.value);
              }} className={`${field} font-mono`} />
          </label>
          <div role="group" aria-label="Períodos" className="flex h-[30px] overflow-hidden rounded-md border border-line">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => pick(r.id)}
                className={`border-0 px-3 font-mono text-xs font-medium transition-colors duration-[120ms] hover:text-fg ${range === r.id ? 'bg-raised text-fg' : 'bg-transparent text-muted'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </form>
      </ScreenHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-6 py-5 text-[13px]">
        {error && (
          <p role="alert" className="m-0 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-xs text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="m-0 rounded-md border border-line bg-panel px-3 py-2.5 text-xs text-muted">
            {notice}
          </p>
        )}

        {m && (
          <>
            <div role="group" aria-label="Totais" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 xl:grid-cols-5">
              <Stat label="Custo" value={fmtUsd(m.totais.custo)} hint="só o que a CLI informou" />
              <Stat label="Tokens" value={tokens(m.totais.tokensIn + m.totais.tokensOut)} hint={`${tokens(m.totais.tokensIn)} ent · ${tokens(m.totais.tokensOut)} saí`} />
              <Stat label="Runs" value={nf.format(m.totais.runs)} hint={`${m.totais.roteador.runs} do roteador · ${tokens(m.totais.roteador.tokens)} tokens`} />
              <Stat label="Taxa de falha" value={m.totais.runs ? pct(m.totais.erro / m.totais.runs) : '–'} hint={`${m.totais.erro} falhas · ${pct(m.totais.taxaRetrabalho)} retrabalho · ${m.totais.cancelados} canceladas`} />
              <DayBudget dia={data.dia} />
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-5">
                <Table title="Por agente" first="Agente" rows={m.porAgente}/>
                <Table title="Por ticket" first="Ticket" rows={m.porTicket.map((r) => ({ ...r, rotulo: r.titulo || r.rotulo }))} />
              </div>
              <ByModel rows={m.porModelo} />
            </div>
          </>
        )}

        {router && (
          <form onSubmit={saveRouter} aria-label="Roteador" className="flex flex-col gap-3.5 rounded-lg border border-line bg-panel p-4">
            <h2 className="m-0 text-[15px] font-semibold">Roteador</h2>
            <p className="m-0 text-xs leading-normal text-muted">
              Vale para agentes com <code className="font-mono">roteamento: auto</code> no arquivo. Regras gratuitas decidem primeiro; só se não decidirem, o tier pequeno classifica. Cada reprovação sobe um tier.
            </p>
            <table className="w-full text-left">
              <thead>
                <tr className="owl-label text-[10px]">
                  <th className="pb-2 font-normal">Tier</th>
                  <th className="pb-2 font-normal">Provedor</th>
                  <th className="pb-2 font-normal">Modelo</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-2 pr-3">
                      {t.label}
                      <span className="block text-xs text-muted">{t.hint}</span>
                    </td>
                    <td className="pr-3">
                      <label className="sr-only" htmlFor={`${t.id}-provedor`}>
                        Provedor do tier {t.label}
                      </label>
                      <select id={`${t.id}-provedor`} name={`${t.id}-provedor`} defaultValue={router.tiers[t.id].provedor} className={`${field} font-mono`}>
                        {[...new Set([router.tiers[t.id].provedor, ...providers.map((p) => p.id)])].map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${t.id}-modelo`}>
                        Modelo do tier {t.label}
                      </label>
                      <input id={`${t.id}-modelo`} name={`${t.id}-modelo`} defaultValue={router.tiers[t.id].modelo ?? ''} placeholder="padrão do provedor" maxLength={100} className={`${field} font-mono`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <fieldset className="m-0 flex flex-col gap-2.5 rounded-md border border-line p-3">
              <legend className="px-1 text-xs font-medium">Modelo local (Ollama)</legend>
              <Switch checked={localAtivo} onChange={setLocalAtivo} label="Usar no tier pequeno quando estiver no ar" />
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Modelo instalado
                <input name="localModelo" list="modelos-locais" defaultValue={router.localPequeno.modelo ?? ''} placeholder="o primeiro instalado" maxLength={100} className={`${field} font-mono`} />
                <datalist id="modelos-locais">
                  {(local?.modelos ?? []).map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Memória da placa de vídeo
                <select name="localMemoria" defaultValue={router.localPequeno.memoria ?? 'auto'} className={field}>
                  <option value="auto">Automático: quente quando você espera a resposta, solta logo após trabalho em segundo plano</option>
                  <option value="rapido">Sempre rápido: mantém o modelo carregado por 5 min</option>
                  <option value="economico">Econômico: descarrega após cada uso (recarrega a cada chamada)</option>
                </select>
              </label>
              <p className="m-0 text-xs leading-normal text-muted">
                <span aria-hidden="true" className="font-mono">{local?.disponivel ? '✓ ' : '⊘ '}</span>
                {local?.disponivel ? `Ollama no ar com ${local.modelos.length} modelo(s).` : 'Ollama fora do ar: o tier pequeno usa o provedor configurado acima.'}{' '}
                Só vale para passos sem ferramentas (classificador, resumos); quem precisa editar arquivos continua no provedor do tier.
              </p>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Confiança mínima para decidir sozinho (%)
                <input name="limiar" type="number" min={0} max={100} step={1} defaultValue={Math.round(router.limiarConfianca * 100)} className={`${field} font-mono`} />
                <span>Abaixo disso o ticket espera a sua aprovação do tier.</span>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Orçamento diário (tokens)
                <input name="orcamentoDia" inputMode="numeric" defaultValue={router.orcamentoDiaTokens ?? ''} placeholder="sem limite" className={`${field} font-mono`} />
                <span>Aviso em 80%. Ao estourar, o próximo passo de cada ticket pede aprovação. O dia vira à meia-noite local.</span>
              </label>
            </div>
            <div>
              <Button type="submit" variant="primary">
                Salvar roteador
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <dl className="m-0 flex flex-col gap-1 bg-panel px-4 py-3.5">
      <dt className="owl-label text-[10px]">{label}</dt>
      <dd className="m-0 font-mono text-2xl tabular-nums">{value}</dd>
      {hint && <dd className="m-0 text-[11px] text-muted">{hint}</dd>}
    </dl>
  );
}

/** Today's token budget: a number and a bar; the text carries the state (the bar colour never does alone). */
function DayBudget({ dia }: { dia: DayUsage }) {
  const share = Math.min(1, dia.percentual ?? 0);
  return (
    <section aria-label="Orçamento do dia" className="flex flex-col gap-1.5 bg-panel px-4 py-3.5">
      <span className="owl-label text-[10px]">Orçamento hoje</span>
      {dia.limite == null ? (
        <>
          <span className="font-mono text-2xl tabular-nums">sem limite</span>
          <span className="text-[11px] text-muted">{tokens(dia.usado)} tokens hoje</span>
        </>
      ) : (
        <>
          <span className={`font-mono text-2xl tabular-nums ${dia.estourado ? 'text-danger' : ''}`}>{pct(dia.percentual)}</span>
          <div role="progressbar" aria-label="Uso do orçamento diário" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} className="block h-1 overflow-hidden rounded-sm bg-raised">
            <div className={`h-full ${dia.estourado ? 'bg-danger' : 'bg-fg'}`} style={{ width: `${share * 100}%` }} />
          </div>
          <span className="text-[11px] text-muted">
            {tokens(dia.usado)} de {tokens(dia.limite)} tokens
            {dia.estourado && <span className="text-danger"> · estourado: os próximos passos pedem aprovação</span>}
            {dia.aviso && ' · acima de 80%'}
          </span>
        </>
      )}
    </section>
  );
}

function Table({ title, first, rows }: { title: string; first: string; rows: MetricsRow[] }) {
  const top = Math.max(0, ...rows.map((r) => r.custo));
  return (
    <section aria-label={title} className="overflow-hidden rounded-lg border border-line bg-panel">
      <h2 className="m-0 px-4 pb-1 pt-3 text-[13px] font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="m-0 px-4 pb-3 pt-1 text-muted">Nada no período.</p>
      ) : (
        <table className="w-full text-left font-mono text-xs tabular-nums">
          <thead>
            <tr className="owl-label border-b border-line text-[10px]">
              <th className="px-4 py-2.5 font-normal">{first}</th>
              <th className="px-2 py-2.5 text-right font-normal">Execuções</th>
              <th className="px-2 py-2.5 text-right font-normal">Sucesso</th>
              <th className="px-2 py-2.5 text-right font-normal">Retrabalho</th>
              <th className="px-2 py-2.5 text-right font-normal">Tokens</th>
              <th className="px-4 py-2.5 font-normal">Custo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.chave} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2">
                  {r.rotulo}
                </td>
                <td className="px-2 text-right">{r.runs}</td>
                <td className="px-2 text-right">{pct(r.taxaSucesso)}</td>
                <td className="px-2 text-right">{r.retrabalho}</td>
                <td className="px-2 text-right text-muted">{tokens(r.tokensIn + r.tokensOut)}</td>
                <td className="px-4">
                  <span className="flex items-center gap-2">
                    <span className="block h-1.5 flex-1 overflow-hidden rounded-sm bg-raised">
                      <span className="block h-full bg-line-strong" style={{ width: top ? `${(r.custo / top) * 100}%` : '0%' }} />
                    </span>
                    <span className="w-14 text-right">{fmtUsd(r.custo)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Tokens per model, as bars tinted by the provider (a model key is `provider/model`). */
function ByModel({ rows }: { rows: MetricsRow[] }) {
  const top = Math.max(0, ...rows.map((r) => r.tokensIn + r.tokensOut));
  return (
    <section aria-label="Por modelo" className="flex h-fit flex-col gap-3 rounded-lg border border-line bg-panel px-4 py-3.5">
      <h2 className="m-0 text-[13px] font-semibold">Por modelo</h2>
      {rows.length === 0 && <p className="m-0 text-muted">Nada no período.</p>}
      {rows.map((r) => {
        const provider = r.chave.split('/')[0];
        const total = r.tokensIn + r.tokensOut;
        return (
          <div key={r.chave} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <ProviderDot provider={provider} />
              {r.rotulo}
              <span className="flex-1" />
              <span className="text-muted">{tokens(total)} tokens</span>
            </span>
            <span className="block h-1.5 overflow-hidden rounded-sm bg-raised">
              <span className="block h-full" style={{ width: top ? `${(total / top) * 100}%` : '0%', background: `var(--c-prov-${provider === 'claude-cli' || provider === 'codex-cli' || provider === 'ollama' ? provider : 'other'})` }} />
            </span>
          </div>
        );
      })}
    </section>
  );
}
