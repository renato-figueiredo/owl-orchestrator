// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { DangerGate, needsTyping } from './components/DangerGate';
import { canRemember, RememberButtons } from './components/RememberButtons';
import type { TicketApproval } from './lib/types';

const gate = { id: 'g', ticketId: 't', motivo: '⚠ COMANDO PERIGOSO. dev-back pede permissão para rodar:\npnpm add left-pad', tipo: 'permissao', status: 'pendente', comentario: null, criadoEm: null, retomar: { confirmar: 'pnpm add' } } as TicketApproval;

describe('DangerGate', () => {
  it('approves only after the highlighted word is typed exactly, and sends what was typed', () => {
    const onDecide = vi.fn();
    render(<DangerGate approval={gate} onDecide={onDecide} />);
    const approve = screen.getByRole('button', { name: /aprovar e executar/i });
    expect(approve).toBeDisabled();
    const input = screen.getByLabelText('Digite a palavra para confirmar');
    fireEvent.change(input, { target: { value: 'pnpm ad' } });
    expect(approve).toBeDisabled();
    fireEvent.change(input, { target: { value: 'pnpm add' } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(onDecide).toHaveBeenCalledWith('aprovado', undefined, 'pnpm add');
  });
  it('refusing asks for a reason and needs no typing', () => {
    const onDecide = vi.fn();
    render(<DangerGate approval={gate} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /recusar com motivo/i }));
    fireEvent.change(screen.getByLabelText('Motivo da recusa'), { target: { value: 'não instale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(onDecide).toHaveBeenCalledWith('rejeitado', 'não instale');
  });
  it('needsTyping is true only for gates that carry a command to confirm', () => {
    expect(needsTyping(gate)).toBe(true);
    expect(needsTyping({ retomar: null })).toBe(false);
  });
});

describe('RememberButtons', () => {
  const ok = { ...gate, motivo: 'dev-back pede permissão para rodar:\npnpm typecheck', retomar: { ferramentas: ['Bash(pnpm typecheck:*)'] } } as TicketApproval;
  it('offers to stop asking for an ordinary permission, and sends the choice', () => {
    const onDecide = vi.fn();
    render(<RememberButtons approval={ok} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /aprovar por 4 h/i }));
    expect(onDecide).toHaveBeenLastCalledWith('aprovado', undefined, undefined, 'sessao');
    fireEvent.click(screen.getByRole('button', { name: /aprovar e lembrar/i }));
    expect(onDecide).toHaveBeenLastCalledWith('aprovado', undefined, undefined, 'projeto');
  });
  it('never for a dangerous command or a permission with nothing general to keep', () => {
    expect(canRemember(gate)).toBe(false);
    expect(canRemember({ ...ok, retomar: { ferramentas: ['Bash(pnpm add x)'] } })).toBe(false);
    expect(canRemember({ ...ok, tipo: 'entrega' })).toBe(false);
  });
  it("the monitor's suggestion offers the project (plain approve) or the session", () => {
    render(<RememberButtons approval={{ ...ok, retomar: { conceder: { regra: 'Bash(make:*)' } } } as TicketApproval} onDecide={vi.fn()} />);
    expect(screen.getByRole('button', { name: /só por 4 h/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /aprovar e lembrar/i })).toBeNull();
  });
});
