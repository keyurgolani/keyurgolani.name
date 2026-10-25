import { expect, test, type Page } from '@playwright/test';
import {
  frameLoops,
  nextFrames,
  runningAnimations,
  scrollThrough,
  scrollTops,
  watchFrames,
} from '../harness/motion';

// The motion contract's checks (tests/e2e/motion-contract.spec.ts) against
// pages planted with what each must see (#5, review of #42): a smooth scroll
// inside a composition's own scroll container, an endless animation an
// IntersectionObserver starts once its section is in view, and a
// requestAnimationFrame loop. Static pages, no server, and nothing leaves
// the browser.

test.use({
  viewport: { width: 1280, height: 480 },
  contextOptions: { reducedMotion: 'no-preference' },
});

test.beforeEach(async ({ context }) => {
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
});

const SECTIONS = Array.from(
  { length: 6 },
  (_, index) =>
    `<section id="s${index}" style="min-height: 400px"><h2>Section ${index}</h2></section>`,
).join('');

const HEADER_NAV = '<header><nav><a href="#contact">Contact</a></nav></header>';

/**
 * A composition's page, with `css` in its head and `extra` in its last
 * section. `footer` moves the link to the contact section from a header nav
 * to a footer nav below the fold, as Horizontal Cinema's chapter index has it.
 */
async function plant(page: Page, css: string, extra = '', footer = false): Promise<void> {
  await watchFrames(page);
  // A navigation runs the init script; setContent() alone doesn't.
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><html><head><style>body { margin: 0 } ${css}</style></head><body>
<div data-variant="probe" data-motion-policy="reduce">
  ${footer ? '' : HEADER_NAV}
  <main id="main">${SECTIONS}<section id="contact" style="min-height: 400px"><h2>Contact</h2>${extra}</section></main>
  ${footer ? '<footer style="min-height: 600px"><nav><a href="#contact">Contact</a></nav></footer>' : ''}
</div></body></html>`);
  await nextFrames(page);
}

const INNER = "[data-variant='probe'] { display: block; height: 100vh; overflow-y: auto; }";

test("a jump inside the composition's own scroll container is a jump, and a smooth one is not", async ({
  page,
}) => {
  await plant(page, INNER);
  const jump = await scrollTops(page, '#contact');
  expect(jump.before - jump.settled).toBeGreaterThan(100);
  expect(jump.farthest).toBeLessThan(4);

  await plant(page, `${INNER} [data-variant='probe'] { scroll-behavior: smooth; }`);
  const smooth = await scrollTops(page, '#contact');
  expect(smooth.before - smooth.settled).toBeGreaterThan(100);
  expect(smooth.farthest).toBeGreaterThan(50);
});

test('a scroll before the click is no part of the jump, and a smooth scroll after it still is', async ({
  page,
}) => {
  // A scroll that reaches a frame of its own after the page starts recording
  // and before the click, as Playwright's scroll of a link into view can under load.
  const scrollFirst = async () => {
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await nextFrames(page);
  };
  await plant(page, '');
  const jump = await scrollTops(page, '#contact', { beforeClick: scrollFirst });
  expect(jump.before - jump.settled).toBeGreaterThan(100);
  expect(jump.farthest).toBeLessThan(4);

  await plant(page, 'html { scroll-behavior: smooth; }');
  const smooth = await scrollTops(page, '#contact', { beforeClick: scrollFirst });
  expect(smooth.before - smooth.settled).toBeGreaterThan(100);
  expect(smooth.farthest).toBeGreaterThan(50);

  // A link below the fold, which Playwright scrolls into view before it clicks.
  await plant(page, '', '', true);
  const below = await scrollTops(page, '#contact');
  expect(below.before - below.settled).toBeGreaterThan(100);
  expect(below.farthest).toBeLessThan(4);
});

test('an endless animation that starts once its section is in view shows after the jump and on the way down', async ({
  page,
}) => {
  const reveal = `<span id="dot">ongoing</span><script>
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) document.getElementById('dot').classList.add('on');
    }).observe(document.getElementById('dot'));
  </script>`;
  const css =
    "@keyframes probe-pulse { to { opacity: 0.5; } } [data-variant='probe'] .on { animation: probe-pulse 1s infinite; }";
  await plant(page, css, reveal);
  // At load the section is below the fold, so nothing runs yet.
  expect(await runningAnimations(page)).toEqual([]);
  await scrollTops(page, '#contact');
  expect(await runningAnimations(page)).toContainEqual({
    kind: 'css probe-pulse',
    target: 'span.on',
    endless: true,
  });

  // Reading down the page finds it too, inside a scroll container of its own included.
  const fresh = await page.context().newPage();
  await plant(fresh, `${INNER} ${css}`, reveal);
  expect(await runningAnimations(fresh)).toEqual([]);
  expect(await scrollThrough(fresh)).toContainEqual({
    kind: 'css probe-pulse',
    target: 'span.on',
    endless: true,
  });
});

test('a requestAnimationFrame loop is one frameLoops() sees, and a double frame is not', async ({
  page,
}) => {
  await plant(page, '');
  expect(await frameLoops(page, 500)).toBeLessThan(5);
  await page.evaluate(() => {
    // A one-off double frame, as code waits for layout.
    requestAnimationFrame(() => requestAnimationFrame(() => {}));
  });
  expect(await frameLoops(page, 500)).toBeLessThan(5);
  await page.evaluate(() => {
    const tick = () => requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  });
  expect(await frameLoops(page, 1_000)).toBeGreaterThan(20);
});
