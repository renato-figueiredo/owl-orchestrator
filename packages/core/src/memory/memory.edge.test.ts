import { describe, expect, it } from 'vitest';
import { estimateTokens, montarContexto } from './context.js';
import { parseSummaryOutput } from './summary.js';

describe('montarContexto (bordas)', () => {
  it('um fato gigante, emoji e ultimasN=0 nunca passam do orçamento', () => {
    for (const orcamentoTokens of [0, 1, 30, 60, 200, 1000]) {
      const r = montarContexto(
        {
          fatos: ['😀'.repeat(5000), 'curto'],
          resumo: 'ç'.repeat(3000),
          mensagens: [{ papel: 'usuario', conteudo: 'x'.repeat(4000) }],
          trechos: ['y'.repeat(2000)],
        },
        { orcamentoTokens, ultimasN: 0 },
      );
      expect(estimateTokens(r.texto)).toBeLessThanOrEqual(orcamentoTokens);
      expect(r.camadas.mensagens).toBe(0);
    }
  });
});

describe('parseSummaryOutput (bordas)', () => {
  it('resumo vazio, tipos errados e JSON truncado retornam null', () => {
    for (const raw of ['{"resumo":"  "}', '{"resumo":1}', '{"resumo":"ok","fatos_novos":"x"}', '{"resumo":"ok"', '[]', '']) {
      expect(parseSummaryOutput(raw)).toBeNull();
    }
  });
});
