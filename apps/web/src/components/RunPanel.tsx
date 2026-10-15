import { fmtCost, fmtTokens } from '../lib/format';
import type { StreamState } from '../lib/stream';
import type { Run } from '../lib/types';

const STATUS: Record<Run['status'], { label: string; cls: string }> = {
  rodando: { label: 'rodando', cls: 'text-accent' },
  ok: { label: 'ok', cls: 'text-ok' },
  erro: { label: 'erro', cls: 'text-danger' },
  cancelado: { label: 'cancelado', cls: 'text-muted' },
};

const preview = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 140 ? `${s.slice(0, 140)}…` : (s ?? '');
};

export function RunPanel({ runs, stream, open, onToggle }: { runs: Run[]; stream: StreamState | null; open: boolean; onToggle: () => void }) {
  const totalIn = runs.reduce((a, r) => a + (r.tokensIn ?? 0), 0);
  const totalOut = runs.reduce((a, r) => a + (r.tokensOut ?? 0), 0);
  const totalCost = runs.reduce((a, r) => a + (r.custoEstimado ?? 0), 0);

  if (!open) {
    return (
      <aside className="border-l border-line bg-panel p-1">
        <button type="button" onClick={onToggle} aria-expanded={false} aria-label="Abrir painel de execução" className="rounded px-2 py-1 text-muted hover:bg-raised hover:text-fg">
          ◂
        </button>
      </aside>
    );
  }
  return (
    <aside aria-label="Execução" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line p-3">
        <h2 className="font-semibold">Execução</h2>
        <button type="button" onClick={onToggle} aria-expanded aria-label="Recolher painel de execução" className="rounded px-2 py-1 text-muted hover:bg-raised hover:text-fg">
          ▸
        </button>
      </div>

      {stream && (
        <section className="border-b border-line p-3" aria-label="Execução atual">
          <p className="text-sm">
            Status: <strong>{{ connecting: 'conectando', running: 'rodando', ended: 'concluída', error: 'erro', cancelled: 'cancelada' }[stream.phase]}</strong>
          </p>
          {(stream.provider || stream.model) && (
            <p className="text-xs text-muted">
              {stream.provider}
              {stream.model ? ` · ${stream.model}` : ''}
            </p>
          )}
          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Ferramentas</h3>
          {stream.tools.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma até agora.</p>
          ) : (
            <ol className="mt-1 space-y-1">
              {stream.tools.map((t, i) => (
                <li key={i} className="rounded border border-line bg-raised px-2 py-1 text-sm">
                  <span className="font-mono">{t.name}</span>
                  {t.input !== undefined && <span className="block truncate font-mono text-xs text-muted">{preview(t.input)}</span>}
                </li>
              ))}
            </ol>
          )}
          {(stream.inputTokens !== undefined || stream.outputTokens !== undefined) && (
            <p className="mt-2 text-sm">
              Tokens: {fmtTokens(stream.inputTokens)} entrada · {fmtTokens(stream.outputTokens)} saída
              {stream.costUsd !== undefined && ` · ${fmtCost(stream.costUsd)}`}
            </p>
          )}
        </section>
      )}

      <section className="p-3" aria-label="Histórico de execuções">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Execuções da conversa</h3>
        {runs.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nenhuma ainda.</p>
        ) : (
          <>
            <ul className="mt-1 space-y-1">
              {runs.map((r) => (
                <li key={r.id} className={`rounded border border-line bg-raised px-2 py-1 text-sm ${r.parentRunId ? 'ml-4 border-l-2 border-l-accent' : ''}`}>
                  {r.etapa && <div className="text-xs font-semibold uppercase tracking-wide text-muted">{r.etapa}</div>}
                  <div className="flex justify-between">
                    <span>{r.provedor}{r.modelo ? ` · ${r.modelo}` : ''}</span>
                    <span className={STATUS[r.status].cls}>{STATUS[r.status].label}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {fmtTokens(r.tokensIn)} ent · {fmtTokens(r.tokensOut)} saí · {fmtCost(r.custoEstimado)}
                  </div>
                  {r.erro && <div className="truncate text-xs text-danger" title={r.erro}>{r.erro}</div>}
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-line pt-2 text-sm" data-testid="session-total">
              Total: {fmtTokens(totalIn)} ent · {fmtTokens(totalOut)} saí · {fmtCost(totalCost)}
            </p>
          </>
        )}
      </section>
    </aside>
  );
}
