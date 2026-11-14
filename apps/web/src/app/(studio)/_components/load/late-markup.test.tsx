import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { createLateAlert, StudioLoadAlert, type LateHost } from './late-alert';
import { StudioLoadBoundary } from './load-boundary';
import {
  inlineLateClockScript,
  LATE_ALERT_TAG,
  LATE_CLOCK_KEY,
  lateAlertHTML,
  STUDIO_LOAD_TIMEOUT_MS,
} from './late-markup';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Studio's late alert can't depend on the code that's late. When a chunk the page's client
// modules need stalls, the Flight client evaluates none of them, late-alert.tsx included, so the
// page sends its own clock: one inline script, nonced under Studio's existing CSP, which shows the
// alert at STUDIO_LOAD_TIMEOUT_MS unless the entry adopted it. Both clocks build the alert from
// lateAlertHTML, the one source of its markup, and the boundary's own alert renders the same.

const PROFILES = ['owner', 'demo'] as const;

/** A thrower for whatever the inline script must never touch. */
const forbidden = (what: string) => () => {
  throw new Error(`the inline clock read ${what}`);
};

/** Runs the inline clock in a page of its own, its timer fired: what it put in <body>, and how. */
function runInline(profile: (typeof PROFILES)[number]) {
  const timers: { run: () => void; ms: number }[] = [];
  const appended: { tag: string; innerHTML: string }[] = [];
  const state = { focused: 0, reloads: 0, clicks: [] as (() => void)[] };
  const button: { focus(): void; closest(selectors: string): unknown } = {
    focus: () => void (state.focused += 1),
    closest: (selectors) => (selectors === '[data-studio-reload]' ? button : null),
  };
  const document = Object.defineProperties(
    {
      createElement: (tag: string) => {
        const node = {
          tag,
          innerHTML: '',
          querySelector: (selectors: string) =>
            selectors === '[data-studio-reload]' ? button : null,
        };
        return node;
      },
      body: { appendChild: (node: { tag: string; innerHTML: string }) => void appended.push(node) },
    },
    { cookie: { get: forbidden('document.cookie'), set: forbidden('document.cookie') } },
  );
  // Clicks on the page as its capture listener on window hears them: each simulated click lands
  // first on something else, which must do nothing, then on Reload Studio.
  const window: Record<string, unknown> = {
    addEventListener: (
      type: string,
      run: (event: { target: unknown }) => void,
      capture: boolean,
    ) => {
      if (type !== 'click' || capture !== true) return;
      state.clicks.push(() => {
        run({ target: { closest: () => null } });
        assert.equal(state.reloads, 0, 'a click elsewhere reloads nothing');
        run({ target: button });
      });
    },
  };
  const sandbox: Record<string, unknown> = {
    window,
    document,
    performance: { now: () => 1234 },
    setTimeout: (run: () => void, ms: number) => timers.push({ run, ms }),
    clearTimeout: () => {},
    location: { reload: () => void (state.reloads += 1) },
  };
  for (const name of [
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'navigator',
    'caches',
  ]) {
    Object.defineProperty(sandbox, name, { get: forbidden(name) });
    Object.defineProperty(window, name, { get: forbidden(name) });
  }
  vm.runInNewContext(inlineLateClockScript(profile), sandbox);
  const clock = window[LATE_CLOCK_KEY] as { startedAt: number; node: unknown; pressed: boolean };
  return { timers, appended, state, clock };
}

test("the late alert's markup is the boundary's alert, as React renders it, under owner and demo, and none other", () => {
  for (const profile of [...PROFILES, null]) {
    assert.equal(
      lateAlertHTML(profile),
      renderToStaticMarkup(<StudioLoadAlert main={false} profile={profile} onReload={() => {}} />),
      String(profile),
    );
  }
  assert.match(
    lateAlertHTML('owner'),
    /<form class="studio-sign-out" action="\/api\/studio\/auth\.logout" method="post">/,
  );
  assert.doesNotMatch(lateAlertHTML('demo'), /<form|Sign out/);
});

test("the inline clock and late-alert.tsx's put the same <studio-load-late> in <body>, under owner and demo, at STUDIO_LOAD_TIMEOUT_MS", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const profile of PROFILES) {
    const inline = runInline(profile);
    assert.deepEqual(
      inline.timers.map(({ ms }) => ms),
      [STUDIO_LOAD_TIMEOUT_MS],
      `${profile}: one timer`,
    );
    assert.equal(inline.clock.startedAt, 1234);
    assert.equal(inline.appended.length, 0, 'nothing before the timeout');
    inline.timers[0]!.run();
    assert.equal(inline.appended.length, 1);
    assert.equal(inline.appended[0]!.tag, LATE_ALERT_TAG);
    assert.equal(inline.clock.node, inline.appended[0], 'its node, for the entry to adopt');
    assert.equal(inline.state.focused, 1, 'Reload Studio takes focus');
    inline.state.clicks[0]!();
    assert.equal(inline.clock.pressed, true);
    assert.equal(inline.state.reloads, 1, 'Reload Studio reloads');

    // late-alert.tsx's own clock, on a page whose load boundary names the same profile.
    const mounted: string[] = [];
    const body = { appendChild: () => {} };
    const host: LateHost = {
      document: {
        body,
        createElement: () => ({ querySelector: () => null }),
        getElementById: () => null,
        querySelector: (selectors: string) =>
          selectors === '.studio-load' ? { getAttribute: () => profile } : null,
      } as unknown as LateHost['document'],
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      mount: (_node, html) => {
        mounted.push(html);
        return () => {};
      },
      reload: () => {},
      capture: () => {},
      later: (run) => run(),
      now: () => 0,
      inline: () => null,
    };
    createLateAlert(host).start();
    t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
    assert.deepEqual(
      mounted,
      [inline.appended[0]!.innerHTML],
      `${profile}: the same DOM from both clocks`,
    );
  }
  t.mock.timers.reset();
});

test('the inline clock reads no cookie, no storage and nothing from the network, holds no "</" a parser would end it at, and starts once', () => {
  for (const profile of PROFILES) {
    const source = inlineLateClockScript(profile);
    assert.doesNotMatch(
      source,
      /cookie|Storage|indexedDB|fetch|XMLHttpRequest|navigator|caches|import\(/,
      profile,
    );
    assert.ok(!source.includes('</'), `${profile}: no "</" in the script`);
    // Run with all of those throwing: it touches none of them, before or after its timer.
    const inline = runInline(profile);
    inline.timers[0]!.run();
    inline.state.clicks[0]!();
  }
  // A second run on the same page keeps the first clock: a page sends one.
  const window: Record<string, unknown> = {};
  const timers: unknown[] = [];
  const sandbox = {
    window,
    performance: { now: () => 1 },
    setTimeout: (run: unknown) => timers.push(run),
    clearTimeout: () => {},
  };
  vm.runInNewContext(inlineLateClockScript('demo'), sandbox);
  const first = window[LATE_CLOCK_KEY];
  vm.runInNewContext(inlineLateClockScript('demo'), sandbox);
  assert.equal(window[LATE_CLOCK_KEY], first);
  assert.equal(timers.length, 1);
});

test('the load boundary sends exactly one inline script, nonced, holding the clock for its profile, and none without a nonce', () => {
  for (const profile of PROFILES) {
    const html = renderToString(
      <StudioLoadBoundary profile={profile} nonce="bm9uY2U=">
        <p>shell</p>
      </StudioLoadBoundary>,
    );
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1, `${profile}: one script`);
    assert.match(scripts[0]![1]!, /\snonce="bm9uY2U="/);
    assert.equal(scripts[0]![2], inlineLateClockScript(profile));
    const bare = renderToString(
      <StudioLoadBoundary profile={profile}>
        <p>shell</p>
      </StudioLoadBoundary>,
    );
    assert.doesNotMatch(bare, /<script/, `${profile}: no nonce, no script`);
  }
});

test("only /studio's page renders the load boundary, and only the boundary sends the inline clock", () => {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(file);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
    });
  const using = (name: RegExp) =>
    sources(app)
      .filter((file) => name.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(app, file))
      .sort();
  assert.deepEqual(using(/<StudioLoadBoundary\b/), ['studio/page.tsx']);
  // Its definition aside, the one caller.
  assert.deepEqual(
    using(/inlineLateClockScript\(/).filter((file) => file !== '_components/load/late-markup.ts'),
    ['_components/load/load-boundary.tsx'],
  );
});
