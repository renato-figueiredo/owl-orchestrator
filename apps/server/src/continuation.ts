/** A follow-up an agent asked for at the end of its answer: `PROXIMO: <title> | <short description>`. */
export interface NextTicket {
  titulo: string;
  descricao?: string;
}

const LINE = /^\s*PR[OÓ]XIMO:\s*(.+)$/gim;
export const MAX_NEXT = 3;
/** A follow-up of a follow-up of a follow-up stops here: a chain must not grow on its own without a person looking. */
export const MAX_SEQ_DEPTH = 3;

export function parseNext(text: string): NextTicket[] {
  const out: NextTicket[] = [];
  for (const m of text.matchAll(LINE)) {
    const [titulo, ...rest] = (m[1] ?? '').split('|').map((s) => s.trim());
    if (!titulo || titulo.length < 4) continue;
    const descricao = rest.join(' | ').trim();
    out.push({ titulo: titulo.slice(0, 120), ...(descricao ? { descricao: descricao.slice(0, 1500) } : {}) });
    if (out.length === MAX_NEXT) break;
  }
  return out;
}

const DEPTH = /Continuação \(nível (\d+)\)/;
/** How many continuations deep a ticket already is (0 for an ordinary one). */
export const seqDepth = (descricao: string | null): number => Number(DEPTH.exec(descricao ?? '')?.[1] ?? 0);
export const seqMarker = (level: number, from: string): string => `Continuação (nível ${level}) de ${from}.`;
