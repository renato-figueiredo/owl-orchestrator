import { useEffect } from 'react';

export interface TabRun {
  agent: string;
  label: string;
}

const BASE = 'OWL';

/** What the browser tab says: what needs a person first, then what runs (the name when it is one thing, the count when more). */
export function tabTitle(pending: number, running: TabRun[]): string {
  const parts: string[] = [];
  if (pending > 0) parts.push(`⚠ ${pending} ${pending === 1 ? 'aprovação' : 'aprovações'}`);
  if (running.length === 1) parts.push(`▶ ${running[0]!.agent} · ${running[0]!.label}`);
  else if (running.length > 1) parts.push(`▶ ${running.length} rodando`);
  return parts.length ? `${parts.join(' · ')} — ${BASE}` : BASE;
}

const ICON = '/favicon.svg';
const DOT = { pending: '#e0a43a', running: '#4fb286' } as const;

/** The favicon with a dot in the corner: amber when something waits for a person, green when something runs. */
function paintIcon(state: 'pending' | 'running' | null): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (!state) {
    link.type = 'image/svg+xml';
    link.href = ICON;
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 64, 64);
      ctx.beginPath();
      ctx.arc(47, 47, 15, 0, Math.PI * 2);
      ctx.fillStyle = DOT[state];
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#010736';
      ctx.stroke();
      link.type = 'image/png';
      link.href = canvas.toDataURL('image/png');
    } catch {
      /* the title alone still says it */
    }
  };
  img.src = ICON;
}

/** Keeps the tab title and icon in step with the board, so it is readable from another tab. */
export function useTabStatus(pending: number, running: TabRun[]): void {
  const title = tabTitle(pending, running);
  const state = pending > 0 ? 'pending' : running.length > 0 ? 'running' : null;
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    paintIcon(state);
  }, [state]);
  useEffect(() => () => {
    document.title = BASE;
    paintIcon(null);
  }, []);
}
