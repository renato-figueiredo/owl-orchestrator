/** Owl mark v2 (design/claude-design/assets/owl/mark.svg): face disc, amber irises, faceted beak. `blink` animates the eyes. */
export function Logo({ size = 24, blink = false }: { size?: number; blink?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="OWL" className={blink ? 'owl-blink' : undefined}>
      <rect width="96" height="96" rx="24" fill="#010736" />
      <g fill="#0B1645">
        <circle cx="33" cy="55" r="21" />
        <circle cx="63" cy="55" r="21" />
      </g>
      <path d="M14 15 L31 38 L48 27 L65 38 L82 15" fill="none" stroke="#F5B055" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <g className="owl-eyes">
        <circle cx="33" cy="56" r="14" fill="#FBF0CF" />
        <circle cx="34.5" cy="56" r="9" fill="#F5B055" />
        <circle cx="34.5" cy="56" r="5.5" fill="#010736" />
        <circle cx="36.8" cy="53.4" r="2" fill="#FBF0CF" />
        <circle cx="63" cy="56" r="14" fill="#FBF0CF" />
        <circle cx="64.5" cy="56" r="9" fill="#F5B055" />
        <circle cx="64.5" cy="56" r="5.5" fill="#010736" />
        <circle cx="66.8" cy="53.4" r="2" fill="#FBF0CF" />
      </g>
      <path d="M48 63 L54 70.5 L48 80 L42 70.5 Z" fill="#F5B055" />
      <path d="M48 63 L54 70.5 L48 80 Z" fill="#D4631F" />
    </svg>
  );
}
