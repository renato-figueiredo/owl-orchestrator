import { describe, expect, it } from 'vitest';
import { estimateTokens, montarContexto, type ContextInput } from './context.js';
import { buildSummaryPrompt, parseSummaryOutput, renderSummary } from './summary.js';

const msg = (papel: 'usuario' | 'assistente', conteudo: string) => ({ papel, conteudo });
const input = (over: Partial<ContextInput> = {}): ContextInput => ({ fatos: [], mensagens: [], ...over });

describe('ultimasN = 0', () => {
  it('sends no messages at all (slice(-0) would send them all)', () => {
    const c = montarContexto(
      input({ fatos: ['usar pnpm'], mensagens: [msg('usuario', 'oi'), msg('assistente', 'olá')] }),
      { orcamentoTokens: 2000, ultimasN: 0 },
    );
    expect(c.camadas.mensagens).toBe(0);
    expect(c.texto).not.toContain('olá');
    expect(c.texto).toContain('usar pnpm');
  });
});

describe('estimateTokens', () => {
  it('is characters / 4, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('montarContexto', () => {
  it('layers appear in priority order: facts, summary, recent messages, snippets', () => {
    const c = montarContexto(
      input({ fatos: ['usar pnpm'], resumo: 'Estamos criando o login.', mensagens: [msg('usuario', 'oi'), msg('assistente', 'olá')], trechos: ['decidimos usar JWT'] }),
      { orcamentoTokens: 2000, ultimasN: 8 },
    );
    const t = c.texto;
    const at = (s: string) => t.indexOf(s);
    expect(at('Fatos fixados')).toBeGreaterThan(-1);
    expect(at('Fatos fixados')).toBeLessThan(at('Resumo da conversa'));
    expect(at('Resumo da conversa')).toBeLessThan(at('Mensagens recentes'));
    expect(at('Mensagens recentes')).toBeLessThan(at('Trechos relacionados'));
    expect(t).toContain('- usar pnpm');
    expect(t).toContain('Usuário: oi\nAssistente: olá');
    expect(c.camadas).toEqual({ fatos: 1, resumo: true, mensagens: 2, trechos: 1 });
    expect(c.truncado).toBe(false);
  });

  it('empty input or a budget too small for the frame yields no context at all', () => {
    expect(montarContexto(input(), { orcamentoTokens: 1000, ultimasN: 8 }).texto).toBe('');
    const tiny = montarContexto(input({ fatos: ['x'] }), { orcamentoTokens: 5, ultimasN: 8 });
    expect(tiny.texto).toBe('');
    expect(tiny.truncado).toBe(true);
    expect(montarContexto(input({ fatos: ['x'] }), { orcamentoTokens: 0, ultimasN: 8 }).texto).toBe('');
  });

  it('only the last N messages enter, and when space is short the NEWEST win', () => {
    const many = Array.from({ length: 20 }, (_, i) => msg(i % 2 ? 'assistente' : 'usuario', `mensagem número ${i} ${'x'.repeat(60)}`));
    const all = montarContexto(input({ mensagens: many }), { orcamentoTokens: 4000, ultimasN: 4 });
    expect(all.camadas.mensagens).toBe(4);
    expect(all.texto).toContain('número 19');
    expect(all.texto).toContain('número 16');
    expect(all.texto).not.toContain('número 15');
    expect(all.truncado).toBe(true);

    // a budget that holds ~2 messages keeps the two newest, in chronological order
    const room = montarContexto(input({ mensagens: many }), { orcamentoTokens: 150, ultimasN: 20 });
    expect(room.texto).toContain('número 19');
    expect(room.texto).not.toContain('número 0 ');
    expect(room.texto.indexOf('número 18')).toBeLessThan(room.texto.indexOf('número 19'));
  });

  it('a summary bigger than the budget is cut, not dropped', () => {
    const c = montarContexto(input({ resumo: 'palavra '.repeat(2000) }), { orcamentoTokens: 300, ultimasN: 8 });
    expect(c.camadas.resumo).toBe(true);
    expect(c.texto).toContain('…');
    expect(c.tokens).toBeLessThanOrEqual(300);
    expect(c.truncado).toBe(true);
  });

  it('pinned facts are never pushed out by lower layers', () => {
    const c = montarContexto(
      input({ fatos: ['fato A', 'fato B'], resumo: 'r'.repeat(5000), mensagens: [msg('usuario', 'm'.repeat(5000))] }),
      { orcamentoTokens: 120, ultimasN: 8 },
    );
    expect(c.texto).toContain('- fato A');
    expect(c.texto).toContain('- fato B');
  });

  it('NEVER exceeds the budget (randomised: 3000 cases)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const text = (max: number) => 'á'.repeat(Math.floor(rnd() * max));
    for (let n = 0; n < 3000; n++) {
      const orcamentoTokens = Math.floor(rnd() * 1500);
      const c = montarContexto(
        {
          fatos: Array.from({ length: Math.floor(rnd() * 8) }, () => text(300)),
          resumo: rnd() < 0.8 ? text(4000) : null,
          mensagens: Array.from({ length: Math.floor(rnd() * 30) }, () => msg(rnd() < 0.5 ? 'usuario' : 'assistente', text(1500))),
          trechos: Array.from({ length: Math.floor(rnd() * 6) }, () => text(600)),
        },
        { orcamentoTokens, ultimasN: Math.floor(rnd() * 25) },
      );
      expect(estimateTokens(c.texto), `case ${n}`).toBeLessThanOrEqual(orcamentoTokens);
      expect(c.tokens).toBe(estimateTokens(c.texto));
    }
  });

  it('respects the exact budget it was given (property over many budgets)', () => {
    const base = input({
      fatos: ['a'.repeat(200), 'b'.repeat(200)],
      resumo: 'r'.repeat(3000),
      mensagens: Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'assistente' : 'usuario', 'm'.repeat(400))),
      trechos: ['t'.repeat(500), 't'.repeat(500)],
    });
    for (let budget = 0; budget <= 2500; budget += 7) {
      const c = montarContexto(base, { orcamentoTokens: budget, ultimasN: 12 });
      expect(c.tokens, `budget ${budget}`).toBeLessThanOrEqual(budget);
      expect(estimateTokens(c.texto), `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });
});

describe('parseSummaryOutput', () => {
  const ok = '{"resumo":"Fizemos X.","fatos_novos":["Usar pnpm"],"pendencias":["Testar Y"]}';

  it('reads a clean JSON object', () => {
    expect(parseSummaryOutput(ok)).toEqual({ resumo: 'Fizemos X.', fatos_novos: ['Usar pnpm'], pendencias: ['Testar Y'] });
  });
  it('tolerates a code fence and chatter around the JSON', () => {
    expect(parseSummaryOutput('```json\n' + ok + '\n```')?.resumo).toBe('Fizemos X.');
    expect(parseSummaryOutput('Claro! Aqui está:\n' + ok + '\nEspero ajudar.')?.resumo).toBe('Fizemos X.');
  });
  it('defaults missing lists and ignores extra keys', () => {
    expect(parseSummaryOutput('{"resumo":"só isso","extra":1}')).toEqual({ resumo: 'só isso', fatos_novos: [], pendencias: [] });
  });
  it('rejects anything invalid: null, so the caller keeps the old summary', () => {
    for (const bad of ['', 'ok', '{', '{"resumo":""}', '{"resumo":"   "}', '{"resumo":5}', '{"fatos_novos":["x"]}', '[]', 'null', '{"resumo":"x","fatos_novos":"não é lista"}']) {
      expect(parseSummaryOutput(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('bounds what a model can make us store', () => {
    const out = parseSummaryOutput(JSON.stringify({ resumo: 'r'.repeat(20_000), fatos_novos: Array.from({ length: 100 }, (_, i) => `fato ${i} ${'x'.repeat(900)}`) }))!;
    expect(out.resumo.length).toBe(8000);
    expect(out.fatos_novos).toHaveLength(20);
    expect(out.fatos_novos.every((f) => f.length <= 500)).toBe(true);
  });
});

describe('summary text', () => {
  it('renderSummary appends open items', () => {
    expect(renderSummary({ resumo: 'R', fatos_novos: [], pendencias: [] })).toBe('R');
    expect(renderSummary({ resumo: 'R', fatos_novos: [], pendencias: ['a', 'b'] })).toBe('R\n\nPendências:\n- a\n- b');
  });
  it('buildSummaryPrompt carries the previous summary and the new messages only', () => {
    const p = buildSummaryPrompt({ resumoAnterior: 'antes', mensagens: [msg('usuario', 'novo pedido'), msg('assistente', 'nova resposta')] });
    expect(p).toContain('RESUMO ANTERIOR:\nantes');
    expect(p).toContain('Usuário: novo pedido\n\nAssistente: nova resposta');
    expect(buildSummaryPrompt({ mensagens: [] })).toContain('(vazio)');
  });
});
