import { Button } from '@owl/ui';
import { Send } from 'lucide-react';
import { useState } from 'react';
import type { TicketApproval } from '../lib/types';
import type { DangerDecide } from './DangerGate';

/** The agent stopped to ask something: its answer is the person's text, which goes back to it as a comment. */
export const isQuestion = (a: Pick<TicketApproval, 'tipo'>): boolean => a.tipo === 'pergunta';

const FALLBACK = 'Siga com a sua melhor suposição e diga qual foi.';

/** Answering is the only way to approve a question: without text the agent would resume knowing nothing new. */
/** What the agent offered, or Sim/Não for a plain yes-or-no question. */
export function suggestionsFor(a: Pick<TicketApproval, 'motivo' | 'retomar'> | undefined): string[] {
  const given = a?.retomar?.opcoes;
  if (given?.length) return given;
  return a && /^(devo|quer|posso|pode|deve|vale|precisa)\b/i.test(a.motivo.trim()) && !/\bou\b/i.test(a.motivo) ? ['Sim', 'Não'] : [];
}

export function QuestionGate({ approval, busy = false, onDecide, large = false }: { approval?: TicketApproval; busy?: boolean; onDecide: DangerDecide; large?: boolean }) {
  const options = suggestionsFor(approval);
  const [text, setText] = useState('');
  const height = large ? 48 : 40;
  return (
    <div className="flex max-w-[820px] flex-col gap-2.5">
      {options.length > 0 && (
        <div role="group" aria-label="Respostas sugeridas" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Sugestões:</span>
          {options.map((o) => (
            <Button key={o} size="sm" disabled={busy} onClick={() => setText(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-xs font-medium">
        Sua resposta
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Resposta para o agente"
          placeholder="O agente continua a partir do que você escrever"
          className="resize-y rounded-md border border-line-strong bg-raised px-3 py-2.5 text-sm font-normal"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Send} disabled={busy || !text.trim()} style={{ height }} onClick={() => void onDecide('aprovado', text.trim())}>
          Responder
        </Button>
        <Button disabled={busy} style={{ height }} onClick={() => void onDecide('rejeitado', FALLBACK)}>
          Deixar o agente decidir
        </Button>
      </div>
    </div>
  );
}
