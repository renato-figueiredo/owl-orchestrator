import { describe, expect, it } from 'vitest';
import { applyFilters, NO_FILTER } from './components/BoardExtras';
import type { Ticket } from './lib/types';

const t = (o: Partial<Ticket>) => ({ id: o.identificador, titulo: 'x', identificador: 'SEL-1', prioridade: 0, responsavel: null, estimativa: null, cicloId: null, etiquetas: [], bloqueadoPor: [], ...o }) as unknown as Ticket;

describe('applyFilters', () => {
  const list = [
    t({ identificador: 'SEL-1', titulo: 'Resumo do chat', responsavel: 'dev-back', prioridade: 4, estimativa: 2, etiquetas: [{ id: 'l1', nome: 'memória', cor: '#fff' }] }),
    t({ identificador: 'SEL-2', titulo: 'Botão', responsavel: 'dev-front', bloqueadoPor: ['SEL-1'] as never }),
    t({ identificador: 'SEL-3', titulo: 'Sem nada' }),
  ];
  const ids = (f: Partial<typeof NO_FILTER>) => applyFilters(list, { ...NO_FILTER, ...f }).map((x) => x.identificador);

  it('no filter keeps everything', () => expect(ids({})).toHaveLength(3));
  it('search matches title or identifier, ignoring case', () => {
    expect(ids({ busca: 'resumo' })).toEqual(['SEL-1']);
    expect(ids({ busca: 'sel-3' })).toEqual(['SEL-3']);
  });
  it('assignee, priority, label and status filters, including "none"', () => {
    expect(ids({ responsavel: 'dev-front' })).toEqual(['SEL-2']);
    expect(ids({ responsavel: 'none' })).toEqual(['SEL-3']);
    expect(ids({ prioridade: '4' })).toEqual(['SEL-1']);
    expect(ids({ prioridade: 'none' })).toEqual(['SEL-2', 'SEL-3']);
    expect(ids({ etiqueta: 'none' })).toEqual(['SEL-2', 'SEL-3']);
    expect(ids({ situacao: 'bloqueado' })).toEqual(['SEL-2']);
    expect(ids({ situacao: 'livre' })).toEqual(['SEL-1', 'SEL-3']);
    expect(ids({ situacao: 'sem-estimativa' })).toEqual(['SEL-2', 'SEL-3']);
  });
});
