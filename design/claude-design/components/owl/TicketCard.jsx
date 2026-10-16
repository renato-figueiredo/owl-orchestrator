import React from 'react';
import { AgentTag } from '../status/AgentTag';

export function TicketCard({ id, title, priority, labels = [], agent, provider, running = false, subtasks, gate, blockedBy, failure, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: hover ? 'var(--c-overlay)' : 'var(--c-raised)', borderRadius: 'var(--r-ctl)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, cursor: onClick ? 'pointer' : 'default', transition: 'background var(--dur-fast)' }}>
      <div style={{ display: 'flex', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>
        <span>{id}</span><span style={{ flex: 1 }} />
        {priority && <span style={{ color: priority === 'P1' ? 'var(--c-fg)' : 'var(--c-muted)' }}>{priority}</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35, textWrap: 'pretty' }}>{title}</div>
      {labels.length > 0 && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>{labels.map((l) => '#' + l).join(' ')}</div>}
      {gate && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--c-gate-pending)' }}><i className="icon-shield-alert" />{gate} · na sua mesa</div>}
      {blockedBy && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-muted)' }}><i className="icon-lock" />espera <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-fg)' }}>{blockedBy}</span></div>}
      {failure && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-danger)' }}><i className="icon-circle-x" />{failure}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-muted)' }}>
        {agent ? <AgentTag name={agent} provider={provider} running={running} /> : <span>sem responsável</span>}
        <span style={{ flex: 1 }} />
        {subtasks && <span>{subtasks}</span>}
      </div>
    </div>
  );
}
