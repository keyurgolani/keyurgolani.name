// An arrival on a fragment that mount couldn't read at its target's scroll
// margin. Mount reads the page once, and under load the engine's own fragment
// scroll can settle after that reading, so a new arrival read off its margin
// isn't yet the reader's: the decision is held. The first scroll that has
// moved the page since mount reads again (an event for a scroll from before
// mount has moved nothing, and decides nothing), and so does load: at the
// margin, it lands; anywhere else, the place is the reader's. The reader's own
// input decides for them at once. Where load had fired before mount, nothing
// else is coming to correct the page, so a cap decides for the reader if no
// scroll has come by then. One timer, cleared on the decision and on stop.

/** How long a hold waits for a scroll once load has already fired, in ms. */
export const HOLD_CAP_MS = 1000;

export interface Hold {
  /** A scroll (or scrollend), the page now at this offset. */
  readonly scrolled: (y: number) => void;
  /** The reader's own input: a wheel, touch, press, key or focus. */
  readonly input: () => void;
  /** Load, once the engine's own scroll at load has run. */
  readonly loaded: () => void;
  /** Cleanup: no decision. */
  readonly stop: () => void;
  /** Whether it's still waiting. */
  readonly held: () => boolean;
}

/**
 * Holds the decision from mount, the page at `y`: `decide(true)` lands, `decide(false)` leaves the
 * place to the reader, once. `untouched` reads whether the target sits at its margin now.
 */
export function hold(
  y: number,
  complete: boolean,
  untouched: () => boolean,
  decide: (land: boolean) => void,
): Hold {
  let open = true;
  const stop = () => {
    open = false;
    clearTimeout(timer);
  };
  const end = (land: boolean) => {
    if (!open) return;
    stop();
    decide(land);
  };
  const timer = complete ? setTimeout(() => end(false), HOLD_CAP_MS) : undefined;
  return {
    scrolled: (now) => {
      if (Math.abs(now - y) >= 1) end(untouched());
    },
    input: () => end(false),
    loaded: () => end(untouched()),
    stop,
    held: () => open,
  };
}
