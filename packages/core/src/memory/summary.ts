import { z } from 'zod';
import type { ContextMessage } from './context.js';

const clip = (max: number) => (s: string) => s.trim().slice(0, max);
const list = z
  .array(z.string())
  .default([])
  .transform((a) => a.map(clip(500)).filter(Boolean).slice(0, 20));

/** What the summarizer must answer. Extra keys are ignored; missing lists default to empty. */
export const summaryOutputSchema = z.object({
  resumo: z.string().transform(clip(8000)).pipe(z.string().min(1)),
  fatos_novos: list,
  pendencias: list,
});
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

/** System instructions for the summarizer agent (sent as the CLI's appended system prompt). */
export const SUMMARY_SYSTEM = `Você mantém o resumo de uma conversa entre um usuário e um assistente de programação.
Receba o RESUMO ANTERIOR (pode estar vazio) e as MENSAGENS NOVAS e devolva SOMENTE um objeto JSON, sem texto fora dele e sem cercas de código:
{"resumo": "...", "fatos_novos": ["..."], "pendencias": ["..."]}

Regras:
- "resumo": texto corrido, conciso, que substitui o anterior: junte o que valia do resumo anterior com o que as mensagens novas acrescentam.
  Mantenha objetivo, estado atual, arquivos/nomes importantes e o que foi tentado.
- "fatos_novos": decisões, preferências e regras que devem valer daqui para frente (uma frase cada). Decisões NÃO ficam só no resumo: viram fatos.
  Não repita fatos já óbvios e não invente nada que não esteja nas mensagens.
- "pendencias": o que ainda falta fazer ou responder (pode ser lista vazia).
- Mantenha o idioma da conversa.`;

/** The user-side text of a summarizer call: the previous summary and ONLY the messages after it. */
export function buildSummaryPrompt(input: { resumoAnterior?: string | null | undefined; mensagens: readonly ContextMessage[] }): string {
  const novas = input.mensagens.map((m) => `${m.papel === 'usuario' ? 'Usuário' : 'Assistente'}: ${m.conteudo}`).join('\n\n');
  return `RESUMO ANTERIOR:\n${input.resumoAnterior?.trim() || '(vazio)'}\n\nMENSAGENS NOVAS:\n${novas}`;
}

/**
 * Reads the summarizer's answer. Tolerates a code fence or a sentence around the JSON, which models add despite being told
 * not to. Anything that does not validate returns null: the caller must then keep the existing summary untouched.
 */
export function parseSummaryOutput(raw: string): SummaryOutput | null {
  const candidates: string[] = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const text of candidates) {
    try {
      const parsed = summaryOutputSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** The stored summary text: the summary itself plus the open items, so a reader of the summary alone sees both. */
export function renderSummary(out: SummaryOutput): string {
  return out.pendencias.length > 0 ? `${out.resumo}\n\nPendências:\n${out.pendencias.map((p) => `- ${p}`).join('\n')}` : out.resumo;
}
