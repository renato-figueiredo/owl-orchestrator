/** Owl mark (brand/logo-mark.svg). `blink` animates the eyes for empty/loading states (off with reduced motion). */
export function Logo({ size = 28, blink = false }: { size?: number; blink?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="OWL" className={blink ? 'owl-blink' : undefined}>
      <rect width="96" height="96" rx="22" fill="#1B1B3A" />
      <path d="M14 20 L30 42 L48 26 L66 42 L82 20" fill="none" stroke="#F5B942" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <g className="owl-eyes">
        <circle cx="32" cy="58" r="14" fill="#F4F1EA" />
        <circle cx="64" cy="58" r="14" fill="#F4F1EA" />
        <circle cx="35" cy="58" r="6.5" fill="#1B1B3A" />
        <circle cx="37" cy="55.5" r="2" fill="#F4F1EA" />
        <circle cx="67" cy="58" r="6.5" fill="#1B1B3A" />
        <circle cx="69" cy="55.5" r="2" fill="#F4F1EA" />
      </g>
      <path d="M42 66 L54 66 L48 80 Z" fill="#F5B942" stroke="#F5B942" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
