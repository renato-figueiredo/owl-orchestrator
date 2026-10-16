import React from 'react';
import { Button } from '../core/Button';
import { AgentTag } from '../status/AgentTag';

const KIND = { Push: 'git-branch', Merge: 'git-merge', Deploy: 'rocket', 'Exclusão': 'trash-2', Custo: 'coins' };

export function GateCard({ kind, ticket, title, command, stats, requester, provider, risk = 'médio', status = 'pendente', comment, compact = false, onApprove, onReject, children }) {
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const pending = status === 'pendente';
  const accent = pending ? 'var(--c-gate-pending)' : status === 'aprovado' ? 'var(--c-gate-approved)' : 'var(--c-gate-rejected)';
  const riskN = { baixo: 1, 'médio': 2, alto: 3 }[risk] || 2;
  return (
    <section aria-label={`Aprovação: ${kind} ${ticket}`} style={{ border: `1px solid ${pending ? 'var(--c-gate-pending)' : 'var(--c-line)'}`, borderRadius: 'var(--r-panel)', background: 'var(--c-panel)', overflow: 'hidden', animation: pending ? 'owl-pulse 0.9s var(--ease-out) 1' : 'none' }}>
      <div style={{ padding: compact ? '10px 12px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <i className={`icon-${KIND[kind] || 'shield-alert'}`} style={{ color: accent, fontSize: 14 }} />
          <span style={{ fontWeight: 600, color: accent }}>{kind}</span>
          {!pending && <span style={{ color: accent }}>· {status}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{ticket}</span>
        </div>
        {!compact && title && <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{title}</div>}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 11 : 13, background: 'var(--c-bg)', borderRadius: 'var(--r-sm)', padding: '8px 10px', lineHeight: 1.5, wordBreak: 'break-all' }}><span style={{ color: 'var(--c-muted)' }}>$ </span>{command}</div>
        {stats && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{stats}</div>}
        {!compact && children}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--c-muted)' }}>
          <span>pedido por</span>{requester && <AgentTag name={requester} provider={provider} />}
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>risco
            <span aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>{[1, 2, 3].map((i) => <span key={i} style={{ width: 4, height: 10, borderRadius: 1, background: i <= riskN ? (riskN === 3 ? 'var(--c-danger)' : 'var(--c-fg)') : 'var(--c-line)' }} />)}</span>
            <span style={{ color: riskN === 3 ? 'var(--c-danger)' : 'var(--c-fg)' }}>{risk}</span>
          </span>
        </div>
        {!pending && comment && <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>“{comment}”</div>}
      </div>
      {pending && (
        <div style={{ borderTop: '1px solid var(--c-line)', padding: compact ? '10px 12px' : '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rejecting && (
            <textarea autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo da reprovação (o agente recebe isto)"
              style={{ resize: 'vertical', borderRadius: 'var(--r-ctl)', border: '1px solid var(--c-line)', background: 'var(--c-raised)', color: 'var(--c-fg)', font: '400 13px var(--font-sans)', padding: '8px 10px', outline: 'none' }} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {rejecting ? (<>
              <Button variant="danger" size="lg" icon="x" disabled={!reason.trim()} onClick={() => onReject && onReject(reason.trim())} style={{ flex: 1 }}>Reprovar</Button>
              <Button variant="ghost" size="lg" onClick={() => { setRejecting(false); setReason(''); }}>Voltar</Button>
            </>) : (<>
              <Button variant="primary" size="lg" icon="check" onClick={onApprove} style={{ flex: 1 }}>Aprovar</Button>
              <Button variant="secondary" size="lg" onClick={() => setRejecting(true)} style={{ flex: 1 }}>Reprovar com motivo</Button>
            </>)}
          </div>
        </div>
      )}
    </section>
  );
}
