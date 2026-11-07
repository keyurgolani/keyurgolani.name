// HC evidence only, not for merge (row 53 r2): the variants check on HC identity-only mobile 20 times, retries 0.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { fixtureShot } from '../variants/baseline-pending';
import { checkMode, MODES } from '../variants/modes';
import { fixtureApp, UNDER_TEST } from '../variants/target';

// tests/variants/fixtures.spec.ts:53 ("mobile") on the horizontal-cinema/identity-only project, as 20 tests: the
// same checkMode sequence, the project's use (Desktop Chrome from the chromium project, --disable-3d-apis, the fixture's app on the fixed
// clock) and the mobile mode's context. It lives here, under the main config's chromium project, because the
// variants config's fixture projects take only fixtures.spec.ts, parity.spec.ts and case-study.spec.ts (each
// matched as **/<name>): a new file there runs in no project without a config edit. The one step it can't copy
// is the variants job's toHaveScreenshot (PORTFOLIO_SCREENSHOTS=compare): the shot is taken and attached as there.
// An init script records, at the first Tab's keydown, the active element, the first 5 tab stops and the skip
// link's display, visibility, tabindex and visibility check; at its keyup, 100 ms and 1 s on, the active element;
// and every focusin, focusout, focus() and blur() with the caller. Each test prints one line:
//   [zz-kgn-hc-skip] run NN/20 <status> head <sha> <json>

const RUNS = 20;
const VARIANT = UNDER_TEST.find(({ manifest }) => manifest.id === 'horizontal-cinema');
const FIXTURE = CONTRACT_FIXTURES.find(({ name }) => name === 'identity-only');
const MOBILE = MODES.find(({ name }) => name === 'mobile');
if (!VARIANT || !FIXTURE || !MOBILE)
  throw new Error('no horizontal-cinema, identity-only or mobile');

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

/** In the page, before any script of its own: what the first Tab finds and does. */
function recordFirstTab(): void {
  const w = window as unknown as { __kgnSkip: Record<string, unknown> & { events: unknown[] } };
  const record: Record<string, unknown> & { events: unknown[] } = { events: [] };
  w.__kgnSkip = record;
  const head = (el: Element | null) =>
    el
      ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('class') ? `.${el.getAttribute('class')!.split(' ').join('.')}` : ''} ${el.outerHTML.slice(0, 120)}`
      : 'null';
  const at = () => Math.round(performance.now());
  const event = (kind: string, el: unknown, stack = false) =>
    record.events.push({
      t: at(),
      kind,
      el: el instanceof Element ? head(el) : String(el),
      y: Math.round(window.scrollY),
      ...(stack
        ? {
            stack: (new Error().stack ?? '')
              .split('\n')
              .slice(2, 6)
              .map((l) => l.trim()),
          }
        : {}),
    });
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, ...args: [FocusOptions?]) {
    event('focus()', this, true);
    return focus.apply(this, args);
  };
  const blur = HTMLElement.prototype.blur;
  HTMLElement.prototype.blur = function (this: HTMLElement) {
    event('blur()', this, true);
    return blur.apply(this);
  };
  document.addEventListener('focusin', (e) => event('focusin', e.target), true);
  document.addEventListener('focusout', (e) => event('focusout', e.target), true);
  window.addEventListener('resize', () => event('resize', `${innerWidth}x${innerHeight}`));
  let tabs = 0;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || tabs++ > 0) return;
      const skip = document.querySelector<HTMLElement>('[data-ui-slot="skip-link"]');
      const style = skip ? getComputedStyle(skip) : null;
      const sel =
        'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]';
      record.before = {
        t: at(),
        active: head(document.activeElement),
        hasFocus: document.hasFocus(),
        scrollY: Math.round(window.scrollY),
        skip: skip
          ? {
              display: style!.display,
              visibility: style!.visibility,
              tabIndex: skip.tabIndex,
              visible: skip.checkVisibility(),
              inert: skip.closest('[inert]') !== null,
              rect: (({ x, y, width, height }) => [x, y, width, height].map(Math.round))(
                skip.getBoundingClientRect(),
              ),
            }
          : null,
        firstFive: [...document.querySelectorAll<HTMLElement>(sel)]
          .filter((el) => el.tabIndex >= 0 && !el.closest('[inert]'))
          .slice(0, 5)
          .map((el) => `${el.tabIndex} ${el.checkVisibility() ? 'shown' : 'unshown'} ${head(el)}`),
      };
      const after = (key: string) => () => {
        record[key] = {
          t: at(),
          active: head(document.activeElement),
          scrollY: Math.round(scrollY),
        };
      };
      window.addEventListener('keyup', after('afterKeyup'), { once: true, capture: true });
      setTimeout(after('after100ms'), 100);
      setTimeout(after('after1s'), 1000);
    },
    true,
  );
}

const { reducedMotion, ...options } = MOBILE.context;
test.describe.configure({ retries: 0 });
test.use({
  launchOptions: { args: ['--disable-3d-apis'] },
  appOptions: fixtureApp(FIXTURE, VARIANT),
  ...options,
  contextOptions: { reducedMotion },
});

test.afterEach(async ({ page }, testInfo) => {
  const run = /run (\d+)/.exec(testInfo.title)?.[1] ?? '??';
  const read = await page
    .evaluate(() => (window as unknown as { __kgnSkip?: unknown }).__kgnSkip ?? null)
    .catch((error: Error) => `unreadable: ${error.message.slice(0, 80)}`);
  console.log(
    `[zz-kgn-hc-skip] run ${run}/${RUNS} ${testInfo.status} head ${HEAD} ${JSON.stringify(read)}`,
  );
});

for (let run = 1; run <= RUNS; run++) {
  const n = String(run).padStart(2, '0');
  test(
    `HC identity-only mobile x${RUNS} run ${n}: the variants check, the skip link first`,
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
        { type: 'head', description: HEAD },
      ],
    },
    async ({ page, context, request }, testInfo) => {
      await page.addInitScript(recordFirstTab);
      await checkMode({
        mode: 'mobile',
        page,
        context,
        request,
        variant: VARIANT,
        testInfo,
        go: (target) => target.goto('/'),
        shot: fixtureShot(VARIANT.manifest.id, FIXTURE.name, 'mobile'),
        fixture: FIXTURE.name,
      });
    },
  );
}
