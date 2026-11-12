// The checks that reload the page under a condition (#11, Slice 2, items
// 5, 6, 8, and the original's item 4), each against the page as the cell
// first loaded it.
//
// - inventory: every heading, text block, link and its target, image alt,
//   and control the default render has is still there under each of the
//   original's item 4 conditions (no hover, no pointer precision, no
//   animation, no canvas or WebGL, no translucency, color alone, no loaded
//   font), and with JavaScript off and in print. A field counts when shown
//   or inside a closed <details>. Each condition must take, or the check
//   fails rather than pass a page it never changed.
// - enhancement: with the optional chunks (every script chunk the HTML,
//   as served, doesn't name), the canvas contexts, and the fonts taken away,
//   the page keeps one main, an h1, a skip link that lands in its target,
//   every fragment link's target, and its inventory, but a button that
//   submits nothing, an enhancement that may wait for its script, and its
//   own label, as without JavaScript and in print.
// - Each reload under a condition with script on, failed enhancement
//   included, is read once its enhancements have mounted or failed, as
//   the cell's own read is (its first phase): no script chunk still
//   loading, no island's data-island still changing, and nothing marked
//   pending, and the wait then holds 500 ms past the last optional chunk
//   or island change, React's retry delay and a margin, and 800 ms past
//   an optional chunk that failed, Turbopack's longest retry and the
//   margin; and then, as React may reveal what a chunk loaded a while
//   after it lands, until the page shows what the baseline had, all
//   within BUSY_LIMIT_MS. The same wait serves the main pass, the
//   primitives page, the landscape pass, the variant shots
//   (tests/variants/modes.ts) and the e2e watches (watchEnhancements()).
//   Chunks or islands still at it then fail the cell with
//   STILL_ENHANCING; a field still missing is the read's own finding.
//   Either way the page is read as it stands. A reflow condition's
//   reload takes the first phase only, the enhancements, since it has no
//   baseline to show; then its fonts, and only then its root text.
// - reflow: at 320x568, at 200% zoom (640x400 at deviceScaleFactor 2), and
//   at 200% root text (1024x768), nothing scrolls sideways, and no text or
//   control leaves the viewport or a box that clips it, but inside a
//   declared scroll region: one a keyboard reaches, with a name.
// - transparency: under prefers-reduced-transparency, no backdrop-filter,
//   and #19's Surface, Dialog, and Navigation slots opaque.
// - A surface that needs its script by design, a Studio surface registering
//   `requiresScript` (registration.ts): with JavaScript off, and in print
//   over that page, its honest no-JavaScript state replaces the inventory
//   comparison. The page settles, says in #content that it needs
//   JavaScript, keeps one main, an h1, and its skip target, and passes axe.
//   Under failed enhancement its failure state does: an alert that it
//   couldn't load, a control to try again that takes focus, nothing still
//   aria-busy, and axe, beside the landmark, fragment, and skip checks.

import type { CDPSession, Page, Request, Response } from '@playwright/test';
import { loadThresholds, viewportSize } from '../../../../quality/thresholds';
import { axeFor } from '../axe';
import { frames, type Finding } from './interaction';
import { decodePng, parseCssColor, type Image } from '../pixels';
import { inPage } from './probe';
import { ENHANCEMENT_PENDING } from '../../../../packages/variant-contract/src/settle';

const thresholds = loadThresholds();

/** The color scheme the cells' contexts emulate, which a CDP media override must keep. */
const BASE_FEATURES = [{ name: 'prefers-color-scheme', value: 'light' }];

/** WebGL, WebGL 2, and 2D canvas contexts come back null, as on a browser without them. */
export const NO_CANVAS = `(() => {
  const none = /^(?:webgl2?|experimental-webgl|2d|bitmaprenderer|webgpu)$/;
  for (const type of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas]) {
    if (!type) continue;
    const original = type.prototype.getContext;
    type.prototype.getContext = function (kind, ...rest) {
      return none.test(String(kind)) ? null : original.call(this, kind, ...rest);
    };
  }
})();`;

/**
 * On paper no control works, so print may drop every one, and a button that
 * submits nothing takes its own label, a block of nothing else (the
 * inventory's `button label:`), with it. A same-document skip link is a
 * control too (`control: skip-link`), and a block of such controls and at
 * most a short label of its own (`control label:`) goes with them. Words
 * marked data-script-only, which only live script sets (`script-only:`), go
 * too. A submit button's label and a link's text are still the page's text.
 */
export const PRINT_IGNORE = /^(?:control|button label|control label|script-only): /;
/**
 * Without JavaScript, or its enhancements, a button that submits no form may stay out, its own
 * label with it, and so may a skip link and a block of such controls and a short label, and
 * words marked data-script-only.
 */
export const NO_SCRIPT_IGNORE =
  /^(?:control: (?:button:(?:button|reset)|skip-link)|button label:|control label:|script-only:) /;

/**
 * Row 92's key-hint allowance (the coordinator, 7 Nov 2026): a block marked data-script-only that
 * holds a <kbd>, no heading, link, image or control, and names the control it stands for with
 * data-key-hint-for, is the inventory's `key-hint: #<id> <words>` (probe.ts). It tells a keyboard
 * user how to do what that control does, so where a condition takes it away it may go only while
 * the control it names is there: under touch and without JavaScript (failed enhancement too), in
 * the DOM, shown and enabled (`usable`); in print, which lets every control go, in the DOM
 * (`in-dom`). Any other condition still counts it. The harness never infers which control a hint
 * stands for: a hint with no id, or one naming nothing, no control, or a control the condition
 * hides or disables, is a finding.
 */
export const KEY_HINT = /^key-hint: #(\S+) /;

/** How a condition's dropped key hint's control must be: usable, or in the DOM. */
export type KeyHintRule = 'usable' | 'in-dom';

/** What a condition does to the page, and how the check knows it took. */
export interface Condition {
  readonly id: string;
  /** Reload under it: false for one that applies to the page as loaded. */
  readonly reload: boolean;
  /** Fields it may take away, as nothing a visitor needs under it. */
  readonly ignore?: RegExp;
  /** Whether it may take a key hint away, and how the hint's control must be then (KEY_HINT). */
  readonly keyHint?: KeyHintRule;
  setup(page: Page, cdp: CDPSession): Promise<void>;
  /** Why it didn't take, or null when it did. */
  verify(page: Page): Promise<string | null>;
  teardown(page: Page, cdp: CDPSession): Promise<void>;
}

const matches = (query: string) => async (page: Page) =>
  (await page.evaluate((q) => matchMedia(q).matches, query)) ? null : `${query} doesn't match`;

/** A media feature only CDP emulates, such as hover or prefers-reduced-transparency. */
function feature(
  id: string,
  features: { name: string; value: string }[],
  query: string,
): Condition {
  return {
    id,
    reload: true,
    setup: async (_page, cdp) => {
      await cdp.send('Emulation.setEmulatedMedia', {
        media: '',
        features: [...BASE_FEATURES, ...features],
      });
    },
    verify: matches(query),
    teardown: async (_page, cdp) => {
      await cdp.send('Emulation.setEmulatedMedia', { media: '', features: BASE_FEATURES });
    },
  };
}

/** Fonts the page asks for are aborted, and a font that loads anyway undoes the condition. */
function noFont(): Condition {
  const loaded: string[] = [];
  const onFinished = (request: Request) => {
    if (request.resourceType() === 'font') loaded.push(request.url());
  };
  return {
    id: 'no-font',
    reload: true,
    setup: async (page) => {
      loaded.length = 0;
      await page.route('**/*', (route) =>
        route.request().resourceType() === 'font'
          ? route.abort('blockedbyclient')
          : route.fallback(),
      );
      page.on('requestfinished', onFinished);
    },
    verify: async () => (loaded.length > 0 ? `${loaded[0]} loaded` : null),
    teardown: async (page) => {
      page.off('requestfinished', onFinished);
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}

function noCanvas(): Condition {
  let script = '';
  return {
    id: 'no-canvas',
    reload: true,
    setup: async (_page, cdp) => {
      // The session's Page domain must be on for its script to reach new documents.
      await cdp.send('Page.enable');
      ({ identifier: script } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: NO_CANVAS,
      }));
    },
    verify: async (page) =>
      (await page.evaluate(() => document.createElement('canvas').getContext('2d') === null))
        ? null
        : 'getContext("2d") still returns a context',
    teardown: async (_page, cdp) => {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    },
  };
}

/** The original's item 4 conditions, then no JavaScript and print. */
export function conditions(): Condition[] {
  return [
    {
      // Touch: no hover and no pointer precision, as Chromium's touch emulation reports them.
      id: 'touch',
      reload: true,
      // Its first allowance: a key hint shown only to a fine pointer, beside its control (row 92).
      keyHint: 'usable',
      setup: async (_page, cdp) => {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      },
      verify: async (page) =>
        (await matches('(hover: none)')(page)) ?? (await matches('(pointer: coarse)')(page)),
      teardown: async (_page, cdp) => {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      },
    },
    {
      id: 'reduced-motion',
      reload: true,
      setup: (page) => page.emulateMedia({ reducedMotion: 'reduce' }),
      verify: matches('(prefers-reduced-motion: reduce)'),
      teardown: (page) => page.emulateMedia({ reducedMotion: null }),
    },
    noCanvas(),
    feature(
      'reduced-transparency',
      [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
      '(prefers-reduced-transparency: reduce)',
    ),
    {
      id: 'grayscale',
      reload: false,
      setup: (page) =>
        page.evaluate(() =>
          document.documentElement.style.setProperty('filter', 'grayscale(1)', 'important'),
        ),
      verify: async (page) =>
        (await page.evaluate(() => getComputedStyle(document.documentElement).filter)) ===
        'grayscale(1)'
          ? null
          : "the filter didn't apply",
      teardown: async (page) => {
        await page.evaluate(() => document.documentElement.style.removeProperty('filter'));
      },
    },
    noFont(),
    {
      id: 'no-javascript',
      reload: true,
      // A button that submits nothing is an enhancement, which may wait for JavaScript.
      ignore: NO_SCRIPT_IGNORE,
      keyHint: 'usable',
      setup: async (_page, cdp) => {
        await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
      },
      verify: matches('(scripting: none)'),
      teardown: async (_page, cdp) => {
        await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
      },
    },
    {
      id: 'print',
      reload: false,
      ignore: PRINT_IGNORE,
      keyHint: 'in-dom',
      setup: (page) => page.emulateMedia({ media: 'print' }),
      verify: matches('print'),
      teardown: (page) => page.emulateMedia({ media: null }),
    },
  ];
}

/** The longest a page may say it's still loading, by aria-busy, before a check reads it anyway. */
export const BUSY_LIMIT_MS = 10_000;

/** What a page that never stops saying it's loading is, as a finding's words. */
export const STILL_BUSY = `the page still says it's loading, aria-busy="true", after ${BUSY_LIMIT_MS / 1000} s`;

/**
 * Where aria-busy is a specimen's, not the page's: inside an element marked
 * data-quality-specimen="busy", as the primitives fixture marks its loading
 * Actions, which say they're at work for good. Only fixtures carry it
 * (specimen-marker.test.ts), so a real page's stuck Save still keeps it
 * from settling.
 */
export const BUSY_SPECIMEN = '[data-quality-specimen="busy"]';

/**
 * Waits until nothing on the page says it's still loading, a shown element
 * with aria-busy="true", as a page that fetches its content after it loads
 * does (#8's Studio), up to BUSY_LIMIT_MS, but for a fixture's specimens,
 * inside BUSY_SPECIMEN, which say they're at work for good by design. One
 * that isn't rendered, such as
 * Studio's waiting line under (scripting: none), tells no one it's loading.
 * False when the page is still busy then: the caller fails the cell with
 * STILL_BUSY, and reads the page as it stands, so it never passes on a page
 * that never settled.
 */
export async function notBusy(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      (specimen) =>
        ![...document.querySelectorAll('[aria-busy="true"]')].some(
          (element) => element.getClientRects().length > 0 && !element.closest(specimen),
        ),
      BUSY_SPECIMEN,
      { timeout: BUSY_LIMIT_MS },
    )
    .then(
      () => true,
      () => false,
    );
}

/** A finding for a page a condition reloaded that never settled. */
const stillBusy = (condition: string): Finding => ({
  gate: 'runner',
  rule: 'settled',
  expected: `the page settles under ${condition}`,
  actual: STILL_BUSY,
});

/** What a page whose enhancements never finished mounting or failing is, as a finding's words. */
export const STILL_ENHANCING = `the page's enhancements were still loading, a script in flight, an island changing or a first pass pending, or within React's retry delay after the last one, after ${BUSY_LIMIT_MS / 1000} s`;

/**
 * STILL_ENHANCING and what held the wait as it ended (enhancementsSettled(), row 109): the fixed
 * text stays the prefix, and `held`, when there is one, follows "; held by ".
 */
export const stillEnhancingText = (held?: string | null): string =>
  held ? `${STILL_ENHANCING}; held by ${held}` : STILL_ENHANCING;

/**
 * A page's own scripts: the paths its documents' HTML names, as served (htmlScripts()). `closed`
 * when they couldn't be told (no document read, a body unreadable, or none by the wait's end):
 * `paths` is empty then, so every chunk counts as optional, and failed enhancement says so rather
 * than read a page with every chunk blocked (push 3 r5, item 4).
 */
export interface OwnScripts {
  readonly paths: ReadonlySet<string>;
  readonly closed: boolean;
}

/** The script requests a page has made since it started watching, and the ones still in flight. */
interface ScriptWatch {
  readonly started: () => number;
  /** The script requests still in flight, but for one in a frame that has gone. */
  readonly pending: () => number;
  /** Those requests, each by its path and frame: the main frame, a frame by its path, or none. */
  readonly open: () => readonly { readonly path: string; readonly frame: string }[];
  /** The latest script request started, by its path, and when; null before the first. */
  readonly last: () => { readonly path: string; readonly at: number } | null;
  /**
   * When each script request it saw finish did, by URL, the latest last, and whether it failed: no
   * response, or an HTTP error, which Turbopack's runtime retries (TURBOPACK_RETRY_MAX_MS).
   */
  readonly finished: () => readonly {
    readonly url: string;
    readonly at: number;
    readonly failed: boolean;
  }[];
  /** The page's own scripts (OwnScripts), waiting for its documents' bodies until `end` at most. */
  readonly own: (end: number) => Promise<OwnScripts>;
  /** The documents whose bodies are still unread, but for one in a frame that has gone, as open(). */
  readonly unread: () => readonly { readonly path: string; readonly frame: string }[];
  readonly stop: () => void;
}

/**
 * The paths of the scripts `html` loads itself, its <script src>s, against `base`. A src that
 * won't parse as a URL is skipped.
 */
export const htmlScripts = (html: string, base: string): string[] =>
  [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].flatMap((match) => {
    try {
      return [new URL(match[1]!, base).pathname];
    } catch {
      return [];
    }
  });

/**
 * An optional enhancement's chunk: a script under /_next/static/chunks/ whose path the page's
 * HTML, as served, doesn't name (`own`), as failed enhancement tells them apart. Not the live
 * page's scripts: Turbopack, which builds next@16.4.1, appends a script element for every chunk
 * it loads and removes it only on error, so the live page names every lazy chunk too.
 */
const optionalChunk = (url: string, own: ReadonlySet<string>) => {
  const { pathname } = new URL(url);
  return /\/_next\/static\/chunks\//.test(pathname) && !own.has(pathname);
};

/** A URL's path, as a held wait names a request or a frame; the URL itself if it won't parse. */
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** How often own() looks again for a document whose frame has gone, while it awaits their bodies. */
const OWN_RECHECK_MS = 50;

/**
 * Counts `page`'s script requests from now: a lazy enhancement's chunk is one, as failed
 * enhancement blocks it. And reads each document it loads from now, the main frame's and every
 * frame's, as served: the scripts that HTML names are the page's own (`own()`), the union of
 * every document's. It fails closed: with no document read, one whose body can't be, or bodies
 * still unread at `end`, `own()` is closed and empty, and every chunk counts as optional. But for
 * a document whose frame has gone, its body unread: it's waited for no longer (row 130), as a
 * script request in such a frame holds no wait.
 */
function watchScripts(page: Page): ScriptWatch {
  const inFlight = new Set<Request>();
  const errored = new Set<Request>();
  const done: { url: string; at: number; failed: boolean }[] = [];
  // Each document the page loaded, its body as it comes: done once read, or once it couldn't be.
  const documents: {
    readonly request: Request;
    readonly path: string;
    readonly body: Promise<readonly string[] | null>;
    done: boolean;
    value: readonly string[] | null;
  }[] = [];
  let started = 0;
  let latest: { readonly path: string; readonly at: number } | null = null;
  const onResponse = (response: Response) => {
    // A script the server answered with an error failed, as the runtime sees it.
    if (response.request().resourceType() === 'script') {
      if (response.status() >= 400) errored.add(response.request());
      return;
    }
    if (response.request().resourceType() !== 'document') return;
    // A redirect has no body; the document it leads to is read in turn.
    if (response.status() >= 300 && response.status() < 400) return;
    const body = response.text().then(
      (html) => htmlScripts(html, response.url()),
      () => null,
    );
    const entry = {
      request: response.request(),
      path: pathOf(response.url()),
      body,
      done: false,
      value: null as readonly string[] | null,
    };
    void body.then((value) => {
      entry.done = true;
      entry.value = value;
    });
    documents.push(entry);
  };
  const onRequest = (request: Request) => {
    if (request.resourceType() !== 'script') return;
    inFlight.add(request);
    started += 1;
    latest = { path: pathOf(request.url()), at: Date.now() };
  };
  const onDone = (failed: boolean) => (request: Request) => {
    if (inFlight.delete(request))
      done.push({ url: request.url(), at: Date.now(), failed: failed || errored.has(request) });
  };
  const onFinished = onDone(false);
  const onFailed = onDone(true);
  // A request in a frame that has detached can never end in a way that matters, nor change the
  // page: no document is left to run what it brings. Playwright may report no end for it at all,
  // as for one paused in a route when its frame was torn down (main 5036c16d5, demo-studio content
  // at 844x390: 21 such requests held the wait to its end). So it's dropped, not recorded as
  // finished or failed, and no retry floor follows it. The bound: a request whose frame can't be
  // told, frame() throwing as for a worker's, stays counted.
  const gone = (request: Request) => {
    try {
      return request.frame().isDetached();
    } catch {
      return false;
    }
  };
  const pending = () => {
    for (const request of inFlight) if (gone(request)) inFlight.delete(request);
    return inFlight.size;
  };
  // A request's frame, as a held wait names it: one that can't be told is none.
  const frameOf = (request: Request) => {
    let frame: ReturnType<Request['frame']>;
    try {
      frame = request.frame();
    } catch {
      return 'no frame';
    }
    try {
      if (frame === page.mainFrame()) return 'main frame';
    } catch {
      // A page that can't name its main frame: the frame by its path, then.
    }
    return `frame ${pathOf(frame.url())}`;
  };
  page.on('response', onResponse);
  page.on('request', onRequest);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  return {
    started: () => started,
    pending,
    open: () => {
      pending();
      return [...inFlight].map((request) => ({
        path: pathOf(request.url()),
        frame: frameOf(request),
      }));
    },
    last: () => latest,
    finished: () => done,
    own: async (end) => {
      // Each document as its body comes. One whose frame has gone, its body still unread, is
      // waited for no longer: Playwright ends no routed request whose frame was torn down, so its
      // body may never come (row 130), and that document runs nothing on the page. Rechecked each
      // OWN_RECHECK_MS, as a frame may go while its body is awaited.
      const read = [...documents];
      const waiting = () => read.filter((each) => !each.done && !gone(each.request));
      while (waiting().length > 0) {
        const left = end - Date.now();
        if (left <= 0) return { paths: new Set(), closed: true };
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.all(waiting().map(({ body }) => body)),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.min(OWN_RECHECK_MS, left));
          }),
        ]);
        clearTimeout(timer);
      }
      const kept = read.filter((each) => each.done);
      if (kept.length === 0 || kept.some((each) => each.value === null))
        return { paths: new Set(), closed: true };
      return { paths: new Set(kept.flatMap((each) => each.value ?? [])), closed: false };
    },
    unread: () =>
      documents
        .filter((each) => !each.done && !gone(each.request))
        .map((each) => ({ path: each.path, frame: frameOf(each.request) })),
    stop: () => {
      page.off('response', onResponse);
      page.off('request', onRequest);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
    },
  };
}

/**
 * React's Suspense retry delay: a lazy component's content commits no sooner than 300 ms after the
 * latest fallback shown or hidden on the page, on a timer, the page idle in between. What ships is
 * next@16.4.1's vendored React 19.3 canary, 19.3.0-canary-278794d7-20261002 (dist/compiled/react-dom/cjs/react-dom-client.development.js: `FALLBACK_THROTTLE_MS = 300`), as react-dom 19.2.5 has it too.
 */
export const SUSPENSE_RETRY_MS = 300;
/** What enhancementsSettled() waits past SUSPENSE_RETRY_MS, for the timer and the commit's frames. */
export const SUSPENSE_RETRY_MARGIN_MS = 200;
/**
 * The longest Turbopack's runtime waits before it asks again for a chunk that failed: it retries a
 * failed chunk once, 200 to 600 ms later (the runtime in next@16.4.1's swc binary, as the
 * coordinator read it, 7 Nov 2026). A failed optional chunk holds the wait that long past its
 * failure, and the margin, so the retry is seen; the retried chunk then starts the floor again.
 */
export const TURBOPACK_RETRY_MAX_MS = 600;

/** One idle period, or `ms` at most (a second at most) if the page has none, then two frames. */
async function idle(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (timeout) => new Promise<void>((done) => requestIdleCallback(() => done(), { timeout })),
    Math.max(1, Math.min(1_000, ms)),
  );
  await frames(page);
}

/**
 * Waits until the page's enhancements have mounted or failed, as the cell
 * read them once it had run its other checks. A variant's <Enhancement>
 * marks nothing in the page: it loads its module through a script chunk of
 * its own once the page hydrates. An EnhancementIsland marks itself by
 * data-island: markup until it starts, then live, or failed once it tore
 * down to its markup. Every <Enhancement> renders an inert template marked
 * ENHANCEMENT_PENDING (@portfolio/variant-contract/settle) in its place until
 * it has attached, and an enhancement whose first real pass comes later
 * holds its own markup marked so until then; the kit takes both off for one
 * that fails or is turned off. So the page is done when, across one idle period and two
 * frames, no script request was in flight or started, no island's
 * data-island changed, and nothing on the page is still marked pending; and,
 * when a script request or an island's change happened during the wait, or an
 * optional chunk finished just before it, no sooner than SUSPENSE_RETRY_MS and
 * its margin after the last one, since React commits a lazy component's
 * content on a timer 300 ms after the latest fallback shown or hidden on the
 * page, the page idle in between. A page quiet throughout waits as before. An
 * island that never starts, out of view, paused, or lacking what it
 * requires, stays markup, which is settled too. Until `end`: null once
 * they've settled; else what held the wait as it ended (heldAt()), and the
 * caller fails the cell with stillEnhancingText() of it and reads the page
 * as it stands.
 */
async function enhancementsSettled(
  page: Page,
  scripts: ScriptWatch,
  end: number,
): Promise<string | null> {
  const islands = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-enhancement-island]')]
        .map(
          (island) =>
            `${island.getAttribute('data-enhancement-island')}=${island.getAttribute('data-island')}`,
        )
        .join(' '),
    );
  const pending = () =>
    page.evaluate((marker) => document.querySelectorAll(`[${marker}]`).length, ENHANCEMENT_PENDING);
  let before: string | null = null;
  // The page's scripts and islands as the wait began, and when it last saw one of them change:
  // a request in flight now, or else the end of the last optional chunk that finished before
  // the wait began (push 3 r3), since a chunk from cache can land before the wait and commit after.
  // Optional by the HTML as served (push 3 r4), as the live page names every chunk it loaded.
  const islandsAtStart = await islands();
  let seen = `${scripts.started()} ${islandsAtStart}`;
  const served = await scripts.own(end);
  const own = served.paths;
  // The bodies still unread at the end: the wait for them took it all (row 130).
  const unread = served.closed && Date.now() >= end;
  // The latest optional chunk that failed, before the wait or during it: its retry may come up to
  // TURBOPACK_RETRY_MAX_MS later (push 3 r5, item 4).
  const lastFailed = () => {
    const failed = scripts
      .finished()
      .filter(({ url, failed }) => failed && optionalChunk(url, own))
      .map(({ at }) => at);
    return failed.length > 0 ? Math.max(...failed) : null;
  };
  const early = scripts
    .finished()
    .filter(({ url }) => optionalChunk(url, own))
    .map(({ at }) => at);
  let changed: number | null =
    scripts.pending() > 0 ? Date.now() : early.length > 0 ? Math.max(...early) : null;
  // React's retry: no sooner than its delay and a margin after the last change; and a failed
  // chunk's, no sooner than the runtime's longest retry and the margin after it failed. 0: none.
  const floorAt = () => {
    const failedAt = lastFailed();
    return Math.max(
      changed === null ? 0 : changed + SUSPENSE_RETRY_MS + SUSPENSE_RETRY_MARGIN_MS,
      failedAt === null ? 0 : failedAt + TURBOPACK_RETRY_MAX_MS + SUSPENSE_RETRY_MARGIN_MS,
    );
  };
  while (Date.now() < end) {
    if (scripts.pending() > 0) {
      before = null;
      changed = Date.now();
      await page.waitForTimeout(50);
      continue;
    }
    const now = `${scripts.started()} ${await islands()}`;
    if (now !== seen) {
      seen = now;
      changed = Date.now();
    }
    if (now === before && (await pending()) === 0) {
      const floor = floorAt();
      if (Date.now() >= floor) return null;
      await page.waitForTimeout(Math.max(1, Math.min(floor, end) - Date.now()));
      before = null;
      continue;
    }
    before = now;
    await idle(page, end - Date.now());
  }
  return heldAt(scripts, end, {
    islandsAtStart,
    islandsAtEnd: await islands().catch(() => null),
    pending: await pending().catch(() => null),
    floor: floorAt(),
    unread,
  });
}

/**
 * The page's own scripts unread by the end, each document still unread by its path and frame, the
 * first three listed (row 130), as heldAt() names the scripts in flight.
 */
const unreadText = (documents: readonly { readonly path: string; readonly frame: string }[]) =>
  documents.length === 0
    ? 'own scripts unread by the end'
    : `own scripts unread by the end (${documents.length} document${
        documents.length === 1 ? '' : 's'
      }: ${documents
        .slice(0, 3)
        .map(({ path, frame }) => `${path}, ${frame}`)
        .join('; ')}${documents.length > 3 ? `; and ${documents.length - 3} more` : ''})`;

/** `ms` against the wait's end: so many ms before it, or past it. */
const againstEnd = (ms: number) => (ms > 0 ? `${ms} ms past the end` : `${-ms} ms before the end`);

/**
 * What held enhancementsSettled() as it ended (row 109's ruling), each part named: the script
 * requests in flight, each by its path and frame, the first three listed; the last start's age
 * and path; the islands' change across the wait, by name, from its state as the wait began to its
 * state at the end; the count of what's marked pending; and the floor (React's retry delay, or a
 * failed chunk's) against the end; and, when the wait for the page's own scripts took it all,
 * that they were unread by the end, each document still unread by its path and frame (row 130). A read the page refused, closed say, is unread.
 */
function heldAt(
  scripts: ScriptWatch,
  end: number,
  at: {
    readonly islandsAtStart: string;
    readonly islandsAtEnd: string | null;
    readonly pending: number | null;
    readonly floor: number;
    /** Whether the page's own scripts were still unread at the end: own() took the wait. */
    readonly unread?: boolean;
  },
): string {
  const open = scripts.open();
  const flight =
    open.length === 0
      ? 'no script in flight'
      : `${open.length} script${open.length === 1 ? '' : 's'} in flight (${open
          .slice(0, 3)
          .map(({ path, frame }) => `${path}, ${frame}`)
          .join('; ')}${open.length > 3 ? `; and ${open.length - 3} more` : ''})`;
  const last = scripts.last();
  const started =
    last === null ? 'none started' : `the last started ${againstEnd(last.at - end)} (${last.path})`;
  // Each island as islands() reads it, name=state, by its name.
  const states = (text: string) =>
    new Map(
      text
        .split(' ')
        .filter(Boolean)
        .map((each) => {
          const cut = each.lastIndexOf('=');
          return [each.slice(0, cut), each.slice(cut + 1)] as const;
        }),
    );
  let islandText = 'islands unread';
  if (at.islandsAtEnd !== null) {
    const before = states(at.islandsAtStart);
    const after = states(at.islandsAtEnd);
    const changes = [...new Set([...before.keys(), ...after.keys()])]
      .filter((name) => before.get(name) !== after.get(name))
      .map((name) => `${name} ${before.get(name) ?? 'absent'} to ${after.get(name) ?? 'absent'}`);
    islandText =
      changes.length === 0 ? 'islands unchanged' : `islands changed (${changes.join('; ')})`;
  }
  const pendingText = at.pending === null ? 'pending unread' : `${at.pending} marked pending`;
  const floor = at.floor === 0 ? 'no floor' : `the floor ${againstEnd(at.floor - end)}`;
  return [
    flight,
    started,
    islandText,
    pendingText,
    floor,
    ...(at.unread ? [unreadText(scripts.unread())] : []),
  ].join(', ');
}

/** A watch on a page's enhancements, started before its load: `settled()` once it has loaded. */
export interface EnhancementWatch {
  /**
   * The paths of the scripts the page's HTML names, as served, read as it loaded: what failed
   * enhancement lets through (OwnScripts). Closed and empty when a document's body couldn't be
   * read by `end` (BUSY_LIMIT_MS from now unless given).
   */
  readonly own: (end?: number) => Promise<OwnScripts>;
  /**
   * Waits, until `end`, for the enhancements to mount or fail
   * (enhancementsSettled(), a condition's reload's first phase); true at
   * once with script off, where nothing mounts. False when they hadn't
   * settled by then: the caller fails the cell with stillEnhancingText(held()).
   */
  readonly settled: (end?: number) => Promise<boolean>;
  /** What held the last settled() that returned false (heldAt()); else null. */
  readonly held: () => string | null;
  readonly stop: () => void;
}

/**
 * Watches `page`'s script requests from now, for a read that loads the page
 * itself and must see it live: a row's main pass, whose axe would otherwise
 * read the server markup an enhancement is about to hide or replace.
 */
export function watchEnhancements(page: Page): EnhancementWatch {
  const scripts = watchScripts(page);
  let held: string | null = null;
  return {
    own: (end = Date.now() + BUSY_LIMIT_MS) => scripts.own(end),
    settled: async (end = Date.now() + BUSY_LIMIT_MS) => {
      held = null;
      if (await page.evaluate(() => matchMedia('(scripting: none)').matches)) return true;
      held = await enhancementsSettled(page, scripts, end);
      return held === null;
    },
    held: () => held,
    stop: () => scripts.stop(),
  };
}

/** What a condition's read compares the page with: the baseline, but for the fields it may take away. */
interface Expected {
  readonly baseline: readonly string[];
  readonly ignore?: RegExp;
  /** Whether a key hint may be gone, so the wait doesn't wait for one (KEY_HINT). */
  readonly keyHint?: KeyHintRule;
}

/** The fields of `before` that `now` lacks, but for those `ignore` lets go. */
const lacking = (before: readonly string[], now: readonly string[], ignore?: RegExp) => {
  const present = new Set(now);
  return before.filter((item) => !present.has(item) && !ignore?.test(item));
};

/**
 * Waits, until `end`, for the page to show every field `expected` names: a
 * chunk that has landed isn't yet a mounted enhancement, since React may
 * wait to reveal what it loaded (a Suspense boundary's throttle runs on a
 * timer, so the page idles meanwhile). A field that never comes is the
 * read's own finding, so it adds none.
 */
async function baselineShown(page: Page, expected: Expected, end: number): Promise<void> {
  const wanted = expected.keyHint
    ? expected.baseline.filter((item) => !KEY_HINT.test(item))
    : expected.baseline;
  while (
    lacking(wanted, await inPage<string[]>(page, { kind: 'inventory' }), expected.ignore).length >
      0 &&
    Date.now() < end
  ) {
    await page.waitForTimeout(100);
  }
}

/** How a load went: whether it settled, and whether its enhancements mounted or failed in time. */
interface Loaded {
  readonly settled: boolean;
  readonly enhanced: boolean;
  /** What held the enhancements' wait when they hadn't (heldAt()), else null. */
  readonly held: string | null;
}

/**
 * Loads `path`, and answers whether it settled. With `expected` it waits for
 * the enhancements too, as a condition's read does, BUSY_LIMIT_MS in all:
 * their chunks and islands (enhancementsSettled()), then what the baseline
 * shows (baselineShown()). With `enhancements` and no `expected`, as each
 * reflow condition reads, it waits for the first alone: what the page's
 * enhancements put on it is there to reflow, and there's no baseline to
 * compare it with. With script off nothing mounts, so neither waits. Then it
 * awaits document.fonts.ready, as the main pass does, since the reflow probe
 * measures text boxes, and only then sets `rootText` (a scale of the root
 * font, as the root-text condition has it) and draws its frames: so what the
 * enhancements mounted, they mounted at the page's own root text.
 */
export async function load(
  page: Page,
  path: string,
  expected?: Expected,
  {
    enhancements = expected !== undefined,
    rootText = 1,
  }: { readonly enhancements?: boolean; readonly rootText?: number } = {},
): Promise<Loaded> {
  const scripts = enhancements ? watchScripts(page) : null;
  try {
    await page.goto(path, { waitUntil: 'load' });
    const settled = await notBusy(page);
    let held: string | null = null;
    if (scripts && !(await page.evaluate(() => matchMedia('(scripting: none)').matches))) {
      const end = Date.now() + BUSY_LIMIT_MS;
      held = await enhancementsSettled(page, scripts, end);
      if (held === null && expected) await baselineShown(page, expected, end);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    if (rootText !== 1) {
      await page.evaluate(
        (scale) =>
          document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
        rootText,
      );
    }
    await frames(page);
    return { settled, enhanced: held === null, held };
  } finally {
    scripts?.stop();
  }
}

/** A finding for a page a condition reloaded whose enhancements never finished, and its hold. */
const stillEnhancing = (condition: string, held: string | null): Finding => ({
  gate: 'runner',
  rule: 'enhanced',
  expected: `the page's enhancements mount or fail under ${condition}`,
  actual: stillEnhancingText(held),
});

/** Reloads `path` for `condition`'s read, its enhancements in, and what it owes if it didn't settle. */
async function reload(
  page: Page,
  path: string,
  condition: string,
  expected: Expected,
): Promise<Finding[]> {
  const { settled, enhanced, held } = await load(page, path, expected);
  return [
    ...(settled ? [] : [stillBusy(condition)]),
    ...(enhanced ? [] : [stillEnhancing(condition, held)]),
  ];
}

/**
 * What `before` has and `now` lacks, as findings under `condition`. With `keyHint`, a key hint
 * that's gone is let go while its control is as the rule needs it, on the page as it stands, and
 * is a finding of its own, naming the control and how it is, while it isn't (KEY_HINT).
 */
async function missingItems(
  page: Page,
  rule: string,
  gate: string,
  condition: string,
  before: readonly string[],
  now: readonly string[],
  ignore?: RegExp,
  keyHint?: KeyHintRule,
): Promise<Finding[]> {
  const gone: string[] = [];
  const hints: Finding[] = [];
  for (const item of lacking(before, now, ignore)) {
    const id = keyHint ? KEY_HINT.exec(item)?.[1] : undefined;
    if (id === undefined) {
      gone.push(item);
      continue;
    }
    const control = await inPage<string>(page, {
      kind: 'key-hint-control',
      id,
      usable: keyHint === 'usable',
    });
    if (control !== 'there')
      hints.push({
        gate,
        rule,
        expected: `present under ${condition}, or gone while the control it names is ${keyHint === 'usable' ? 'shown and enabled' : 'in the page'}`,
        actual: `a key hint gone, its control #${id} ${control === 'missing' ? 'not in the page' : control === 'not a control' ? 'no control' : control} under ${condition}, here ${item}`,
      });
  }
  return [
    ...gone.slice(0, 10).map((item) => ({
      gate,
      rule,
      expected: `present under ${condition}`,
      actual: `${gone.length} field(s) missing, here ${item}`,
    })),
    ...hints.slice(0, 10),
  ];
}

/** The inventory under each condition, against `baseline`, the page's own. Leaves the page as the cell loaded it. */
export async function inventoryFindings(
  page: Page,
  path: string,
  baseline: readonly string[],
  only?: readonly string[],
  scriptRequired = false,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const cdp = await page.context().newCDPSession(page);
  // Whether the page in hand is the one no JavaScript's reload left, which never hydrated.
  let scriptless = false;
  try {
    for (const condition of conditions().filter((each) => !only || only.includes(each.id))) {
      // A condition read on the page as it stands, print, reads the live page, as the print row
      // does (row 92, the coordinator, 7 Nov 2026): after no JavaScript's reload, the live page
      // loads again first, its enhancements in, and what that load owes is print's. A page that
      // needs its script reads print over its no-JavaScript page on purpose, below.
      if (!condition.reload && scriptless && !scriptRequired) {
        const live = { baseline, ignore: condition.ignore, keyHint: condition.keyHint };
        findings.push(...(await reload(page, path, condition.id, live)));
        scriptless = false;
      }
      await condition.setup(page, cdp);
      try {
        // A key hint a page shows only to a fine pointer (row 92) is gone where the page reads
        // none. On CI's Linux Chromium the touch condition's teardown leaves (pointer) at none for
        // the rest of the page's life (row 44), so each later condition takes such a hint as no
        // JavaScript does: let go while the control it names is shown and enabled, a finding
        // naming the control while it isn't (Spatial Bento's Esc hint, preflight 1). With a fine
        // pointer, and for a condition with a rule of its own, nothing changes.
        // The rule (the coordinator, 8 Nov 2026): absence is accepted only for a key-hint field
        // (KEY_HINT), keyed to the control it names, with that control shown and enabled, and only
        // while (pointer: fine) reads false. missingItems applies a keyHint rule to KEY_HINT items
        // alone, so every other field a coarse pointer drops is still a missing field: never a
        // general coarse-pointer tolerance.
        const keyHint =
          condition.keyHint ??
          ((await page.evaluate(() => matchMedia('(pointer: fine)').matches))
            ? undefined
            : 'usable');
        if (condition.reload) {
          const expected = { baseline, ignore: condition.ignore, keyHint };
          findings.push(...(await reload(page, path, condition.id, expected)));
        }
        // A condition read on the page as it stands, such as print, reads it from the top, where
        // the baseline was read: text a script keeps in step with the scroll, such as a running
        // head that names the section in view, then says what it said then.
        if (!condition.reload) {
          await page.evaluate(() => scrollTo({ left: 0, top: 0, behavior: 'instant' }));
          await frames(page, 50);
        }
        const problem = await condition.verify(page);
        if (problem) {
          // Slice 1's fail-closed rule: a condition that didn't take proves nothing.
          findings.push({
            gate: 'runner',
            rule: 'media-emulation',
            expected: `the ${condition.id} condition takes`,
            actual: `${condition.id}: ${problem}: the emulation was ignored`,
          });
          continue;
        }
        // Without JavaScript, and in print over that page, a page that needs it says so instead.
        // Its notice stands in for its content, but script-only words the server sent are still
        // a finding (the coordinator, 7 Nov 2026, F6), as print lets them go there too.
        if (scriptRequired && condition.id === 'no-javascript') {
          findings.push(...(await scriptRequiredFindings(page, cdp, condition.id)));
          findings.push(...(await scriptOnlyTextFindings(page, baseline)));
          continue;
        }
        if (scriptRequired && condition.id === 'print') {
          // The no-JavaScript page in print: script back on would hide its <noscript>, so it
          // loads again with script off, as the condition before left it, and reads in print.
          await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
          try {
            // Script off: nothing mounts, so nothing is waited for.
            findings.push(...(await reload(page, path, condition.id, { baseline: [] })));
            findings.push(...(await scriptRequiredFindings(page, cdp, condition.id)));
          } finally {
            await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
          }
          continue;
        }
        findings.push(
          ...(await missingItems(
            page,
            'content',
            'inventory',
            condition.id,
            baseline,
            await inPage<string[]>(page, { kind: 'inventory' }),
            condition.ignore,
            keyHint,
          )),
        );
        if (condition.id === 'no-javascript')
          findings.push(...(await scriptOnlyTextFindings(page, baseline)));
      } finally {
        await condition.teardown(page, cdp);
        if (condition.reload) scriptless = condition.id === 'no-javascript';
      }
    }
  } finally {
    await cdp.detach();
  }
  if (!(await load(page, path)).settled)
    findings.push(stillBusy('the reload after the conditions'));
  return findings;
}

/**
 * An inventory field's own words (harness push 2's follow-up, INV-N1): a link's and a control's
 * name, not its target or its kind; a skip link's name past its target; a key hint's past the
 * control it names (row 92); any other field's text.
 */
export function ownWords(item: string): string {
  const kind = item.slice(0, item.indexOf(':'));
  const rest = item.slice(item.indexOf(':') + 1).trimStart();
  if (kind === 'link' || kind === 'key-hint') return rest.slice(rest.indexOf(' ') + 1);
  if (kind === 'control') {
    const [what, ...more] = rest.split(' ');
    return what === 'skip-link' ? more.slice(1).join(' ') : more.join(' ');
  }
  return rest;
}

/**
 * Script-only words the page shows without JavaScript: the mark lets go words only live script
 * sets, so neither may the server render them. Read on the page as it stands without
 * JavaScript, two things are each a finding, one per element, by path:
 * - an element marked data-script-only that holds words, the server's own, whatever it is: a
 *   live status, a key hint (row 92), or anything else the mark is on;
 * - any field the inventory shows, of any kind, whose words are a `script-only:` field of
 *   `baseline`, the page with its script. The mark and the liveness are read on the live page
 *   there, so this holds words a script makes live, marks, or moves into a marked status to
 *   what the server sent.
 */
export async function scriptOnlyTextFindings(
  page: Page,
  baseline: readonly string[],
): Promise<Finding[]> {
  const SCRIPT_ONLY = 'script-only: ';
  const words = new Set(
    baseline
      .filter((item) => item.startsWith(SCRIPT_ONLY))
      .map((item) => item.slice(SCRIPT_ONLY.length)),
  );
  const shown = new Map<string, string>();
  for (const { path, text } of await inPage<{ path: string; text: string }[]>(page, {
    kind: 'script-only-text',
  })) {
    if (!shown.has(path)) shown.set(path, text);
  }
  if (words.size > 0) {
    for (const { item, path } of await inPage<{ item: string; path: string }[]>(page, {
      kind: 'inventory',
      paths: true,
    })) {
      const value = ownWords(item);
      if (words.has(value) && !shown.has(path)) shown.set(path, value);
    }
  }
  const hits = [...shown];
  return hits.slice(0, 10).map(([path, text]) => ({
    gate: 'inventory',
    rule: 'script-only-text',
    path,
    expected:
      'words only live script sets are not on the page without JavaScript: an element marked data-script-only is empty, and no field shows its words',
    actual: `${hits.length} element(s) with script-only words without JavaScript, here "${text.slice(0, 80)}"`,
  }));
}

/**
 * A page that needs the script it couldn't load, as it stands under failed
 * enhancement: an alert, shown and with words, that it couldn't load, a
 * control in it to try again that takes focus, nothing still aria-busy, and
 * axe. Its landmarks, fragments, and skip link are enhancementFindings' own.
 */
export async function failureStateFindings(
  page: Page,
  { axe = true }: { readonly axe?: boolean } = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fail = (expected: string, actual: string) =>
    findings.push({ gate: 'enhancement', rule: 'failure-state', expected, actual });
  // No named helper inside: esbuild's keepNames would wrap it in a __name the page lacks.
  const state = await page.evaluate(
    ([again, specimen]) => {
      const alert = [...document.querySelectorAll('[role="alert"]')].find(
        (element) =>
          element.getClientRects().length > 0 && (element as HTMLElement).innerText.trim() !== '',
      );
      const control = alert?.querySelector<HTMLElement>('button, a[href], input, select') ?? null;
      control?.focus();
      const name = control
        ? (control.getAttribute('aria-label') ?? control.innerText ?? '').trim()
        : '';
      return {
        alert: Boolean(alert),
        control: Boolean(control),
        named: new RegExp(again, 'i').test(name),
        reachable: control !== null && control.tabIndex >= 0,
        focused: control !== null && document.activeElement === control,
        busy: [...document.querySelectorAll('[aria-busy="true"]')].filter(
          (element) => element.getClientRects().length > 0 && !element.closest(specimen),
        ).length,
      };
    },
    [TRY_AGAIN.source, BUSY_SPECIMEN] as const,
  );
  if (!state.alert) {
    fail("an alert that it couldn't load, under failed enhancement", 'no alert says so');
  } else if (!state.control) {
    fail('a control in the alert to try again, which takes focus', 'the alert has no control');
  } else if (!state.reachable) {
    fail(
      'a control in the alert to try again, which takes focus',
      'its control is out of the tab order',
    );
  } else if (!state.focused) {
    fail(
      'a control in the alert to try again, which takes focus',
      "its control doesn't take focus",
    );
  } else if (!state.named) {
    fail(
      'a control in the alert to try again, which takes focus',
      'its control is named for something other than trying again',
    );
  }
  if (state.busy > 0) {
    fail('nothing still says it is loading', `${state.busy} element(s) are still aria-busy`);
  }
  if (axe) {
    for (const rule of (await axeFor(page).analyze()).violations) {
      findings.push({
        gate: 'axe',
        rule: rule.id,
        expected: `no ${rule.id} violation, under failed enhancement`,
        actual: `${rule.nodes.length} element(s): ${rule.help}`,
      });
    }
  }
  return findings;
}

/** What names a failure state's control: it tries again, as Studio's Reload Studio does. */
const TRY_AGAIN = /reload|try again|retry/;

/** Where a page that needs JavaScript says so, as Studio's <noscript> notice does. */
export const NO_JAVASCRIPT_NOTICE = '#content';

/** What its notice says it needs. */
const NEEDS_JAVASCRIPT = /JavaScript/i;

/**
 * Each <noscript>'s content, which the parser made elements with script off,
 * moved into a stand-in <div>. Script back on, as axe needs it, hides a
 * noscript's content from rendering, and so from axe; in a div it stays as a
 * reader without JavaScript has it. Run while script is still off.
 */
export async function revealNoscript(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const noscript of [...document.querySelectorAll('noscript')]) {
      const stand = document.createElement('div');
      stand.setAttribute('data-quality-noscript', '');
      stand.append(...noscript.childNodes);
      noscript.replaceWith(stand);
    }
  });
}

/**
 * A page that needs JavaScript, as it stands without it (`under` names the
 * condition): its notice in NO_JAVASCRIPT_NOTICE, shown and with words, one
 * main, an h1, a skip link whose target is there, and axe, which runs with
 * script on for its pass alone. `cdp` is the page's session, which turns
 * script off again after.
 */
export async function scriptRequiredFindings(
  page: Page,
  cdp: CDPSession | null,
  under: string,
  { axe = true }: { readonly axe?: boolean } = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fail = (rule: string, expected: string, actual: string) =>
    findings.push({ gate: 'enhancement', rule, expected: `${expected}, ${under}`, actual });
  // innerText of a shown element is its shown text alone; of a hidden one, all of it.
  const notice = await page.evaluate((at) => {
    const target = document.querySelector(at);
    if (!target) return null;
    return {
      shown: target.getClientRects().length > 0,
      text: (target as HTMLElement).innerText.trim(),
    };
  }, NO_JAVASCRIPT_NOTICE);
  const expected = `a notice in ${NO_JAVASCRIPT_NOTICE}, shown, that it needs JavaScript`;
  if (!notice) {
    fail('notice', expected, `no ${NO_JAVASCRIPT_NOTICE}`);
  } else if (!notice.shown) {
    fail('notice', expected, `${NO_JAVASCRIPT_NOTICE} isn't shown`);
  } else if (notice.text === '') {
    fail('notice', expected, `${NO_JAVASCRIPT_NOTICE} says nothing`);
  } else if (!NEEDS_JAVASCRIPT.test(notice.text)) {
    fail('notice', expected, `${NO_JAVASCRIPT_NOTICE} doesn't say it needs JavaScript`);
  }
  const structure = await inPage<Structure>(page, { kind: 'structure' });
  if (structure.mains !== 1) fail('semantics', 'one main landmark', `${structure.mains}`);
  if (structure.h1s === 0) fail('semantics', 'an h1', 'none');
  if (structure.skip && !structure.skipTarget) {
    fail('navigation', 'the skip link names its target', `${structure.skip} names no element`);
  }
  if (axe) {
    await revealNoscript(page);
    await cdp?.send('Emulation.setScriptExecutionDisabled', { value: false });
    try {
      const results = await axeFor(page).analyze();
      for (const rule of results.violations) {
        findings.push({
          gate: 'axe',
          rule: rule.id,
          expected: `no ${rule.id} violation, ${under}`,
          actual: `${rule.nodes.length} element(s): ${rule.help}`,
        });
      }
    } finally {
      await cdp?.send('Emulation.setScriptExecutionDisabled', { value: true });
    }
  }
  return findings;
}

interface Structure {
  readonly mains: number;
  readonly h1s: number;
  readonly skip: string | null;
  readonly skipTarget: string | null;
  readonly fragments: readonly { path: string; href: string; found: boolean }[];
}

/** What failed enhancement records for a page whose own scripts couldn't be told from its lazy ones. */
export const OWN_SCRIPTS_UNKNOWN =
  "the page's own scripts couldn't be told from its lazy ones: its HTML, as served, wasn't read";

/**
 * The page with its optional enhancement taken away. `own` are the paths of the scripts its HTML
 * names, as served, as its main pass read them (loadForPass()): every other chunk is blocked. When
 * they couldn't be told (`own.closed`), it reads nothing, since every chunk would be blocked, and
 * records a runner finding instead (push 3 r5, item 4).
 */
export async function enhancementFindings(
  page: Page,
  path: string,
  baseline: readonly string[],
  served: OwnScripts,
  scriptRequired = false,
): Promise<Finding[]> {
  if (served.closed) {
    return [
      {
        gate: 'runner',
        rule: 'own-scripts',
        expected: "the page's own scripts told from its lazy ones, by its HTML as served",
        actual: OWN_SCRIPTS_UNKNOWN,
      },
    ];
  }
  const own = served.paths;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: NO_CANVAS,
  });
  await page.route('**/*', (route) => {
    const request = route.request();
    const optional = request.resourceType() === 'script' && optionalChunk(request.url(), own);
    return optional || request.resourceType() === 'font'
      ? route.abort('blockedbyclient')
      : route.fallback();
  });
  const findings: Finding[] = [];
  try {
    // A button that submits nothing is an enhancement, which may wait for its script. A page
    // that needs its script shows its failure state in place of its content, so it's read as
    // soon as its chunks have failed.
    const expected = {
      baseline: scriptRequired ? [] : baseline,
      ignore: NO_SCRIPT_IGNORE,
      keyHint: 'usable' as const,
    };
    findings.push(...(await reload(page, path, 'failed enhancement', expected)));
    const structure = await inPage<Structure>(page, { kind: 'structure' });
    const missing = async () =>
      missingItems(
        page,
        'semantics',
        'enhancement',
        'failed enhancement',
        baseline,
        await inPage<string[]>(page, { kind: 'inventory' }),
        NO_SCRIPT_IGNORE,
        'usable',
      );
    // A page that needs the script it lost works without it, or shows its failure state in
    // place of the content it couldn't load. It's read as it loaded, before the skip link is
    // followed, which may change it: Studio's first fragment link opens its Content task.
    let read: Finding[] | null = null;
    if (scriptRequired) {
      const lost = await missing();
      read = lost.length > 0 ? await failureStateFindings(page) : [];
    }
    const semantics = (actual: string) =>
      findings.push({
        gate: 'enhancement',
        rule: 'semantics',
        expected: 'one main and an h1, without the enhancements',
        actual,
      });
    if (structure.mains !== 1) semantics(`${structure.mains} main landmarks`);
    if (structure.h1s === 0) semantics('no h1');
    const navigation = (actual: string, at?: string) =>
      findings.push({
        gate: 'enhancement',
        rule: 'navigation',
        path: at,
        expected: 'links and the skip link work without the enhancements',
        actual,
      });
    for (const fragment of structure.fragments.filter((each) => !each.found)) {
      navigation(`${fragment.href} names no element`, fragment.path);
    }
    if (structure.skip && structure.skipTarget) {
      await page.keyboard.press('Tab');
      await page.evaluate(
        (at) => (document.querySelector(at) as HTMLElement | null)?.focus(),
        structure.skip,
      );
      await page.keyboard.press('Enter');
      await frames(page);
      const landed = await page.evaluate(
        (target) => Boolean(document.querySelector(target)?.contains(document.activeElement)),
        structure.skipTarget,
      );
      if (!landed)
        navigation(`the skip link leaves focus outside ${structure.skipTarget}`, structure.skip);
    }
    findings.push(...(read ?? (await missing())));
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await cdp.detach();
  }
  if (!(await load(page, path)).settled) {
    findings.push(stillBusy('the reload after failed enhancement'));
  }
  return findings;
}

/** The reflow conditions from quality/thresholds.json: 320 px, 200% zoom, and 200% root text. */
export function reflowConditions() {
  const { reflow, zoom, rootText } = thresholds.viewports;
  return [
    ...reflow.map((id) => ({ rule: 'reflow', id, scale: 1, text: 1 })),
    ...zoom.map(({ viewport, deviceScaleFactor }) => ({
      rule: 'zoom',
      id: viewport,
      scale: deviceScaleFactor,
      text: 1,
    })),
    ...rootText.map(({ viewport, scale }) => ({
      rule: 'root-text',
      id: viewport,
      scale: 1,
      text: scale,
    })),
  ];
}

/** The reflow check under each condition. It puts the viewport back and reloads. */
export async function reflowFindings(
  page: Page,
  path: string,
  disclosures: readonly string[] = [],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const original = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const condition of reflowConditions()) {
      const { width, height } = viewportSize(condition.id);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: condition.scale,
        mobile: false,
      });
      // Read once the page's enhancements have mounted or failed (push 3): a lazy one, such as
      // Spatial Bento's live stage, would otherwise mount after the probe, or after the root-text
      // switch, and go unread. One that never does is STILL_ENHANCING, read as it stands.
      // The root text is set inside load(), once the wait and the fonts are done.
      const loaded = await load(page, path, undefined, {
        enhancements: true,
        rootText: condition.text,
      });
      // Each at its condition's viewport, so it's its own record and says where (F4).
      if (!loaded.settled) findings.push({ ...stillBusy(condition.rule), viewport: condition.id });
      if (!loaded.enhanced) {
        findings.push({ ...stillEnhancing(condition.rule, loaded.held), viewport: condition.id });
      }
      const probe = async (state: string) => {
        for (const problem of await inPage<{ rule: string; path: string; detail: string }[]>(page, {
          kind: 'reflow',
        })) {
          findings.push({
            gate: 'reflow',
            rule: condition.rule,
            path: problem.path,
            expected: 'no sideways scroll, and nothing clipped or out of view',
            actual: `${problem.detail}${state}`,
            viewport: condition.id,
          });
        }
      };
      await probe('');
      // Each registered disclosure toggled, and back: what it shows reflows too.
      for (const name of disclosures) {
        const control = await inPage<{ path: string } | null>(page, { kind: 'named', name });
        if (!control) continue;
        await page.click(control.path);
        await frames(page);
        await probe(`, with ${name} toggled`);
        await page.click(control.path);
        await frames(page);
      }
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
    await page.setViewportSize(original);
  }
  if (!(await load(page, path)).settled) findings.push(stillBusy('the reload after reflow'));
  return findings;
}

/** The two fills put under a surface: a pixel inside it that changes between them, their way, is see-through. */
const UNDER = ['rgb(255, 0, 255)', 'rgb(0, 255, 0)'];

/** The fills' own direction, channel by channel: the sign of the first fill's red, green and blue less the second's. */
const UNDER_WAY = (() => {
  const [first, second] = UNDER.map((fill) => parseCssColor(fill)!.rgb);
  return [0, 1, 2].map((channel) => Math.sign(first![channel]! - second![channel]!));
})();

/**
 * How many of a clip's pixels must move the fills' way for its surface to show through: 16, or
 * every pixel of a clip smaller than that (row 119, the coordinator's bar). A surface short of solid
 * blends the fills in across all of its fill, and the clip already leaves out its corner radius and
 * border, so what is see-through moves a run of pixels at least: a 1 px hairline 16 px long, or a
 * 4x4 hole, still counts. What moves fewer is the raster, not the fill. At an antialiased edge a
 * stroke's partly covered pixel is composited once per shot, and can come out a level apart between
 * the two fills even inside an opaque surface: Kinetic Cosmos's index at 1024x768, missing-media /
 * dark, moved one pixel of its orrery's SVG at (480, 327) by +1, -1, +1, the fills' own signs, in
 * both passes of the row 119 probe, its dialog opaque. A count, not a share of the clip: a share
 * large enough to pass that pixel in a small control would miss a small translucent badge in a big
 * dialog.
 */
export const SEE_THROUGH_PIXELS = 16;

/**
 * Whether `a`, the surface's clip under the first fill, and `b`, under the second, show what's
 * under the surface: at least SEE_THROUGH_PIXELS of their pixels, or all of a smaller clip's, moved
 * the fills' own way between them (UNDER_WAY) in every channel, strictly, as a surface any short of
 * solid blends them in, down to 254 of 255 opaque, a level or two. A pixel that moves against them
 * in any channel isn't the fill: an antialiased edge rastered a few levels apart from one shot to
 * the next (Kinetic Cosmos's offer card, every channel down, see-through round 3). Clips of two
 * sizes can't be compared, and fail closed.
 */
export function showsThrough(a: Image, b: Image): boolean {
  if (a.width !== b.width || a.height !== b.height) return true;
  const need = Math.min(SEE_THROUGH_PIXELS, a.width * a.height);
  let moved = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    let way = true;
    for (let channel = 0; channel < 3 && way; channel++)
      way = Math.sign(a.data[i * 4 + channel]! - b.data[i * 4 + channel]!) === UNDER_WAY[channel];
    if (way && ++moved >= need) return true;
  }
  return false;
}

/**
 * The see-through verdict on a surface's two shots: off settled frames, showsThrough()'s; off a
 * surface that never held still, any pixel that differs at all, so it fails closed, as before.
 */
export function seenThrough(a: Image, b: Image, settled: boolean): boolean {
  return settled
    ? showsThrough(a, b)
    : a.width !== b.width ||
        a.height !== b.height ||
        a.data.some((value, i) => value !== b.data[i]);
}

/** How long a fill's shot may wait for the surface to hold still: a ring still settling, say. */
const SETTLE_MS = 5_000;

/**
 * The surface's clip once the page holds still under a fill: every finite animation done (a
 * transition the fill's restyle started among them), two frames on, then shots two frames apart
 * until two in a row are the same with nothing in the surface changed between them, within
 * SETTLE_MS (then the last, and `settled` false). "Nothing changed" is a DOM mutation (an attribute,
 * a child, a text) in the surface's own subtree or on an element whose box meets the clip, its
 * ancestors among them: two equal shots alone can be two frames of a change that repeats (a script
 * stepping a ring's colour every frame on a five-frame cycle matched itself under load), while a
 * change beside the clip, such as a star field's, can't touch these pixels and never holds it up.
 * It reads the surface's own clip, for the same reason. Both fills are read off a settled frame, so
 * what moves on its own, such as a focused control's ring still settling (KC's offer dialog under
 * reduced transparency), never passes for the fill showing through. Nothing is blurred or hidden:
 * the state under test stays as it is, but for the caret, which every shot hides anyway. One sheet
 * of its own hides it, put in before the mutations are counted and taken out once they no longer
 * are, and the shots leave the caret be: Playwright's own hiding writes a style on every input at
 * each shot and clears it after, which the count would read as the surface moving, so a surface
 * with a field in it never held still (the primitives page's decision dialog, 290 such writes in
 * 291 shots, and Kinetic Cosmos's index, each waiting out both fills' settle time; see-through
 * round 3b). The sheet reaches no shadow root.
 */
async function settledShot(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  path: string,
): Promise<{ shot: Buffer; settled: boolean }> {
  await page.evaluate(() => {
    const sheet = document.createElement('style');
    sheet.dataset.qualityCaret = '';
    sheet.textContent = '* { caret-color: transparent !important; }';
    document.head.append(sheet);
  });
  try {
    return await stillShot(page, clip, path);
  } finally {
    // stillShot()'s count has stopped (its own finally), so taking the sheet out isn't counted.
    await page.evaluate(() => document.querySelector('style[data-quality-caret]')?.remove());
  }
}

/** settledShot()'s wait and shots, with the caret already hidden by a sheet of its own. */
async function stillShot(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  path: string,
): Promise<{ shot: Buffer; settled: boolean }> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) =>
        Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
      );
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((done) => setTimeout(done, 2_000)),
    ]);
  });
  // Count the mutations that can change the clip's pixels: in the surface, or on a box over the clip.
  await page.evaluate(
    ({ at, area }) => {
      const scope = window as unknown as {
        __qualityStill?: MutationObserver;
        __qualityMoved: number;
      };
      scope.__qualityStill?.disconnect();
      scope.__qualityMoved = 0;
      const surface = document.querySelector(at);
      const counts = (node: Node): boolean => {
        const el = node instanceof Element ? node : node.parentElement;
        if (!el) return false;
        if (surface?.contains(el)) return true;
        const r = el.getBoundingClientRect();
        return (
          r.right > area.x &&
          r.left < area.x + area.width &&
          r.bottom > area.y &&
          r.top < area.y + area.height
        );
      };
      scope.__qualityStill = new MutationObserver((list) => {
        for (const mutation of list) if (counts(mutation.target)) scope.__qualityMoved += 1;
      });
      scope.__qualityStill.observe(document, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    },
    { at: path, area: clip },
  );
  const moved = () =>
    page.evaluate(() => {
      const scope = window as unknown as { __qualityMoved: number };
      const count = scope.__qualityMoved;
      scope.__qualityMoved = 0;
      return count;
    });
  // caret: 'initial': settledShot()'s sheet hides it, and nothing is written on the inputs.
  const shoot = () => page.screenshot({ clip, animations: 'disabled', caret: 'initial' });
  try {
    await frames(page);
    const until = Date.now() + SETTLE_MS;
    await moved();
    let shot = await shoot();
    while (Date.now() < until) {
      await frames(page);
      const next = await shoot();
      const changed = await moved();
      if (changed === 0 && next.equals(shot)) return { shot: next, settled: true };
      shot = next;
    }
    return { shot, settled: false };
  } finally {
    await page.evaluate(() => {
      const scope = window as unknown as { __qualityStill?: MutationObserver };
      scope.__qualityStill?.disconnect();
      delete scope.__qualityStill;
    });
  }
}

/**
 * Whether anything shows through the element `path` names: every ancestor
 * is filled with one color, then another, with everything beside them and
 * their own pseudo-elements faded out, and a pixel inside the element's
 * corner radius and border that changes is what's behind coming through.
 */
async function seeThrough(
  page: Page,
  path: string,
  inset: number,
): Promise<{ through: boolean; settled: boolean }> {
  await page
    .locator(path)
    .first()
    .scrollIntoViewIfNeeded({ timeout: 2_000 })
    .catch(() => undefined);
  const box = await inPage<{ x: number; y: number; width: number; height: number } | null>(page, {
    kind: 'box',
    path,
  });
  const viewport = page.viewportSize()!;
  if (!box) return { through: false, settled: true };
  const x = Math.max(0, Math.ceil(box.x + inset));
  const y = Math.max(0, Math.ceil(box.y + inset));
  const width = Math.min(viewport.width, Math.floor(box.x + box.width - inset)) - x;
  const height = Math.min(viewport.height, Math.floor(box.y + box.height - inset)) - y;
  if (width < 2 || height < 2) return { through: false, settled: true };
  const shots: Uint8Array[] = [];
  let settled = true;
  for (const fill of UNDER) {
    await page.evaluate(
      ({ at, color }) => {
        // Every ancestor takes the fill, and everything beside the line from
        // the root down to the surface goes, so a sibling's image under the
        // surface can't pass for an opaque fill.
        const el = document.querySelector(at);
        for (let up = el?.parentElement, child: Element | null | undefined = el; up;) {
          up.setAttribute('data-quality-under', '');
          for (const other of up.children)
            if (other !== child && other.localName !== 'style' && other.localName !== 'link')
              other.setAttribute('data-quality-aside', '');
          child = up;
          up = up.parentElement;
        }
        let style = document.querySelector<HTMLStyleElement>('style[data-quality-under]');
        if (!style) {
          style = document.createElement('style');
          style.dataset.qualityUnder = '';
          document.head.append(style);
        }
        style.textContent = `[data-quality-under] { background: ${color} !important; } [data-quality-under]::before, [data-quality-under]::after, [data-quality-aside] { opacity: 0 !important; }`;
      },
      { at: path, color: fill },
    );
    const read = await settledShot(page, { x, y, width, height }, path);
    shots.push(read.shot);
    settled &&= read.settled;
  }
  await page.evaluate(() => {
    document.querySelector('style[data-quality-under]')?.remove();
    for (const el of document.querySelectorAll('[data-quality-under], [data-quality-aside]')) {
      el.removeAttribute('data-quality-under');
      el.removeAttribute('data-quality-aside');
    }
  });
  const [a, b] = shots.map(decodePng);
  return { through: seenThrough(a!, b!, settled), settled };
}

interface Transparency {
  readonly filters: readonly { path: string; detail: string }[];
  readonly surfaces: readonly { path: string; inset: number }[];
}

/** The page's filters and see-through surfaces, as they stand, each path once. */
async function transparencyNow(page: Page, seen: Set<string>): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { filters, surfaces } = await inPage<Transparency>(page, { kind: 'transparency' });
  const expected = 'no backdrop-filter, and Surface, Dialog, and Navigation opaque';
  for (const filter of filters.filter((each) => !seen.has(each.path))) {
    seen.add(filter.path);
    findings.push({
      gate: 'transparency',
      rule: 'backdrop-filter',
      path: filter.path,
      expected,
      actual: filter.detail,
    });
  }
  for (const surface of surfaces.filter((each) => !seen.has(each.path))) {
    seen.add(surface.path);
    const { through, settled } = await seeThrough(page, surface.path, surface.inset);
    // A surface that never held still is read off its last pair of shots, as before settling
    // was asked for: the log says so either way, and so does a finding, so a flaky verdict on it
    // is traceable.
    const unsettled = `the surface never held still in ${SETTLE_MS / 1000} s`;
    if (!settled) console.log(`[quality] transparency: ${surface.path}: ${unsettled}`);
    if (through) {
      findings.push({
        gate: 'transparency',
        rule: 'opaque',
        path: surface.path,
        expected,
        actual: `what is under it shows through${settled ? '' : ` (${unsettled})`}`,
      });
    }
  }
  return findings;
}

/**
 * The reduced-transparency check: on the page as it stands, then with each
 * control that opens something opened from the keyboard, a dialog's
 * ::backdrop included, and closed again.
 */
export async function transparencyFindings(page: Page): Promise<Finding[]> {
  const seen = new Set<string>();
  const findings = await transparencyNow(page, seen);
  for (const trigger of await inPage<{ path: string }[]>(page, { kind: 'triggers' })) {
    await page.evaluate(
      (at) => (document.querySelector(at) as HTMLElement | null)?.focus(),
      trigger.path,
    );
    await page.keyboard.press('Enter');
    await frames(page, 150);
    if ((await inPage<{ path: string }[]>(page, { kind: 'overlays' })).length > 0) {
      findings.push(...(await transparencyNow(page, seen)));
      await page.keyboard.press('Escape');
      await frames(page, 100);
    } else if (
      (await inPage<string | null>(page, { kind: 'expanded', path: trigger.path })) === 'true'
    ) {
      await page.keyboard.press('Enter');
      await frames(page);
    }
  }
  return findings;
}

/**
 * The no-JavaScript row's fail-closed rule: axe needs timers, so the row
 * turns script on for axe alone, which flips (scripting: none). A page
 * styled by a scripting query would be audited as it never renders, so any
 * such query fails the row until axe can run with JavaScript off.
 */
export async function scriptingMediaFindings(page: Page): Promise<Finding[]> {
  // No named inner function: tsx's keepNames would wrap it in a __name the
  // page doesn't have.
  const queries = await page.evaluate(() => {
    const found: string[] = [];
    const pending: CSSRule[] = [];
    for (const sheet of document.styleSheets) {
      try {
        pending.push(...sheet.cssRules);
      } catch {
        // The policy loads no sheet from another origin.
      }
    }
    while (pending.length > 0) {
      const rule = pending.pop()!;
      const condition = (rule as CSSConditionRule).conditionText ?? '';
      if (/\bscripting\b/.test(condition)) found.push(condition);
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) pending.push(...nested);
    }
    return found;
  });
  return queries.map((query) => ({
    gate: 'runner',
    rule: 'media-emulation',
    expected: 'no scripting media query, while axe needs JavaScript on to run',
    actual: `a stylesheet styles by @media ${query}, which axe's pass would flip`,
  }));
}
