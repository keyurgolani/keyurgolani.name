'use client';

import type { Ref } from 'react';
import { pageProfileOf, SignOutForm } from '../sign-out-form';
import {
  LATE_ALERT_TAG,
  LATE_ALERT_TEXT,
  LATE_CLOCK_KEY,
  lateAlertHTML,
  RELOAD_SELECTOR,
  STUDIO_LOAD_TIMEOUT_MS,
  type InlineLateClock,
} from './late-markup';

export { LATE_ALERT_TAG, STUDIO_LOAD_TIMEOUT_MS };

// Studio's late alert (row 88c): when the shell's chunk is still on its way
// after STUDIO_LOAD_TIMEOUT_MS, "Studio couldn't load." shows in an element
// of its own, outside the page's root.
//
// It can't live in the page's root. next/dynamic with ssr adds no Suspense
// boundary (next/dist/shared/lib/lazy-dynamic/loadable.js:49), so a shell
// chunk that stalls suspends the whole root's hydration: nothing in it
// commits, and no effect in it runs, the load boundary's included. A
// Suspense boundary around the shell would let the rest commit, but it
// breaks the server's answer on a cold render: React.lazy throws on its
// first call in each server process, and Fizz's retry lands after Next's
// setImmediate-then-pipe (renderToPipeableStream, onShellReady, one
// setImmediate, pipe), so the first /studio after every start would stream
// the shell out of line, <!--$?-->, <template id="B:0">, a hidden S:0 div
// and $RC( (load-boundary-ssr.test.tsx).
//
// The clock starts at HTML parse, in the page's inline script
// (late-markup.ts), not here: the Flight client evaluates none of the page's
// client modules, this one included, until every chunk they need arrived, so
// a chunk that stalls would leave no module to start one. When this module
// evaluates, it adopts that clock: before the timeout it stops the script's
// timer and runs out the rest from the same start; after it, the script's
// alert is this one's. With no inline clock (a test's host, a page that sent
// none) it starts its own here. Every entry to /studio is a full page load,
// so one evaluation is one entry. At 5 s, if the boundary hasn't said the
// page's root committed, a <studio-load-late> element goes in as a direct
// child of <body>, with lateAlertHTML's alert, from either clock. body
// is a singleton, and React passes over an element it didn't render there
// when it hydrates body later, if no element it renders could claim it: a
// custom tag, as Next's route announcer is, never matches the server's
// divs, where a <div> would be claimed and force a client render of the
// root (#418). studio.css hides the server's shell while it's there, so
// nothing React hydrates is touched. Its content goes in a microtask after
// the hand-off, outside the page's render and commit, whether or not a
// client render of the page's root already took its element out of <body>.
//
// When the page's root commits, the boundary calls lateCommitted():
// - before 5 s, the clock stops, and nothing shows;
// - after the alert showed and Reload wasn't pressed, its node goes, and the
//   shell shows again: a shell that arrived ('live')
//   gets focus at #studio-main, and a refused one ('rejected') gets the
//   boundary's own alert, which takes focus;
// - once Reload was pressed, the page reloads: its element is left alone, and the boundary renders no second alert. A shell that
//   arrives in the moment before the reload lands may show until it does.
//
// The alert offers Reload Studio, here and in the boundary, under both
// profiles, and under owner Sign out too: a plain form post to auth.logout
// (sign-out-form.tsx, row 88c-RC2), so no owner code goes in the page's entry,
// which Demo Studio's page loads too (#9).

/**
 * "Studio couldn't load." with Reload Studio, the one alert both the late
 * root and the boundary render. Studio's name as an h1 and the alert, as the
 * quality harness reads a page that needs its script: one main and an h1.
 * The boundary's, once the shell is gone, is the page's main; the late
 * root's is a plain box, as the server's shell, hidden, keeps its own main
 * in the page.
 */
export function StudioLoadAlert({
  main,
  reload,
  onReload,
  profile = null,
}: {
  readonly main: boolean;
  readonly reload?: Ref<HTMLButtonElement>;
  readonly onReload: () => void;
  /** The page's profile, as its load boundary names it: under owner the alert offers Sign out (row 88c-RC2). */
  readonly profile?: string | null;
}) {
  const content = (
    <>
      <h1 className="studio-shell__name">{LATE_ALERT_TEXT.name}</h1>
      <div className="studio-alert" role="alert">
        <p>{LATE_ALERT_TEXT.message}</p>
        {/* One actions row, spaced by studio.css's gap (row 88c-RC2): the form adds no box. */}
        <div className="studio-alert__actions">
          <button
            ref={reload}
            type="button"
            className="studio-button"
            data-studio-reload=""
            onClick={onReload}
          >
            {LATE_ALERT_TEXT.reload}
          </button>
          {profile === 'owner' ? <SignOutForm /> : null}
        </div>
      </div>
    </>
  );
  return main ? (
    <main className="studio-shell__main" id="studio-load-failure" tabIndex={-1}>
      {content}
    </main>
  ) : (
    <div className="studio-shell__main" id="studio-load-failure" tabIndex={-1}>
      {content}
    </div>
  );
}

/** What the late alert reaches in the page: the browser's, or a test's. */
export interface LateHost {
  readonly document: Pick<Document, 'body' | 'createElement' | 'getElementById' | 'querySelector'>;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
  /** Puts `html`, lateAlertHTML's, into `node` before it returns; returns what takes it out. */
  readonly mount: (node: HTMLElement, html: string) => () => void;
  readonly reload: () => void;
  /**
   * Hears every click on the page in the capture phase, ahead of the page's root, with its target:
   * while the root is still dehydrated React stops a click at the document, so a listener on the
   * late node's own button never ran.
   */
  readonly capture: (run: (target: unknown) => void) => void;
  /** Runs `run` once the page's commit is over: the node's content goes outside another's commit. */
  readonly later: (run: () => void) => void;
  /** performance.now(), the inline clock's own. */
  readonly now: () => number;
  /** The page's inline clock (late-markup.ts), when the server sent one and it ran; else null. */
  readonly inline: () => InlineLateClock | null;
}

/** How the page's root committed: the shell arrived, or its chunk was refused. */
export type CommitPhase = 'live' | 'rejected';

export interface LateAlert {
  /** Starts the clock, once: a second call does nothing. */
  readonly start: () => void;
  /** The page's root committed. True when the late alert's Reload was pressed: the page reloads. */
  readonly committed: (phase: CommitPhase) => boolean;
  /** Whether the late alert's Reload was pressed. */
  readonly pressed: () => boolean;
}

type LateState = 'idle' | 'armed' | 'committed' | 'shown' | 'pressed' | 'handed';

export function createLateAlert(host: LateHost): LateAlert {
  let state: LateState = 'idle';
  let timer: unknown = null;
  let node: HTMLElement | null = null;
  let unmount: (() => void) | null = null;
  // The page's inline clock, once adopted: its press is this alert's press.
  let adopted: InlineLateClock | null = null;
  const pressedNow = () => state === 'pressed' || (state === 'shown' && adopted?.pressed === true);

  function show() {
    if (state !== 'armed') return;
    state = 'shown';
    const { document } = host;
    const late = document.createElement(LATE_ALERT_TAG);
    document.body.appendChild(late);
    node = late;
    unmount = host.mount(late, lateAlertHTML(pageProfileOf(document)));
    // Reload Studio takes focus as the alert shows, and reloads on a click on it alone.
    const reload = late.querySelector<HTMLElement>(RELOAD_SELECTOR);
    if (reload) {
      host.capture((target) => {
        if ((target as Element | null)?.closest?.(RELOAD_SELECTOR) !== reload) return;
        if (state === 'shown') state = 'pressed';
        host.reload();
      });
      reload.focus();
    }
  }

  return {
    start() {
      if (state !== 'idle') return;
      // The server's inline clock started at HTML parse. Shown, its alert is this one's;
      // else it stops, and this clock runs out the rest of its time, from the same start.
      const inline = host.inline();
      if (inline) {
        adopted = inline;
        if (inline.node) {
          state = inline.pressed ? 'pressed' : 'shown';
          node = inline.node;
          unmount = null;
          return;
        }
        inline.cancel();
        state = 'armed';
        const left = Math.max(0, STUDIO_LOAD_TIMEOUT_MS - (host.now() - inline.startedAt));
        timer = host.setTimeout(show, left);
        return;
      }
      state = 'armed';
      timer = host.setTimeout(show, STUDIO_LOAD_TIMEOUT_MS);
    },
    committed(phase) {
      if (state === 'idle' || state === 'armed') {
        if (state === 'armed') host.clearTimeout(timer);
        state = 'committed';
        return false;
      }
      if (state === 'shown' && !pressedNow()) {
        state = 'handed';
        node?.remove();
        node = null;
        const done = unmount;
        unmount = null;
        // Outside the page's commit, and even if its client render already took the element out.
        if (done) host.later(done);
        if (phase === 'live') host.document.getElementById('studio-main')?.focus();
        return false;
      }
      return pressedNow();
    },
    pressed: pressedNow,
  };
}

/** Where the page keeps its one late alert, so a module evaluated twice still arms one clock. */
export interface LateScope {
  portfolioStudioLateAlert?: LateAlert;
}

/** The late alert `scope` holds, made over `host()` the first time. */
export function lateAlertIn(scope: LateScope, host: () => LateHost): LateAlert {
  scope.portfolioStudioLateAlert ??= createLateAlert(host());
  return scope.portfolioStudioLateAlert;
}

function browserHost(): LateHost {
  return {
    document,
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
    mount: (node, html) => {
      node.innerHTML = html;
      return () => node.replaceChildren();
    },
    reload: () => window.location.reload(),
    capture: (run) => window.addEventListener('click', (event) => run(event.target), true),
    later: (run) => queueMicrotask(run),
    now: () => performance.now(),
    inline: () =>
      (window as unknown as Record<string, InlineLateClock | undefined>)[LATE_CLOCK_KEY] ?? null,
  };
}

const late =
  typeof window === 'undefined'
    ? null
    : lateAlertIn(globalThis as unknown as LateScope, browserHost);
late?.start();

/** The page's root committed. True when the late alert's Reload was pressed: the boundary yields to it. */
export function lateCommitted(phase: CommitPhase): boolean {
  return late?.committed(phase) ?? false;
}

/** Whether the late alert's Reload was pressed. */
export function latePressed(): boolean {
  return late?.pressed() ?? false;
}
