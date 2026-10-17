// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hashOf, parseHash } from './lib/nav';

describe('nav hash', () => {
  it('round-trips a view and a ticket id', () => {
    expect(parseHash(hashOf('board'))).toEqual({ view: 'board', ticketId: null });
    expect(parseHash(hashOf('board', 'a b/1'))).toEqual({ view: 'board', ticketId: 'a b/1' });
  });
  it('ignores addresses that are not ours', () => {
    expect(parseHash('')).toEqual({ view: null, ticketId: null });
    expect(parseHash('#/nada')).toEqual({ view: null, ticketId: null });
    expect(parseHash('#/board/ticket/')).toEqual({ view: null, ticketId: null });
  });
});
