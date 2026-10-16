import { ChevronDown, ChevronUp, CircleX, Coins, GitBranch, GitMerge, Lock, Rocket, ShieldAlert, Trash2, X, Check, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './core';
import { AgentTag, OwlEyes } from './status';

/* Ported from design/claude-design/components/owl/*. */

const NODE = {
  done: { c: 'var(--c-status-done)', fill: true },
  running: { c: 'var(--c-status-running)', fill: false },
  think: { c: 'var(--c-muted)', fill: false },
  failed: { c: 'var(--c-status-failed)', fill: true },
  waiting: { c: 'var(--c-status-waiting-human)', fill: true },
} as const;

/** One step in the run timeline (thinking, tool call). Relative time in the margin, like a flight log. Render inside an `<ol>`. */
export function RunStep({ time, name, detail, duration, status = 'done', expanded = false, onToggle, last = false, children }: { time: string; name: string; detail?: string; duration?: string; status?: keyof typeof NODE; expanded?: boolean; onToggle?: () => void; last?: boolean; children?: ReactNode }) {
  const n = NODE[status];
  const can = !!children;
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '52px 20px 1fr', alignItems: 'start', listStyle: 'none', animation: 'owl-slide-in var(--dur) var(--ease-out)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)', textAlign: 'right', paddingRight: 8, paddingTop: 1, fontVariantNumeric: 'tabular-nums' }}>{time}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 4, flex: 'none', boxSizing: 'border-box', border: `1.5px solid ${n.c}`, background: n.fill ? n.c : 'transparent' }} />
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--c-line)', minHeight: 14 }} />}
      </span>
      <div style={{ padding: '0 0 14px 6px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <button type="button" onClick={can ? onToggle : undefined} aria-expanded={can ? expanded : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: can ? 'pointer' : 'default', textAlign: 'left' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: status === 'failed' ? 'var(--c-danger)' : 'var(--c-fg)' }}>{name}</span>
          {status === 'running' && <OwlEyes />}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{duration}</span>
          {can && (expanded ? <ChevronUp size={12} color="var(--c-muted)" aria-hidden="true" /> : <ChevronDown size={12} color="var(--c-muted)" aria-hidden="true" />)}
        </button>
        {detail && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>}
        {expanded && children && (
          <div style={{ marginTop: 6, background: 'var(--c-bg)', border: '1px solid var(--c-line)', borderRadius: 'var(--r-ctl)', padding: '6px 0', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6, overflow: 'hidden', animation: 'owl-fade-in var(--dur) var(--ease-out)' }}>{children}</div>
        )}
      </div>
    </li>
  );
}

/** Board ticket card. No border: the zone (agentes / você / feito) gives the context. */
export function TicketCard({ id, title, priority, labels = [], agent, provider, running = false, subtasks, gate, blockedBy, failure, onClick }: { id: string; title: string; priority?: 'P1' | 'P2' | 'P3'; labels?: string[]; agent?: string | null; provider?: string | null; running?: boolean; subtasks?: string; gate?: string; blockedBy?: string; failure?: string; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  const row = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 } as const;
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ background: hover ? 'var(--c-overlay)' : 'var(--c-raised)', borderRadius: 'var(--r-ctl)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, cursor: onClick ? 'pointer' : 'default', transition: 'background var(--dur-fast)' }}>
      <div style={{ display: 'flex', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>
        <span>{id}</span>
        <span style={{ flex: 1 }} />
        {priority && <span style={{ color: priority === 'P1' ? 'var(--c-fg)' : 'var(--c-muted)' }}>{priority}</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35, textWrap: 'pretty' }}>{title}</div>
      {labels.length > 0 && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{labels.map((l) => '#' + l).join(' ')}</div>}
      {gate && (
        <div style={{ ...row, fontWeight: 600, color: 'var(--c-gate-pending)' }}>
          <ShieldAlert size={12} aria-hidden="true" />
          {gate} · na sua mesa
        </div>
      )}
      {blockedBy && (
        <div style={{ ...row, color: 'var(--c-muted)' }}>
          <Lock size={12} aria-hidden="true" />
          espera <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-fg)' }}>{blockedBy}</span>
        </div>
      )}
      {failure && (
        <div style={{ ...row, color: 'var(--c-danger)' }}>
          <CircleX size={12} aria-hidden="true" />
          {failure}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>
        {agent ? <AgentTag name={agent} provider={provider} running={running} /> : <span>sem responsável</span>}
        <span style={{ flex: 1 }} />
        {subtasks && <span>{subtasks}</span>}
      </div>
    </div>
  );
}

const KIND: Record<string, LucideIcon> = { Push: GitBranch, Merge: GitMerge, Deploy: Rocket, Exclusão: Trash2, Custo: Coins };

/** The heaviest component: a dangerous action waiting for the human. Amber frame while pending (one pulse on arrival); Reprovar needs a reason. */
export function GateCard({ kind, ticket, title, command, stats, requester, provider, risk = 'médio', status = 'pendente', comment, compact = false, onApprove, onReject, children }: { kind: string; ticket: string; title?: string; command: string; stats?: string; requester?: string; provider?: string | null; risk?: 'baixo' | 'médio' | 'alto'; status?: 'pendente' | 'aprovado' | 'rejeitado'; comment?: string; compact?: boolean; onApprove?: () => void; onReject?: (motivo: string) => void; children?: ReactNode }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const pending = status === 'pendente';
  const accent = pending ? 'var(--c-gate-pending)' : status === 'aprovado' ? 'var(--c-gate-approved)' : 'var(--c-gate-rejected)';
  const riskN = { baixo: 1, médio: 2, alto: 3 }[risk] || 2;
  const KindIcon = KIND[kind] ?? ShieldAlert;
  return (
    <section aria-label={`Aprovação: ${kind} ${ticket}`} style={{ border: `1px solid ${pending ? 'var(--c-gate-pending)' : 'var(--c-line)'}`, borderRadius: 'var(--r-panel)', background: 'var(--c-panel)', overflow: 'hidden', animation: pending ? 'owl-pulse 0.9s var(--ease-out) 1' : 'none' }}>
      <div style={{ padding: compact ? '10px 12px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <KindIcon size={14} color={accent} aria-hidden="true" />
          <span style={{ fontWeight: 600, color: accent }}>{kind}</span>
          {!pending && <span style={{ color: accent }}>· {status}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{ticket}</span>
        </div>
        {!compact && title && <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{title}</div>}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 11 : 13, background: 'var(--c-bg)', borderRadius: 'var(--r-sm)', padding: '8px 10px', lineHeight: 1.5, wordBreak: 'break-all' }}>
          <span style={{ color: 'var(--c-muted)' }}>$ </span>
          {command}
        </div>
        {stats && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{stats}</div>}
        {!compact && children}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--c-muted)' }}>
          <span>pedido por</span>
          {requester && <AgentTag name={requester} provider={provider} />}
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            risco
            <span aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>
              {[1, 2, 3].map((i) => (
                <span key={i} style={{ width: 4, height: 10, borderRadius: 1, background: i <= riskN ? (riskN === 3 ? 'var(--c-danger)' : 'var(--c-fg)') : 'var(--c-line)' }} />
              ))}
            </span>
            <span style={{ color: riskN === 3 ? 'var(--c-danger)' : 'var(--c-fg)' }}>{risk}</span>
          </span>
        </div>
        {!pending && comment && <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>“{comment}”</div>}
      </div>
      {pending && (
        <div style={{ borderTop: '1px solid var(--c-line)', padding: compact ? '10px 12px' : '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rejecting && (
            <textarea autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo da reprovação (o agente recebe isto)" aria-label="Motivo da reprovação" style={{ resize: 'vertical', borderRadius: 'var(--r-ctl)', border: '1px solid var(--c-line)', background: 'var(--c-raised)', color: 'var(--c-fg)', font: '400 13px var(--font-sans)', padding: '8px 10px', outline: 'none' }} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {rejecting ? (
              <>
                <Button variant="danger" size="lg" icon={X} disabled={!reason.trim()} onClick={() => onReject?.(reason.trim())} style={{ flex: 1 }}>Reprovar</Button>
                <Button variant="ghost" size="lg" onClick={() => { setRejecting(false); setReason(''); }}>Voltar</Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="lg" icon={Check} onClick={onApprove} style={{ flex: 1 }}>Aprovar</Button>
                <Button variant="secondary" size="lg" onClick={() => setRejecting(true)} style={{ flex: 1 }}>Reprovar com motivo</Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
