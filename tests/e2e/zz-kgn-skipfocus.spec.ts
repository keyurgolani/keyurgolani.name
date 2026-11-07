// HC evidence only, not for merge (row 53 r2): where the first Tab lands on HC mobile, with and without a full-page shot.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import {
  CONTRACT_FIXTURES,
  type ContractFixtureName,
} from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { MODES, settle } from '../variants/modes';
import { fixtureApp, UNDER_TEST } from '../variants/target';

// modes.ts:209 (the first Tab focuses "Skip to content") on Horizontal Cinema at the variants mobile
// project's settings, over the ten fixtures #194 failed, three arms, x3 each, retries 0:
//   (a) goto, settle, the full-page shot modes.ts takes before the keyboard checks, Tab: the repro;
//   (b) the same without the shot;
//   (c) (a) with a recorder from before the page's own scripts: every resize, every ResizeObserver
//       callback (its targets' classes; .hc-shell__em is the em sentinel's), scroll (scrollY),
//       focusin/focusout, hashchange, history.replaceState/pushState, scrollIntoView() and focus()
//       with their callers, up to the Tab; on every scroll and at the Tab, the active element,
//       the element at the viewport's top left (1, 1) and the selection's anchor node, each with its
//       nearest .hc-scene id, as a proxy for Chromium's sequential focus starting point; attached,
//       with the active element at the Tab.
// Each variants fixture project is one server on fixtureApp(fixture, variant) (tests/variants/
// playwright.config.ts): appOptions is worker-scoped and set once per file, so for ten fixtures in one
// file each describe starts its own server the same way (startApp, as distinct-capture.ts does) and
// runs its nine tests in order on it. The context is the project's Desktop Chrome and the base config's
// locale, time zone and service workers, with the mobile mode's viewport, isMobile and hasTouch; as
// the harness does, every request off the app's origin is aborted. One line per test:
//   [zz-kgn-skipfocus] <fixture> <arm> run N/3 <status> active <element at the check> head <sha>

const FIXTURES: readonly ContractFixtureName[] = [
  'missing-media',
  'rtl',
  'consulting',
  'identity-only',
  'mixed',
  'academic',
  'engineering',
  'writing',
  'music',
  'sparse',
];
const RUNS = 3;
const VARIANT = UNDER_TEST.find(({ manifest }) => manifest.id === 'horizontal-cinema');
const MOBILE = MODES.find(({ name }) => name === 'mobile');
if (!VARIANT || !MOBILE) throw new Error('no horizontal-cinema under test, or no mobile mode');
const SHOT = { animations: 'disabled', caret: 'hide', fullPage: true } as const;

function runHead(): string {
  const event = process.env.GITHUB_EVENT_PATH;
  if (event) {
    try {
      const sha = JSON.parse(readFileSync(event, 'utf8'))?.pull_request?.head?.sha;
      if (typeof sha === 'string' && sha) return `${sha} (pull request head)`;
    } catch {
      // No readable event: fall through.
    }
  }
  if (process.env.GITHUB_SHA) return `${process.env.GITHUB_SHA} (GITHUB_SHA)`;
  // git with no inherited GIT_* variable: the strip runs on the map, and none is set.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  try {
    return `${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', env }).trim()} (checkout HEAD)`;
  } catch {
    return 'unknown';
  }
}
const HEAD = runHead();

/** In the page, before its own scripts: the recorder arm (c) reads at the Tab. */
function recorder(): void {
  const w = window as unknown as { __kgnLog: unknown[] };
  const log: unknown[] = [];
  w.__kgnLog = log;
  const at = () => Math.round(performance.now());
  const name = (el: unknown) =>
    el instanceof Element
      ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('class') ? `.${el.getAttribute('class')!.split(' ').join('.')}` : ''}`
      : String(el);
  const caller = () =>
    (new Error().stack ?? '')
      .split('\n')
      .slice(3, 6)
      .map((l) => l.trim());
  const add = (kind: string, detail: Record<string, unknown> = {}) =>
    log.push({ t: at(), kind, y: Math.round(window.scrollY), ...detail });
  window.addEventListener('resize', () => add('resize', { size: `${innerWidth}x${innerHeight}` }));
  // A proxy for Chromium's sequential focus starting point, which a page can't read: the active
  // element, what sits at the viewport's top left, and the selection's anchor, each with its scene.
  const scene = (node: Node | null) =>
    (node instanceof Element ? node : (node?.parentElement ?? null))?.closest('.hc-scene')?.id ??
    '-';
  const point = () => {
    const corner = document.elementFromPoint(1, 1);
    const anchor = getSelection()?.anchorNode ?? null;
    return {
      active: name(document.activeElement),
      activeScene: scene(document.activeElement),
      corner: name(corner),
      cornerScene: scene(corner),
      anchor: anchor ? anchor.nodeName : 'null',
      anchorScene: scene(anchor),
    };
  };
  window.addEventListener('scroll', () => add('scroll', point()), { passive: true });
  window.addEventListener('hashchange', () => add('hashchange', { hash: location.hash }));
  document.addEventListener('focusin', (e) => add('focusin', { el: name(e.target) }), true);
  document.addEventListener('focusout', (e) => add('focusout', { el: name(e.target) }), true);
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        add('ResizeObserver', {
          targets: entries.map((entry) => name(entry.target)),
          em: entries.some((entry) => entry.target.classList.contains('hc-shell__em')),
        });
        callback(entries, observer);
      });
    }
  };
  for (const method of ['replaceState', 'pushState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['replaceState']>) {
      add(`history.${method}`, { url: String(args[2] ?? '') });
      return original.apply(this, args);
    };
  }
  const into = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element, ...args: [ScrollIntoViewOptions?]) {
    add('scrollIntoView()', { el: name(this), caller: caller() });
    return into.apply(this, args);
  };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, ...args: [FocusOptions?]) {
    add('focus()', { el: name(this), caller: caller() });
    return focus.apply(this, args);
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab') add('Tab keydown', point());
    },
    true,
  );
}

/** The active element, named, with the head of its markup. */
const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return 'null';
    const cls = el.getAttribute('class');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls.split(' ').join('.')}` : ''} ${el.outerHTML.slice(0, 100).replace(/\s+/g, ' ')}`;
  });

test.use({ launchOptions: { args: ['--disable-3d-apis'] } });
test.describe.configure({ retries: 0 });

const seen = new Map<string, string>();
test.afterEach(({ browserName }, testInfo) => {
  const [, fixture, arm, run] = /^(\S+) \((\w)\).* run (\d)\//.exec(testInfo.title) ?? [];
  console.log(
    `[zz-kgn-skipfocus] ${fixture} ${arm} run ${run}/${RUNS} ${testInfo.status} active ${seen.get(testInfo.testId) ?? '-'} (${browserName}) head ${HEAD}`,
  );
});

for (const fixtureName of FIXTURES) {
  const fixture = CONTRACT_FIXTURES.find(({ name }) => name === fixtureName);
  if (!fixture) throw new Error(`no contract fixture ${fixtureName}`);
  test.describe(fixtureName, () => {
    // One server for the nine, in order, as one variants project runs on one.
    test.describe.configure({ mode: 'default' });
    let app: Awaited<ReturnType<typeof startApp>>;
    test.beforeAll(async ({ browserName }, testInfo) => {
      const logFile = path.join(
        testInfo.project.outputDir,
        `zz-kgn-skipfocus-${fixtureName}-${browserName}-${process.pid}.log`,
      );
      app = await startApp({ ...fixtureApp(fixture, VARIANT), logFile });
    });
    test.afterAll(async () => {
      await app?.stop();
    });

    const open = async (browser: Browser) => {
      // The device's options but its browser type, which a context doesn't take.
      const chrome = Object.fromEntries(
        Object.entries(devices['Desktop Chrome']).filter(([key]) => key !== 'defaultBrowserType'),
      );
      const { reducedMotion, ...mobile } = MOBILE.context;
      const context = await browser.newContext({
        ...chrome,
        locale: 'en-US',
        timezoneId: 'UTC',
        serviceWorkers: 'block',
        ...mobile,
        reducedMotion,
        baseURL: app.origin,
      });
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === app.origin
          ? route.continue()
          : route.abort('blockedbyclient'),
      );
      return context;
    };

    for (const [arm, label] of [
      ['a', 'goto, settle, the full-page shot, then Tab'],
      ['b', 'goto, settle, no shot, then Tab'],
      ['c', 'goto, settle, the full-page shot, then Tab, recorded'],
    ] as const) {
      for (let run = 1; run <= RUNS; run++) {
        test(
          `${fixtureName} (${arm}) ${label}: the first Tab focuses Skip to content, run ${run}/${RUNS}`,
          {
            annotation: [
              { type: 'route', description: '/' },
              { type: 'profile', description: 'read-only' },
              { type: 'head', description: HEAD },
            ],
          },
          async ({ browser }, testInfo) => {
            const context = await open(browser);
            try {
              const page = await context.newPage();
              if (arm === 'c') await page.addInitScript(recorder);
              await page.goto('/');
              await settle(page, true);
              if (arm !== 'b') {
                await testInfo.attach(`${fixtureName}-${arm}-${run}.png`, {
                  body: await page.screenshot(SHOT),
                  contentType: 'image/png',
                });
              }
              await page.keyboard.press('Tab');
              const now = await active(page);
              seen.set(testInfo.testId, now);
              if (arm === 'c') {
                const log = await page.evaluate(
                  () => (window as unknown as { __kgnLog?: unknown[] }).__kgnLog ?? [],
                );
                await testInfo.attach(`${fixtureName}-c-${run}-recorder.json`, {
                  body: JSON.stringify({ activeAtTab: now, log }, null, 1),
                  contentType: 'application/json',
                });
                console.log(
                  `[zz-kgn-skipfocus-log] ${fixtureName} c run ${run} ${JSON.stringify(log)}`,
                );
              }
              await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
            } finally {
              await context.close();
            }
          },
        );
      }
    }
  });
}
