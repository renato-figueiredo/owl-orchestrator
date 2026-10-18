// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionGate } from './components/QuestionGate';

afterEach(cleanup);

describe('QuestionGate', () => {
  it('cannot be approved without an answer, and sends the answer as the comment', () => {
    const onDecide = vi.fn();
    render(<QuestionGate onDecide={onDecide} />);
    const send = screen.getByRole('button', { name: /responder/i });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Resposta para o agente'), { target: { value: ' deixe sem entrada ' } });
    fireEvent.click(send);
    expect(onDecide).toHaveBeenCalledWith('aprovado', 'deixe sem entrada');
  });
  it('lets the agent decide when the person has no answer', () => {
    const onDecide = vi.fn();
    render(<QuestionGate onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /deixar o agente decidir/i }));
    expect(onDecide).toHaveBeenCalledWith('rejeitado', expect.stringContaining('melhor suposição'));
  });
  it('suggested answers fill the box (editable), from the agent or Sim/Não for a yes-or-no question', () => {
    const onDecide = vi.fn();
    const q = { motivo: 'Devo manter a coluna antiga?', retomar: { opcoes: ['Mantenha', 'Remova'] } } as never;
    const { unmount } = render(<QuestionGate approval={q} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remova' }));
    expect(screen.getByLabelText('Resposta para o agente')).toHaveValue('Remova');
    unmount();
    render(<QuestionGate approval={{ motivo: 'Devo manter a coluna antiga?', retomar: null } as never} onDecide={onDecide} />);
    expect(screen.getByRole('button', { name: 'Sim' })).toBeInTheDocument();
  });
});
