const nf = new Intl.NumberFormat('pt-BR');
export const fmtTokens = (n: number | null | undefined) => (n == null ? '–' : nf.format(n));
export const fmtCost = (n: number | null | undefined) =>
  n == null ? '–' : `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

/* Design formats (design readme, "Content fundamentals"): pt-BR numbers, `$0,042`, `18,4k`, `1,4s`, `01:12`; always tabular. */
/** 18432 → "18,4k"; small numbers stay whole. */
export const fmtCompact = (n: number | null | undefined) =>
  n == null ? '–' : n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: n >= 10000 ? 1 : 0 })}k` : nf.format(n);
/** Cost in dollars: `$0,042`. */
export const fmtUsd = (n: number | null | undefined) =>
  n == null ? '–' : `$${n.toLocaleString('pt-BR', { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;
/** Seconds → "01:12" (or "1:02:03" past an hour). */
export const fmtClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (v: number) => String(v).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};
/** Milliseconds → "1,4s" / "240ms". */
export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}s`);
