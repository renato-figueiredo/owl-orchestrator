import { Button } from '@owl/ui';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { TicketApproval } from '../lib/types';

export type DangerDecide = (decisao: 'aprovado' | 'rejeitado', comentario?: string, confirmacao?: string, lembrar?: Remember) => Promise<unknown> | void;
export type Remember = 'sessao' | 'projeto';

/** Does approving this gate need the command typed? Keyboard shortcuts must not skip it. */
export const needsTyping = (a: Pick<TicketApproval, 'retomar'>): boolean => Boolean(a.retomar?.confirmar);

/**
 * A dangerous command (install, publish, sudo, code fetched on the spot...). Reading is not enough: the person types the
 * short word that makes it dangerous (`pnpm add`, `sudo`, `push`), found by reading the command, and only then can approve.
 * The server checks it again, so this is not the only guard. It is never remembered: it is asked about every time.
 */
export function DangerGate({ approval: a, busy = false, onDecide }: { approval: TicketApproval; busy?: boolean; onDecide: DangerDecide }) {
  const word = a.retomar?.confirmar ?? '';
  const [who = '', ...rest] = a.motivo.replace(/^⚠ COMANDO PERIGOSO\. /, '').split('\n');
  const [command = '', why] = (rest.join('\n') || who).split(' — ');
  const [typed, setTyped] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const match = typed.trim() === word.trim() && word !== '';
  const at = command.indexOf(word);
  return (
    <div role="alertdialog" aria-label="Comando perigoso" className="flex max-w-[820px] flex-col gap-3 rounded-lg border border-danger bg-danger-wash p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-danger">
        <ShieldAlert size={18} aria-hidden="true" />
        Comando perigoso: leia e digite a palavra destacada para liberar
      </div>
      <p className="m-0 text-xs text-muted">
        {who}
        {why ? ` ${why}` : ''}
      </p>
      <code className="break-all rounded-md border border-line bg-chrome px-3 py-2.5 font-mono text-sm">
        <span className="text-muted">$ </span>
        {at >= 0 ? (
          <>
            {command.slice(0, at)}
            <mark className="rounded-sm bg-danger-wash px-0.5 text-danger">{word}</mark>
            {command.slice(at + word.length)}
          </>
        ) : (
          command
        )}
      </code>
      {rejecting ? (
        <>
          <textarea
            autoFocus
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Motivo da recusa"
            placeholder="Motivo da recusa — o agente recebe isto e segue sem o comando"
            className="resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button variant="danger" icon={X} disabled={busy || !reason.trim()} onClick={() => void onDecide('rejeitado', reason.trim())}>
              Recusar
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Voltar
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Digite a palavra destacada
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              spellCheck={false}
              autoComplete="off"
              aria-label="Digite a palavra para confirmar"
              className="h-9 rounded-md border border-line-strong bg-raised px-3 font-mono text-sm"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={Check} disabled={busy || !match} onClick={() => void onDecide('aprovado', undefined, typed.trim())}>
              Aprovar e executar
            </Button>
            <Button onClick={() => setRejecting(true)}>Recusar com motivo</Button>
            <span className="flex-1" />
            <span className="text-xs text-muted">Colar está desligado de propósito; comandos perigosos não são lembrados.</span>
          </div>
        </>
      )}
    </div>
  );
}
