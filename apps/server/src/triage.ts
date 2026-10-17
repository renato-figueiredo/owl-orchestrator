import type { Ticket } from '@owl/db';

/** What the monitor fills in for a ticket that arrived without it. Rules, not a model: free, repeatable, easy to read. */
export interface Triage {
  etiquetas: string[];
  prioridade: number;
  estimativa: number;
  /** `dev-front` for interface work, `dev-back` otherwise. */
  agente: 'dev-front' | 'dev-back';
}

const AREAS: Array<[label: string, re: RegExp]> = [
  ['frontend', /apps\/web|\.tsx\b|componente|interface|\btela\b|botão|\bUI\b/i],
  ['backend', /apps\/server|\bapp\.ts\b|\brota|endpoint|servidor/i],
  ['banco', /packages\/db|migra[çc][ãa]o|\.sql\b|sqlite|reposit[óo]rio/i],
  ['núcleo', /packages\/(?:core|board)|\bcore\b/i],
  ['memória', /memory\.ts|mem[óo]ria|resumo|\bfatos?\b/i],
  ['roteador', /router|roteador|métricas|metrics|or[çc]amento/i],
  ['ollama', /ollama|modelo local|\bgemma|\bqwen/i],
  ['segurança', /seguran[çc]a|vazamento|vazar|escopo|credencial|perde dado|perda de dado|permiss[ãa]o|inje[çc][ãa]o/i],
  ['docs', /\bdocs?\/|documenta[çc][ãa]o|readme|roadmap/i],
  ['testes', /\bteste|cobertura|vitest|playwright/i],
];

const CRITICAL = /seguran[çc]a|vazamento|vazar|perde dado|perda de dado|sobrescrev|corrup/i;
const BUG = /\bbug\b|errad|falha|quebr|incorret|corrig|n[ãa]o (?:pode|deve|funciona)/i;
const COSMETIC = /cosm[ée]tic|acabamento|renomear|coment[áa]rio|documenta[çc][ãa]o|\bdocs?\b/i;

const text = (t: Pick<Ticket, 'titulo' | 'descricao' | 'criteriosAceite'>) => [t.titulo, t.descricao ?? '', t.criteriosAceite ?? ''].join('\n');

export function triage(t: Pick<Ticket, 'titulo' | 'descricao' | 'criteriosAceite'>): Triage {
  const body = text(t);
  const etiquetas = AREAS.filter(([, re]) => re.test(body)).map(([l]) => l).slice(0, 4);
  const prioridade = CRITICAL.test(body) ? 4 : BUG.test(body) ? 3 : COSMETIC.test(body) ? 1 : 2;
  const size = body.length + (t.criteriosAceite?.split('\n').length ?? 0) * 80;
  const estimativa = size < 400 ? 1 : size < 900 ? 2 : size < 1800 ? 3 : 5;
  const front = etiquetas.includes('frontend') && !etiquetas.includes('backend') && !etiquetas.includes('banco');
  return { etiquetas, prioridade, estimativa, agente: front ? 'dev-front' : 'dev-back' };
}
