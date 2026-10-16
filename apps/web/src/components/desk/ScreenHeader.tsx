import type { ReactNode } from 'react';

/** The header every desk screen shares (design: mono eyebrow over a 24px title, actions on the right, a bottom border). */
export function ScreenHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-none flex-wrap items-end gap-4 border-b border-line px-6 pb-3.5 pt-5">
      <div className="flex flex-col gap-1.5">
        {eyebrow && <div className="font-mono text-[11px] tracking-[0.04em] text-muted">{eyebrow}</div>}
        <h1 className="m-0 text-2xl font-semibold leading-tight">{title}</h1>
      </div>
      {children}
    </header>
  );
}

/** Small mono section label (TEMPO, VIGIA…), tracking .08em. */
export function Label({ children }: { children: ReactNode }) {
  return <span className="owl-label">{children}</span>;
}

/** Native `<select>` / text inputs in the design's field style, for forms that cannot use `@owl/ui` Input. */
export const field = 'h-8 rounded-md border border-line bg-raised px-2.5 text-[13px] text-fg outline-none focus:border-accent';
