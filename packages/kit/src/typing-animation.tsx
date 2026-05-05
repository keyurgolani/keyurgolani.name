'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMotionPreference } from './motion';
import type { MotionPreference } from '@portfolio/schema';

export interface TypingAnimationProps {
  /** Strings to cycle through. Empty array renders nothing. */
  texts: string[];
  /** Milliseconds per character while typing. Default 80. */
  typingSpeed?: number;
  /** Milliseconds per character while deleting. Default 40. */
  deletingSpeed?: number;
  /** Pause between completed text and start of deletion. Default 2000. */
  pauseDuration?: number;
  /** Per-text override array — index N overrides pauseDuration for texts[N]. */
  pauseDurations?: number[];
  className?: string;
  /** Override portfolio motion preference; default `respect-os`. */
  motionPreference?: MotionPreference;
  /**
   * Render the blinking caret. Default true. Set false if your variant
   * supplies its own caret CSS.
   */
  caret?: boolean;
}

type Phase = 'typing' | 'pausing' | 'deleting';

/**
 * Multi-text typing/deleting animation. Cycles forever through `texts`.
 * Reduced-motion users see the first text statically.
 *
 * The component renders raw text into a `<span aria-live="polite">` plus
 * an optional caret span. Variants restyle via the `className` prop and
 * a CSS rule on `.kc-typing__caret` (or an equivalent caret class of their
 * choosing — the caret carries no class itself if you override the markup).
 */
export function TypingAnimation({
  texts,
  typingSpeed = 80,
  deletingSpeed = 40,
  pauseDuration = 2000,
  pauseDurations,
  className,
  motionPreference,
  caret = true,
}: TypingAnimationProps) {
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');
  const [textIndex, setTextIndex] = useState(0);
  const reduce = useMotionPreference(motionPreference) === 'reduce';

  const normalized = useMemo(() => (texts.length > 0 ? texts : ['']), [texts]);
  const current = normalized[textIndex] ?? '';
  const currentPause =
    pauseDurations && pauseDurations[textIndex] !== undefined
      ? pauseDurations[textIndex]!
      : pauseDuration;

  useEffect(() => {
    if (reduce || normalized.length === 0) return;
    let timeoutId: ReturnType<typeof setTimeout>;

    if (phase === 'typing') {
      if (displayed.length < current.length) {
        timeoutId = setTimeout(() => {
          setDisplayed(current.slice(0, displayed.length + 1));
        }, typingSpeed);
      } else {
        timeoutId = setTimeout(() => setPhase('pausing'), 0);
      }
    } else if (phase === 'pausing') {
      timeoutId = setTimeout(() => setPhase('deleting'), currentPause);
    } else {
      if (displayed.length > 0) {
        timeoutId = setTimeout(() => {
          setDisplayed(displayed.slice(0, -1));
        }, deletingSpeed);
      } else {
        timeoutId = setTimeout(() => {
          setTextIndex((i) => (i + 1) % normalized.length);
          setPhase('typing');
        }, 0);
      }
    }

    return () => clearTimeout(timeoutId);
  }, [
    displayed,
    phase,
    textIndex,
    current,
    currentPause,
    typingSpeed,
    deletingSpeed,
    reduce,
    normalized.length,
  ]);

  if (texts.length === 0) return null;
  const visible = reduce ? current : displayed;

  return (
    <span
      className={className}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Currently displaying: ${current}`}
    >
      <span>{visible}</span>
      {caret ? (
        <span className="kc-typing__caret" aria-hidden="true">
          |
        </span>
      ) : null}
    </span>
  );
}
