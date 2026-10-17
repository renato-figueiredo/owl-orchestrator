import { describe, expect, it } from 'vitest';
import { triage } from './triage.js';

describe('triage', () => {
  it('ignores the import boilerplate: "Origem: docs/backlog-dogfood.md" is not a docs ticket', () => {
    const r = triage({ titulo: 'Rotas de fatos: conferir pertencimento', descricao: 'PATCH em apps/server/src/app.ts não verifica o escopo.\n\nOrigem: docs/backlog-dogfood.md, item 4.', criteriosAceite: 'Responde 404' });
    expect(r.etiquetas).not.toContain('docs');
    expect(r.etiquetas).toContain('backend');
    expect(r.prioridade).toBeGreaterThanOrEqual(2);
  });
  it('security and data loss are urgent, bugs high, cosmetic low', () => {
    const t = (titulo: string, descricao = '') => triage({ titulo, descricao, criteriosAceite: null }).prioridade;
    expect(t('Vazamento de leitura fora do worktree')).toBe(4);
    expect(t('Corrigir bug no resumo')).toBe(3);
    expect(t('Ajuste cosmético no botão')).toBe(1);
    expect(t('Novo painel')).toBe(2);
  });
  it('interface-only work goes to dev-front', () => {
    expect(triage({ titulo: 'Seletor na tela', descricao: 'apps/web/src/components/X.tsx', criteriosAceite: null }).agente).toBe('dev-front');
  });
});
