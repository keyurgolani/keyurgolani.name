import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {
  createLateAlert,
  LATE_ALERT_TAG,
  lateAlertIn,
  STUDIO_LOAD_TIMEOUT_MS,
  type LateHost,
  type LateScope,
} from './late-alert';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Studio's late alert (row 88c), over a page of its own: its clock under
// fake timers, the node it puts in <body>, what it renders there, and where
// focus goes. The shell has no DOM harness, so the page here is the least
// the alert reaches: <body>'s children, #studio-main, and the late root,
// whose markup is the alert's server render.

/** A node the alert can put in <body>. */
interface FakeNode {
  readonly tagName: string;
  parent: FakeBody | null;
  readonly isConnected: boolean;
  remove(): void;
  querySelector(selectors: string): { focus(): void } | null;
}
interface FakeBody {
  children: FakeNode[];
  appendChild(node: FakeNode): FakeNode;
}

/** The page, whose .studio-load wrapper names `profile` (the load boundary's, row 88c-RC2 (b)). */
function fakePage(profile: string | null = null) {
  let focused: string | null = null;
  const body: FakeBody = {
    children: [],
    appendChild(node) {
      node.remove();
      node.parent = body;
      body.children.push(node);
      return node;
    },
  };
  const clicks: ((target: unknown) => void)[] = [];
  const reloadButton: { focus(): void; closest(selectors: string): unknown } = {
    focus: () => void (focused = 'Reload Studio'),
    closest: (selectors) => (selectors === '[data-studio-reload]' ? reloadButton : null),
  };
  const document = {
    body,
    createElement(tag: string): FakeNode {
      const node: FakeNode = {
        tagName: tag.toUpperCase(),
        parent: null,
        get isConnected() {
          return node.parent !== null;
        },
        remove() {
          if (node.parent) node.parent.children = node.parent.children.filter((n) => n !== node);
          node.parent = null;
        },
        querySelector: (selectors) => (selectors === '[data-studio-reload]' ? reloadButton : null),
      };
      return node;
    },
    getElementById: (id: string) =>
      id === 'studio-main' ? { focus: () => void (focused = 'studio-main') } : null,
    querySelector: (selectors: string) =>
      selectors === '.studio-load'
        ? { getAttribute: (name: string) => (name === 'data-studio-profile' ? profile : null) }
        : null,
  };
  const armed: number[] = [];
  const cleared: unknown[] = [];
  const rendered: string[] = [];
  let unmounted = 0;
  let reloads = 0;
  const host: LateHost = {
    document: document as unknown as LateHost['document'],
    // The global timers, which the test's mock replaces.
    setTimeout: (run, ms) => {
      armed.push(ms);
      return setTimeout(run, ms);
    },
    clearTimeout: (timer) => {
      cleared.push(timer);
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    },
    mount: (_node, html) => {
      rendered.push(html);
      return () => void (unmounted += 1);
    },
    reload: () => void (reloads += 1),
    capture: (run) => void clicks.push(run),
    later: (run) => queueMicrotask(run),
    now: () => Date.now(),
    inline: () => null,
  };
  return {
    host,
    body,
    armed,
    cleared,
    rendered,
    lateNodes: () =>
      body.children.filter((node) => node.tagName === LATE_ALERT_TAG.toUpperCase()).length,
    /** What React's client render of the page's root does to <body>: every node it didn't render goes. */
    clearBody: () => {
      for (const node of [...body.children]) node.remove();
    },
    focused: () => focused,
    /** A click on the shown alert's Reload Studio, as the page's capture listener hears it. */
    click: () => {
      for (const run of clicks) run(reloadButton);
    },
    /** A click anywhere else on the page: on an element outside Reload Studio. */
    clickElsewhere: () => {
      for (const run of clicks) run({ closest: () => null });
    },
    unmounted: () => unmounted,
    reloads: () => reloads,
  };
}

/** The alert the late root renders: the one the boundary renders too, as a plain box. */
const LATE_MARKUP =
  '<div class="studio-shell__main" id="studio-load-failure" tabindex="-1"><h1 class="studio-shell__name">Portfolio Studio</h1><div class="studio-alert" role="alert"><p>Studio couldn&#x27;t load.</p><div class="studio-alert__actions"><button type="button" class="studio-button" data-studio-reload="">Reload Studio</button></div></div></div>';

test("a commit before 5 seconds stops the late alert's clock: no <studio-load-late>, even once the timers run past 5 seconds (row 88c)", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const late = createLateAlert(page.host);
  late.start();
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS - 1);
  assert.equal(late.committed('live'), false);
  assert.equal(page.cleared.length, 1, 'the clock stopped');
  t.mock.timers.tick(10_000);
  assert.equal(page.lateNodes(), 0);
  assert.deepEqual(page.rendered, []);
  assert.equal(page.focused(), null);
  t.mock.timers.reset();
});

test('evaluating or starting the late alert twice arms one clock, and shows one <studio-load-late> (row 88c)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const scope: LateScope = {};
  const first = lateAlertIn(scope, () => page.host);
  first.start();
  // The module evaluated again finds the page's one late alert, and starting it again does nothing.
  const again = lateAlertIn(scope, () => page.host);
  assert.equal(again, first);
  again.start();
  first.start();
  assert.deepEqual(page.armed, [STUDIO_LOAD_TIMEOUT_MS]);
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
  assert.equal(page.lateNodes(), 1);
  assert.equal(page.rendered.length, 1);
  t.mock.timers.reset();
});

test("at 5 seconds with no commit, exactly one <studio-load-late> in <body> says Studio couldn't load, with Reload Studio focused and nothing else (row 88c)", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const late = createLateAlert(page.host);
  late.start();
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS - 1);
  assert.equal(page.lateNodes(), 0);
  t.mock.timers.tick(1);
  assert.equal(page.body.children.length, 1);
  assert.equal(page.lateNodes(), 1);
  assert.deepEqual(page.rendered, [LATE_MARKUP]);
  assert.equal(page.focused(), 'Reload Studio');
  t.mock.timers.tick(60_000);
  assert.equal(page.lateNodes(), 1, 'one, however long the shell takes');
  t.mock.timers.reset();
});

test("the 'live' hand-off removes <studio-load-late>, unmounts its root once the commit is over, and focuses #studio-main (row 88c)", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const late = createLateAlert(page.host);
  late.start();
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
  assert.equal(page.lateNodes(), 1);
  assert.equal(late.committed('live'), false);
  assert.equal(page.lateNodes(), 0);
  assert.equal(page.focused(), 'studio-main');
  assert.equal(page.unmounted(), 0, 'not inside the commit');
  await Promise.resolve();
  assert.equal(page.unmounted(), 1);
  // A later commit changes nothing.
  assert.equal(late.committed('live'), false);
  assert.equal(page.lateNodes(), 0);
  t.mock.timers.reset();
});

test("the 'rejected' hand-off removes <studio-load-late> and leaves focus to the boundary's own alert (row 88c)", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const late = createLateAlert(page.host);
  late.start();
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
  assert.equal(page.focused(), 'Reload Studio');
  assert.equal(late.committed('rejected'), false);
  assert.equal(page.lateNodes(), 0);
  assert.equal(page.focused(), 'Reload Studio', 'not moved to #studio-main');
  await Promise.resolve();
  assert.equal(page.unmounted(), 1);
  t.mock.timers.reset();
});

test('a hand-off after a client render of the page took <studio-load-late> out still unmounts the orphaned root, in a later microtask, never inside committed() (row 88c)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const phase of ['live', 'rejected'] as const) {
    const page = fakePage();
    const late = createLateAlert(page.host);
    late.start();
    t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
    // React's client render of the page's root clears <body> of what it didn't render.
    page.clearBody();
    assert.equal(late.committed(phase), false);
    assert.equal(page.lateNodes(), 0, phase);
    assert.equal(page.unmounted(), 0, `${phase}: not inside committed()`);
    await Promise.resolve();
    assert.equal(page.unmounted(), 1, `${phase}: once the commit is over`);
  }
  t.mock.timers.reset();
});

test('once Reload Studio is pressed in the late alert, the page reloads, and a commit leaves <studio-load-late> and its root alone (row 88c)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const late = createLateAlert(page.host);
  late.start();
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
  assert.equal(late.pressed(), false);
  // The alert's Reload Studio, as its click calls it.
  page.click();
  assert.equal(page.reloads(), 1);
  assert.equal(late.pressed(), true);
  assert.equal(late.committed('live'), true, 'the boundary yields to it');
  assert.equal(page.lateNodes(), 1);
  assert.equal(page.focused(), 'Reload Studio');
  assert.equal(late.committed('rejected'), true);
  assert.equal(page.lateNodes(), 1);
  await Promise.resolve();
  assert.equal(page.unmounted(), 0, 'its root stays mounted');
  t.mock.timers.reset();
});

test("the late alert hears clicks in the capture phase, ahead of the page's root, and answers Reload Studio's alone: a click anywhere else reloads nothing", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const late = createLateAlert(page.host);
  late.start();
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
  page.clickElsewhere();
  assert.equal(page.reloads(), 0, 'a click elsewhere');
  assert.equal(late.pressed(), false);
  page.click();
  assert.equal(page.reloads(), 1, 'Reload Studio');
  assert.equal(late.pressed(), true);
  t.mock.timers.reset();
});

test("the late alert offers Sign out under the profile the page's .studio-load wrapper names, owner alone, never <body>'s (row 88c-RC2 (b))", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown = (profile: string | null) => {
    const page = fakePage(profile);
    // A <body> that still named owner would offer it under demo: the wrapper is what counts.
    Object.assign(page.body, { dataset: { studioProfile: 'owner' } });
    createLateAlert(page.host).start();
    t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS);
    assert.equal(page.rendered.length, 1);
    return page.rendered[0]!;
  };
  const owner = shown('owner');
  assert.match(owner, /<form[^>]*\saction="\/api\/studio\/auth\.logout"/);
  assert.match(owner, />Sign out<\/button>/);
  for (const profile of ['demo', null]) {
    assert.equal(shown(profile), LATE_MARKUP, `under ${String(profile)}`);
  }
});

// The page's inline clock (late-markup.ts) starts at HTML parse; the module adopts it.
const inlineClock = (startedAt: number, node: FakeNode | null = null, pressed = false) => {
  let cancelled = 0;
  return {
    clock: {
      startedAt,
      node: node as unknown as HTMLElement | null,
      pressed,
      cancel: () => void (cancelled += 1),
    },
    cancelled: () => cancelled,
  };
};

test('an inline clock still running is adopted: its timer stops, and this one runs out the rest of its time from the same start, so one clock arms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const inline = inlineClock(8_000);
  const late = createLateAlert({ ...page.host, now: () => 10_000, inline: () => inline.clock });
  late.start();
  late.start();
  assert.equal(inline.cancelled(), 1, "the inline clock's timer stopped");
  assert.deepEqual(page.armed, [STUDIO_LOAD_TIMEOUT_MS - 2_000], 'one clock, for what was left');
  t.mock.timers.tick(STUDIO_LOAD_TIMEOUT_MS - 2_001);
  assert.equal(page.lateNodes(), 0);
  t.mock.timers.tick(1);
  assert.equal(page.lateNodes(), 1, 'one <studio-load-late>, at the inline start plus the timeout');
  assert.deepEqual(page.rendered, [LATE_MARKUP]);
  t.mock.timers.reset();
});

test("an inline clock that already showed its alert is adopted: no clock arms, and the 'live' hand-off takes its node out and focuses #studio-main", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const node = (
    page.host.document as unknown as { createElement(tag: string): FakeNode }
  ).createElement(LATE_ALERT_TAG);
  page.body.appendChild(node);
  const inline = inlineClock(0, node);
  const late = createLateAlert({ ...page.host, now: () => 9_000, inline: () => inline.clock });
  late.start();
  assert.deepEqual(page.armed, [], 'no second clock');
  assert.equal(inline.cancelled(), 0);
  assert.equal(late.pressed(), false);
  assert.equal(late.committed('live'), false);
  assert.equal(page.lateNodes(), 0, 'its node went');
  assert.equal(page.focused(), 'studio-main');
  t.mock.timers.reset();
});

test('an inline alert whose Reload Studio was pressed is left alone: the page reloads, and the boundary yields to it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakePage();
  const node = (
    page.host.document as unknown as { createElement(tag: string): FakeNode }
  ).createElement(LATE_ALERT_TAG);
  page.body.appendChild(node);
  const inline = inlineClock(0, node);
  const late = createLateAlert({ ...page.host, now: () => 9_000, inline: () => inline.clock });
  late.start();
  inline.clock.pressed = true;
  assert.equal(late.pressed(), true);
  assert.equal(late.committed('live'), true);
  assert.equal(page.lateNodes(), 1, 'its node stays');
  t.mock.timers.reset();
});
