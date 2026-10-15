const nf = new Intl.NumberFormat('pt-BR');
export const fmtTokens = (n: number | null | undefined) => (n == null ? '–' : nf.format(n));
export const fmtCost = (n: number | null | undefined) =>
  n == null ? '–' : `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
