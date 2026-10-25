// When Demo Studio's frame loads its document (#9, #11's TBT budget). The
// frame's /sample or /reference document runs a whole Next runtime of its
// own, and Chromium runs a same-site sandboxed frame on the page's own main
// thread, so loading it with the page puts its startup inside the page's.
// The frame's stage sets its source once it comes within a screen's height
// of the window, as an iframe's loading="lazy" does with its own margin.
// Once the stage has loaded a document, every later
// source (a new selection, the reference, a reset) loads straight away.
// Framework-free, so tests drive it with a stand-in observer.

/** Studio at a phone's width, where the frame defaults to the mobile viewport. */
export const NARROW_STUDIO = '(max-width: 47.99rem)';

/** How near the window the stage counts as on screen: within one window's height below it. */
export const STAGE_MARGIN = '0px 0px 100% 0px';

/** The part of IntersectionObserver the gate uses. */
export interface StageObserver {
  observe(target: Element): void;
  disconnect(): void;
}

/** IntersectionObserver's constructor, or a stand-in for it. */
export type StageObserverClass = new (
  callback: (entries: readonly { readonly isIntersecting: boolean }[]) => void,
  options: { readonly rootMargin: string },
) => StageObserver;

/**
 * Calls `onVisible` once, the first time `target` is on screen, then stops
 * watching. Without an observer to watch with, `target` counts as on screen
 * at once. Returns the way to stop watching early.
 */
export function whenOnScreen(
  target: Element,
  onVisible: () => void,
  Observer: StageObserverClass | undefined = globalThis.IntersectionObserver as
    StageObserverClass | undefined,
): () => void {
  if (!Observer) {
    onVisible();
    return () => {};
  }
  let done = false;
  const observer = new Observer(
    (entries) => {
      if (done || !entries.some((entry) => entry.isIntersecting)) return;
      done = true;
      observer.disconnect();
      onVisible();
    },
    { rootMargin: STAGE_MARGIN },
  );
  observer.observe(target);
  return () => {
    done = true;
    observer.disconnect();
  };
}
