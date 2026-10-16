import { Button, GateCard } from '@owl/ui';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { GateKind, TicketApproval } from '../lib/types';

/** Gate kinds as the design names them (short, sentence case). */
export const GATE_KIND_LABEL: Record<GateKind, string> = {
  entrega: 'Entrega',
  custo: 'Custo',
  destrutiva: 'Ação destrutiva',
  reprovacao: 'Reprovação',
  confianca: 'Baixa confiança',
};
/** What each kind means, one sentence, for the detail view. */
export const GATE_KIND_HINT: Record<GateKind, string> = {
  entrega: 'O agente terminou e pede sua aprovação para entregar.',
  custo: 'O ticket passou do teto de tokens definido para ele.',
  destrutiva: 'Uma ação que apaga, mescla ou publica espera sua decisão.',
  reprovacao: 'O revisor reprovou a entrega; o autor refaz de qualquer jeito.',
  confianca: 'O roteador não teve confiança na escolha do modelo.',
};
/** Risk bars by kind. The backend has no risk score, so this is a fixed reading of the kind. */
export const GATE_RISK: Record<GateKind, 'baixo' | 'médio' | 'alto'> = { entrega: 'médio', custo: 'médio', destrutiva: 'alto', reprovacao: 'baixo', confianca: 'baixo' };

export const kindLabel = (a: Pick<TicketApproval, 'tipo'>) => (a.tipo ? GATE_KIND_LABEL[a.tipo] : 'Aprovação');
export const kindRisk = (a: Pick<TicketApproval, 'tipo'>) => (a.tipo ? GATE_RISK[a.tipo] : 'médio');

const DESTRUCTIVE_PREFIX = 'Ação destrutiva: ';
/** The action a destructive gate asks for (what the agent wanted to run). Other kinds have only a reason. */
export const gateAction = (a: Pick<TicketApproval, 'tipo' | 'motivo'>): string | null =>
  a.tipo === 'destrutiva' && a.motivo.startsWith(DESTRUCTIVE_PREFIX) ? a.motivo.slice(DESTRUCTIVE_PREFIX.length) : null;

/** "agora", "há 5 min", "há 3 h", "há 2 d" from a stored UTC timestamp. */
export function fmtAgo(criadoEm: string | null | undefined, now = Date.now()): string {
  if (!criadoEm) return '';
  const ms = Date.parse(criadoEm.includes('T') ? criadoEm : `${criadoEm.replace(' ', 'T')}Z`);
  if (Number.isNaN(ms)) return '';
  const min = Math.max(0, Math.floor((now - ms) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} d`;
}

export type Decide = (decisao: 'aprovado' | 'rejeitado', comentario?: string) => Promise<unknown> | void;

interface Props {
  approval: TicketApproval;
  stats?: string;
  requester?: string | null | undefined;
  provider?: string | null | undefined;
  onDecide: Decide;
}

/** Compact gate inside a ticket. A "reprovacao" gate has its own two answers (the author redoes it either way). */
export function ApprovalGate({ approval: a, stats, requester, provider, onDecide }: Props) {
  if (a.tipo === 'reprovacao') return <ReworkGate approval={a} onDecide={onDecide} />;
  const action = gateAction(a);
  return (
    <GateCard
      kind={kindLabel(a)}
      ticket={a.ticketIdentificador ?? ''}
      command={action ?? a.motivo}
      {...(stats ? { stats } : {})}
      {...(requester ? { requester } : {})}
      {...(provider ? { provider } : {})}
      risk={kindRisk(a)}
      compact
      onApprove={() => void onDecide('aprovado')}
      onReject={(m) => void onDecide('rejeitado', m)}
    />
  );
}

/** The revisor rejected the delivery: both answers send the work back to its author; the comment becomes the instruction. */
export function ReworkGate({ approval: a, onDecide, large = false }: { approval: TicketApproval; onDecide: Decide; large?: boolean }) {
  const [text, setText] = useState('');
  const size = large ? 'lg' : 'md';
  return (
    <section aria-label={`Aprovação: ${kindLabel(a)} ${a.ticketIdentificador ?? ''}`} className="overflow-hidden rounded-lg border border-accent bg-panel" style={{ animation: 'owl-pulse 0.9s var(--ease-out) 1' }}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs">
          <ShieldAlert size={14} className="text-accent" aria-hidden="true" />
          <span className="font-semibold text-accent">{kindLabel(a)}</span>
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-muted">{a.ticketIdentificador}</span>
        </div>
        <p className="m-0 text-[13px]">{a.motivo}</p>
        <p className="m-0 text-xs text-muted">Nos dois casos o autor refaz; o comentário (obrigatório no segundo) vira a instrução.</p>
        <label className="block">
          <span className="sr-only">Comentário da decisão</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Comentário para o autor" className="block w-full rounded-md border border-line bg-raised px-2.5 py-2 text-[13px] hover:border-line-strong" />
        </label>
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="primary" size={size} icon={Check} onClick={() => void onDecide('aprovado', text.trim() || undefined)}>
          Confirmar e refazer
        </Button>
        <Button variant="secondary" size={size} icon={X} disabled={!text.trim()} onClick={() => void onDecide('rejeitado', text.trim())}>
          Refazer do meu jeito
        </Button>
      </div>
    </section>
  );
}
