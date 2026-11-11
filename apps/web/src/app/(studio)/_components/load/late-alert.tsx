'use client';

import type { ReactNode, Ref } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { pageProfileOf, SignOutForm } from '../sign-out-form';

// Studio's late alert (row 88c): when the shell's chunk is still on its way
// after STUDIO_LOAD_TIMEOUT_MS, "Studio couldn't load." shows in a React root
// of its own, outside the page's.
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
// So the clock starts here, when the module first evaluates in a browser:
// the page's entry holds it (load-boundary.tsx imports it), and the Flight
// client requires it before hydration starts. Every entry to /studio is a
// full page load, so one evaluation is one entry. At 5 s, if the boundary
// hasn't said the page's root committed, a <studio-load-late> element goes
// in as a direct child of <body>, with a root of its own and the alert. body
// is a singleton, and React passes over an element it didn't render there
// when it hydrates body later, if no element it renders could claim it: a
// custom tag, as Next's route announcer is, never matches the server's
// divs, where a <div> would be claimed and force a client render of the
// root (#418). studio.css hides the server's shell while it's there, so
// nothing React hydrates is touched. The late root unmounts in a microtask
// after the hand-off, outside the page's render and commit, whether or not a
// client render of the page's root already took its element out of <body>.
//
// When the page's root commits, the boundary calls lateCommitted():
// - before 5 s, the clock stops, and nothing shows;
// - after the alert showed and Reload wasn't pressed, the late root goes
//   with its node, and the shell shows again: a shell that arrived ('live')
//   gets focus at #studio-main, and a refused one ('rejected') gets the
//   boundary's own alert, which takes focus;
// - once Reload was pressed, the page reloads: the late root and its element
//   are left alone, and the boundary renders no second alert. A shell that
//   arrives in the moment before the reload lands may show until it does.
//
// The alert offers Reload Studio, here and in the boundary, under both
// profiles, and under owner Sign out too: a plain form post to auth.logout
// (sign-out-form.tsx, row 88c-RC2), so no owner code goes in the page's entry,
// which Demo Studio's page loads too (#9).

/** How long a shell, or the owner adapter it loads, may take before Studio says it couldn't load. */
export const STUDIO_LOAD_TIMEOUT_MS = 5_000;

/** The late alert's element, a direct child of <body>: a custom tag, which hydration never claims. */
export const LATE_ALERT_TAG = 'studio-load-late';

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
      <h1 className="studio-shell__name">Portfolio Studio</h1>
      <div className="studio-alert" role="alert">
        <p>Studio couldn&apos;t load.</p>
        <button ref={reload} type="button" className="studio-button" onClick={onReload}>
          Reload Studio
        </button>
        {profile === 'owner' ? <SignOutForm /> : null}
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
  /** Renders `alert` into `node`, in a root of its own, before it returns; returns the unmount. */
  readonly mount: (node: HTMLElement, alert: ReactNode) => () => void;
  readonly reload: () => void;
  /** Runs `run` once the page's commit is over: a root unmounts outside another's commit. */
  readonly later: (run: () => void) => void;
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

  function show() {
    if (state !== 'armed') return;
    state = 'shown';
    const { document } = host;
    const late = document.createElement(LATE_ALERT_TAG);
    document.body.appendChild(late);
    node = late;
    unmount = host.mount(
      late,
      <StudioLoadAlert
        main={false}
        profile={pageProfileOf(document)}
        onReload={() => {
          if (state === 'shown') state = 'pressed';
          host.reload();
        }}
      />,
    );
    // Reload Studio takes focus as the alert shows.
    late.querySelector<HTMLElement>('.studio-alert button')?.focus();
  }

  return {
    start() {
      if (state !== 'idle') return;
      state = 'armed';
      timer = host.setTimeout(show, STUDIO_LOAD_TIMEOUT_MS);
    },
    committed(phase) {
      if (state === 'idle' || state === 'armed') {
        if (state === 'armed') host.clearTimeout(timer);
        state = 'committed';
        return false;
      }
      if (state === 'shown') {
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
      return state === 'pressed';
    },
    pressed: () => state === 'pressed',
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
    mount: (node, alert) => {
      const root = createRoot(node);
      flushSync(() => root.render(alert));
      return () => root.unmount();
    },
    reload: () => window.location.reload(),
    later: (run) => queueMicrotask(run),
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
