import { describe, expect, it } from 'vitest';
import { tabTitle } from './lib/tab-status';

describe('tabTitle', () => {
  it('is just the name when nothing happens', () => expect(tabTitle(0, [])).toBe('OWL'));
  it('says what needs a person first', () => expect(tabTitle(3, [])).toBe('⚠ 3 aprovações — OWL'));
  it('names a single run and counts several', () => {
    expect(tabTitle(0, [{ agent: 'dev-back', label: 'SEL-50' }])).toBe('▶ dev-back · SEL-50 — OWL');
    expect(tabTitle(1, [{ agent: 'a', label: 'x' }, { agent: 'b', label: 'y' }])).toBe('⚠ 1 aprovação · ▶ 2 rodando — OWL');
  });
});
