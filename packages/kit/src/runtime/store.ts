// The document's runtime inputs (#6, items 6 and 7), one store for every
// effect on the page: the OS's reduced motion, whether the document is
// visible, the visitor's pause, and the lifecycle #7's preview agent
// dispatches inside a frame. Each effect's root adds its own: whether it's
// in view, and its boundary's motion (use-runtime.ts).

import type { LifecycleInput } from './state';

/** The event #7's frame agent dispatches on window with each lifecycle Studio sends. */
export const LIFECYCLE_EVENT = 'kgn-preview-lifecycle';
/** Where the agent keeps the last one, for a runtime that starts after it arrived. */
export const LIFECYCLE_STATE = Symbol.for('kgn-preview.lifecycle');
/** Where the visitor's pause lasts for the tab. */
export const PAUSE_KEY = 'portfolio.motion.paused';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export interface DocumentInputs {
  readonly osReduced: boolean;
  readonly documentVisible: boolean;
  readonly visitorPaused: boolean;
  readonly lifecycle: LifecycleInput | null;
}

/** What the server, and a first client render, take the document to be. */
export const SERVER_INPUTS: DocumentInputs = Object.freeze({
  osReduced: false,
  documentVisible: true,
  visitorPaused: false,
  lifecycle: null,
});

/** A lifecycle as the agent dispatched it, or null for anything else. */
export function readLifecycle(value: unknown): LifecycleInput | null {
  if (!value || typeof value !== 'object') return null;
  const { state, focused } = value as Record<string, unknown>;
  if ((state !== 'visible' && state !== 'hidden') || typeof focused !== 'boolean') return null;
  return { state, focused };
}

/** #7's last lifecycle in this document, as its frame agent left it, or null outside a connected preview frame. */
export function previewLifecycle(): LifecycleInput | null {
  return readLifecycle((window as unknown as Record<symbol, unknown>)[LIFECYCLE_STATE]);
}

/** The visitor's pause in this tab: sessionStorage, or memory where storage throws. */
let pausedInMemory = false;

function readPause(): boolean {
  try {
    return sessionStorage.getItem(PAUSE_KEY) === '1';
  } catch {
    return pausedInMemory;
  }
}

function writePause(paused: boolean): void {
  pausedInMemory = paused;
  try {
    if (paused) sessionStorage.setItem(PAUSE_KEY, '1');
    else sessionStorage.removeItem(PAUSE_KEY);
  } catch {
    // Memory holds it for this page.
  }
}

const listeners = new Set<() => void>();
let current: DocumentInputs = SERVER_INPUTS;
let stop: (() => void) | null = null;

function read(): DocumentInputs {
  return {
    osReduced: matchMedia(REDUCED_MOTION).matches,
    documentVisible: document.visibilityState !== 'hidden',
    visitorPaused: readPause(),
    lifecycle: previewLifecycle(),
  };
}

function same(a: DocumentInputs, b: DocumentInputs): boolean {
  return (
    a.osReduced === b.osReduced &&
    a.documentVisible === b.documentVisible &&
    a.visitorPaused === b.visitorPaused &&
    a.lifecycle?.state === b.lifecycle?.state &&
    a.lifecycle?.focused === b.lifecycle?.focused
  );
}

/** Reads the document again, and tells each subscriber when anything changed. */
function refresh(): void {
  const next = read();
  if (same(next, current)) return;
  current = Object.freeze(next);
  for (const listener of [...listeners]) listener();
}

/** Starts listening to the document while anything subscribes, and stops after the last one goes. */
export function subscribeDocument(listener: () => void): () => void {
  listeners.add(listener);
  if (!stop) {
    const media = matchMedia(REDUCED_MOTION);
    const onLifecycle = () => refresh();
    media.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(LIFECYCLE_EVENT, onLifecycle);
    // Another tab's pause doesn't reach this one: sessionStorage is the tab's.
    stop = () => {
      media.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(LIFECYCLE_EVENT, onLifecycle);
    };
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/** The document's inputs as last read: a new object only when one changed. */
export function documentInputs(): DocumentInputs {
  if (!stop) {
    const next = read();
    if (!same(next, current)) current = Object.freeze(next);
  }
  return current;
}

/** Pauses or resumes every effect on the page, for the rest of the tab, as MotionControl does. */
export function setVisitorPaused(paused: boolean): void {
  writePause(paused);
  refresh();
}
