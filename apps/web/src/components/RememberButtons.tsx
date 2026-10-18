import { Button } from '@owl/ui';
import { Check } from 'lucide-react';
import type { TicketApproval } from '../lib/types';
import type { DangerDecide } from './DangerGate';

/** Hours "this session" lasts on the server (`SESSION_HOURS`). */
export const SESSION_HOURS = 4;

/** An ordinary permission (no typing needed) with rules to keep, or the monitor's suggestion to stop asking. */
export const canRemember = (a: Pick<TicketApproval, 'tipo' | 'retomar'>): boolean =>
  a.tipo === 'permissao' && !a.retomar?.confirmar && Boolean(a.retomar?.conceder || a.retomar?.ferramentas?.some((r) => r.includes('*')));

/**
 * Approve once, or approve and stop asking about this command: for the session, or for the project. Dangerous commands
 * never get these (the server refuses too), and the baseline of safe commands needs no asking in the first place.
 */
export function RememberButtons({ approval: a, busy = false, onDecide, size = 'md' }: { approval: TicketApproval; busy?: boolean; onDecide: DangerDecide; size?: 'md' | 'lg' }) {
  if (!canRemember(a)) return null;
  const suggestion = Boolean(a.retomar?.conceder);
  return (
    <>
      <Button size={size} icon={Check} disabled={busy} onClick={() => void onDecide('aprovado', undefined, undefined, 'sessao')}>
        {suggestion ? `Só por ${SESSION_HOURS} h` : `Aprovar por ${SESSION_HOURS} h`}
      </Button>
      {!suggestion && (
        <Button size={size} icon={Check} disabled={busy} onClick={() => void onDecide('aprovado', undefined, undefined, 'projeto')}>
          Aprovar e lembrar
        </Button>
      )}
    </>
  );
}
