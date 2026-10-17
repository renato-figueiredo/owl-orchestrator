import type { View } from '../components/shell/Rail';

const VIEWS: readonly string[] = ['projects', 'chat', 'board', 'queue', 'team', 'memory', 'agents', 'pipelines', 'metrics', 'storage', 'pair'];

/** `#/board` or `#/board/ticket/<id>`: where the app is, so the browser's Back and Forward walk the same path. */
export const hashOf = (view: View, ticketId?: string | null): string => (ticketId ? `#/${view}/ticket/${encodeURIComponent(ticketId)}` : `#/${view}`);

export function parseHash(hash: string = typeof location === 'undefined' ? '' : location.hash): { view: View | null; ticketId: string | null } {
  const m = /^#\/([a-z]+)(?:\/ticket\/([^/]+))?$/.exec(hash);
  if (!m || !VIEWS.includes(m[1]!)) return { view: null, ticketId: null };
  return { view: m[1] as View, ticketId: m[2] ? decodeURIComponent(m[2]) : null };
}

/** Adds a history entry for `view` unless the address already shows it (a Back/Forward put it there). */
export function pushView(view: View): void {
  if (parseHash().view === view) return;
  history.pushState(null, '', hashOf(view));
}
