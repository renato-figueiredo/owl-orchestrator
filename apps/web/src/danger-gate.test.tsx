// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { DangerGate, needsTyping } from './components/DangerGate';
import type { TicketApproval } from './lib/types';

const gate = { id: 'g', ticketId: 't', motivo: '⚠ COMANDO PERIGOSO. dev-back pede permissão para rodar:\npnpm add left-pad', tipo: 'permissao', status: 'pendente', comentario: null, criadoEm: null, retomar: { confirmar: 'pnpm add left-pad' } } as TicketApproval;

describe('DangerGate', () => {
  it('approves only after the command is typed exactly, and sends what was typed', () => {
    const onDecide = vi.fn();
    render(<DangerGate approval={gate} onDecide={onDecide} />);
    const approve = screen.getByRole('button', { name: /aprovar e executar/i });
    expect(approve).toBeDisabled();
    const input = screen.getByLabelText('Digite o comando para confirmar');
    fireEvent.change(input, { target: { value: 'pnpm add left-pa' } });
    expect(approve).toBeDisabled();
    fireEvent.change(input, { target: { value: 'pnpm add left-pad' } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(onDecide).toHaveBeenCalledWith('aprovado', undefined, 'pnpm add left-pad');
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
