// When Demo Studio's frame loads its document (#9, #11's TBT budget). The
// frame's /sample or /reference document runs a whole Next runtime of its
// own, and Chromium runs a same-site sandboxed frame on the page's own main
// thread, so loading it with the page puts its startup inside the page's.
// At a wide Studio, the frame's stage sets its source once it comes within
// two windows' height below the window, much as an iframe's loading="lazy"
// looks 1250 to 2500px ahead. At a phone's width, where the stage shares the
// first screens with the task's controls and a margin like that would take
// in the whole task, a poster stands in its place until the visitor asks for
// the preview. Anything the visitor does that asks to see a preview loads
// it with no extra tap: a pick, a viewport, or Compare in any of its modes,
// the Grid's too (the lead, P-5 slice 4), so the poster is only ever what a
// visitor who hasn't acted yet sees. Once the stage has loaded a document,
// every later source (a new selection, the reference, a reset) loads straight
// away. Framework-free, so tests drive it with a stand-in observer.

/**
 * Studio at a phone's width, where the frame waits to be asked for and defaults to the mobile
 * viewport: short of 48rem and of 1024 CSS px both, as PHONE_STUDIO's width, so a desktop
 * window at 200% text, which keeps the rail, never puts the ask in front of its preview.
 */
export const NARROW_STUDIO = '(max-width: 47.99rem) and (max-width: 1023.98px)';

/** How the stage waits for its first document: until it's near the window, or until the visitor asks. */
export type FrameGate = 'visible' | 'asked';

/** The gate for a Studio at a phone's width, or not. */
export function frameGate(narrow: boolean): FrameGate {
  return narrow ? 'asked' : 'visible';
}

/**
 * What the visitor did that bears on the frame: picked a value it shows,
 * picked its viewport, started Compare, imported a pair it showed them, or
 * cleared that pair.
 */
export type FrameEvent = 'choose' | 'viewport' | 'compare' | 'imported' | 'cleared';

/**
 * Whether the frame may load after `event`. Once it may, it always may. A
 * pick of what the frame shows or of its viewport asks to see it, as Compare
 * does its frames, so they load with no tap and even if the observer never
 * fires, and an import has already shown the visitor a frame, so clearing it
 * brings no poster back.
 */
export function frameRequestedAfter(requested: boolean, event: FrameEvent): boolean {
  return requested || event !== 'cleared';
}

/** What the poster says while the stage waits to be asked. */
export const ASK_TEXT = 'Tap to load the preview';

/** The button that asks for it. */
export const ASK_LABEL = 'Show preview';

/** What Studio's status says while the asked-for preview loads. */
export const LOADING_TEXT = 'Loading the preview…';

/** What Studio's status says once the asked-for preview has loaded. */
export const LOADED_TEXT = 'The preview has loaded.';

/** How near the window the stage counts as on screen: within two windows' height below it. */
export const STAGE_MARGIN = '0px 0px 200% 0px';

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
