import autoAnimate from '@formkit/auto-animate';
import { motion } from 'motion/react';
import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { useMotionPreference } from './useMotionPreference';

/** Appear animation: opacity (+ a small rise unless reduced motion). 120–250 ms, ease-out. */
export function FadeIn({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { reduced } = useMotionPreference();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.18, ease: 'easeOut', delay: reduced ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}

/** A list whose children animate on add/remove/reorder (AutoAnimate). Off with reduced motion. */
export function ListAnimated({ as: Tag = 'ul', children, className, ...rest }: { as?: ElementType; children: ReactNode; className?: string } & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotionPreference();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const ctl = autoAnimate(el, { duration: 180, easing: 'ease-out' });
    return () => ctl.disable();
  }, [reduced]);
  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}

/** One-shot attention pulse (a ring that fades out once), never a loop. Static with reduced motion. */
export function Pulse({ children, className }: { children: ReactNode; className?: string }) {
  const { reduced } = useMotionPreference();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { boxShadow: '0 0 0 0 var(--c-accent)' }}
      animate={{ boxShadow: '0 0 0 8px transparent' }}
      transition={{ duration: reduced ? 0 : 0.9, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

/** Blinking text caret for streamed text. Fixed width so it never shifts the layout; steady with reduced motion. */
export function StreamCaret({ className }: { className?: string }) {
  const { reduced } = useMotionPreference();
  return (
    <motion.span
      aria-hidden="true"
      className={className}
      style={{ display: 'inline-block', width: '0.5ch', marginLeft: 1, color: 'var(--c-accent)' }}
      animate={reduced ? { opacity: 1 } : { opacity: [1, 0, 1] }}
      transition={reduced ? { duration: 0 } : { duration: 1, repeat: Infinity, times: [0, 0.5, 1] }}
    >
      ▍
    </motion.span>
  );
}
