/** Rough token estimate (characters / 4): enough to keep prompts inside a budget without a tokenizer. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface ContextMessage {
  papel: 'usuario' | 'assistente';
  conteudo: string;
}

export interface ContextInput {
  /** Pinned facts, oldest first. */
  fatos: readonly string[];
  /** Rolling summary of the conversation. */
  resumo?: string | null | undefined;
  /** Messages in chronological order (the caller already removed the current request and non-chat roles). */
  mensagens: readonly ContextMessage[];
  /** Retrieved snippets (full-text search), already filtered for relevance. */
  trechos?: readonly string[] | undefined;
}

export interface ContextOptions {
  /** Hard ceiling, in estimated tokens, for the whole block (headings included). */
  orcamentoTokens: number;
  /** How many of the latest messages may enter (in full, as far as the budget allows). */
  ultimasN: number;
}

export interface AssembledContext {
  /** Ready to be placed before the request. Empty when there is nothing to say or the budget cannot hold the frame. */
  texto: string;
  tokens: number;
  camadas: { fatos: number; resumo: boolean; mensagens: number; trechos: number };
  /** True when something that would otherwise enter was left out or cut to fit. */
  truncado: boolean;
}

const HEAD =
  '[Contexto mantido pelo OWL para continuar esta conversa. Use como referência e responda apenas ao pedido que vem depois dele.]\n\n';
const FOOT = '[Fim do contexto]\n\n';
const ELLIPSIS = '…';
/** Below this many characters a truncated piece is not worth including. */
const MIN_USEFUL = 80;

const EMPTY: AssembledContext = {
  texto: '',
  tokens: 0,
  camadas: { fatos: 0, resumo: false, mensagens: 0, trechos: 0 },
  truncado: false,
};

const label = (m: ContextMessage) => (m.papel === 'usuario' ? 'Usuário' : 'Assistente');

/**
 * Builds the memory block sent with a request when the CLI has no native session to resume. Layers, in priority
 * order: pinned facts → summary → latest messages → retrieved snippets. Each layer takes what fits in the budget that
 * is left; the total (measured in characters, 4 per token) NEVER exceeds `orcamentoTokens`.
 */
export function montarContexto(input: ContextInput, opts: ContextOptions): AssembledContext {
  const budget = Math.max(0, Math.floor(opts.orcamentoTokens)) * 4;
  let left = budget - HEAD.length - FOOT.length;
  if (left <= 0) return { ...EMPTY, truncado: hasAnything(input) };

  let truncado = false;
  const sections: string[] = [];
  const camadas = { fatos: 0, resumo: false, mensagens: 0, trechos: 0 };

  /** Adds `title` + the lines that fit (as a list, in order). Returns how many lines were kept. */
  const addList = (title: string, lines: readonly string[], fromEnd = false): string[] => {
    const heading = `## ${title}\n`;
    const kept: string[] = [];
    let room = left - heading.length - 1; // 1 = the blank line closing the section
    const order = fromEnd ? [...lines].reverse() : [...lines];
    for (const line of order) {
      const cost = line.length + 1;
      if (cost > room) {
        truncado = true;
        // The most important line of the layer (first, or newest) may be cut instead of lost entirely.
        if (kept.length === 0 && room - 1 >= MIN_USEFUL) {
          kept.push(line.slice(0, room - 1 - ELLIPSIS.length) + ELLIPSIS);
          room = 0;
        }
        break;
      }
      kept.push(line);
      room -= cost;
    }
    if (fromEnd) kept.reverse();
    if (kept.length > 0) {
      const body = `${heading}${kept.join('\n')}\n\n`;
      sections.push(body);
      left -= body.length;
    }
    return kept;
  };

  camadas.fatos = addList('Fatos fixados', input.fatos.map((f) => `- ${f}`)).length;
  if (input.fatos.length > camadas.fatos) truncado = true;

  const resumo = input.resumo?.trim();
  if (resumo) {
    const kept = addList('Resumo da conversa até aqui', [resumo]);
    camadas.resumo = kept.length > 0;
  }

  const recent = opts.ultimasN > 0 ? input.mensagens.slice(-opts.ultimasN) : [];
  if (input.mensagens.length > recent.length) truncado = true;
  camadas.mensagens = addList(
    'Mensagens recentes',
    recent.map((m) => `${label(m)}: ${m.conteudo}`),
    true, // newest first when space is short: the latest turns matter most
  ).length;
  if (recent.length > camadas.mensagens) truncado = true;

  camadas.trechos = addList('Trechos relacionados de conversas anteriores', (input.trechos ?? []).map((t) => `- ${t}`)).length;

  if (sections.length === 0) return { ...EMPTY, truncado };
  const texto = `${HEAD}${sections.join('')}${FOOT}`;
  return { texto, tokens: estimateTokens(texto), camadas, truncado };
}

const hasAnything = (i: ContextInput) =>
  i.fatos.length > 0 || Boolean(i.resumo?.trim()) || i.mensagens.length > 0 || (i.trechos?.length ?? 0) > 0;
