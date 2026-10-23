import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import {
  frameElementAt,
  grantFrameAt,
  lifecycleIn,
  openPreview,
  stageAt,
} from '../harness/studio-preview';

// Two appearance combinations side by side (#7, item 7, and verification
// item 4), on a fixture host built with PREVIEW_FIXTURES=1: the first frame
// renders the draft as its site selects it, which the fallback composition
// renders, and the second an override with fixture-environment, its own
// grant, nonce, and port. Neither frame's attributes, CSS, navigation, or
// state reach the other, and the frames move together only once the owner
// links them.

const secret = ownerSecret();
test.use({ appOptions: { ...ownerApp(secret.hash), fixtureHost: true } });

const PAGE = { type: 'route', description: '/studio/preview' };
const SCREENSHOTS = path.join(reportsDir(), 'preview-fixtures', 'screenshots');

const LONG = 'The garden keeps two maps that never share a pen. '.repeat(30);

/** A portfolio with a case study to move to, and sections enough to scroll through. */
const PORTFOLIO = [
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity:',
  '  name: Compare Person',
  '  tagline: Draws calm maps.',
  'works:',
  '  - id: garden',
  '    slug: garden',
  '    title: Garden',
  '    medium: software',
  '    summary: A garden of calm maps.',
  '    caseStudy:',
  '      challenge: Keep two frames apart.',
  'sections:',
  ...['about', 'second', 'third', 'fourth'].flatMap((id) => [
    '  - kind: lede',
    `    id: ${id}`,
    `    body: ${LONG}`,
  ]),
  '  - kind: works',
  '    id: work',
  '    title: Work',
  '    items:',
  '      - garden',
  '',
].join('\n');

/** The harness's site, which selects missing-variant, so the fallback composition renders. */
const SITE = readFileSync(DEFAULT_SITE, 'utf8');

const controls = (page: Page) => page.getByRole('form', { name: 'Preview controls' });
const secondAppearance = (page: Page) =>
  page.getByRole('group', { name: "Second frame's appearance" });

/**
 * `read` run in `frame`'s document once it has loaded: a frame mid-move has
 * no document to ask, so the read waits for the next one and tries again.
 */
async function inFrame<T>(frame: Frame, read: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      await frame.waitForLoadState('load');
      return await read();
    } catch (error) {
      if (tries >= 20 || !/Execution context was destroyed/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** What a frame's document is: its boundary's attributes, styles, stylesheets, and state. */
const documentOf = (frame: Frame) =>
  inFrame(frame, () =>
    frame.evaluate(() => {
      const boundary = document.querySelector('[data-variant]')!;
      const style = getComputedStyle(boundary);
      return {
        variant: boundary.getAttribute('data-variant'),
        requested: boundary.getAttribute('data-requested-variant'),
        background: style.backgroundColor,
        color: style.color,
        font: style.fontFamily,
        header: document.querySelector('.fe-header')
          ? getComputedStyle(document.querySelector('.fe-header')!).borderBlockEndWidth
          : null,
        stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')]
          .map((link) => new URL((link as HTMLLinkElement).href).pathname)
          .sort(),
        marked: (window as unknown as { marked?: string }).marked ?? null,
        route: location.pathname.replace(/^\/preview\/[A-Za-z0-9_-]{22}/, '') || '/',
        grant: location.pathname.split('/')[2],
        scrolled: Math.round(scrollY),
      };
    }),
  );

/**
 * The route `frame` shows, from its URL, which reads even while the frame
 * navigates, when its document can't be asked.
 */
const routeIn = (frame: Frame) =>
  new URL(frame.url()).pathname.replace(/^\/preview\/[A-Za-z0-9_-]{22}/, '') || '/';

/** Where `anchor`'s section sits in `frame`'s viewport, in CSS pixels from its top. */
const sectionTop = (frame: Frame, anchor: string) =>
  inFrame(frame, () =>
    frame.evaluate(
      (id) =>
        Math.round(
          document.querySelector(`[data-section-id="${id}"]`)!.getBoundingClientRect().top,
        ),
      anchor,
    ),
  );

/** The grant the `index`th frame shows. */
const grantAt = async (page: Page, index: number) =>
  new URL((await grantFrameAt(page, index)).url()).pathname.split('/')[2];

/** Runs `change`, then waits until the `index`th frame shows a new grant, ready. */
async function remints(page: Page, index: number, change: () => Promise<unknown>) {
  const before = await grantAt(page, index);
  await change();
  await expect.poll(() => grantAt(page, index), { timeout: 15_000 }).not.toBe(before);
  await expect(stageAt(page, index)).toHaveAttribute('data-phase', 'ready');
}

/**
 * Waits until `frame`'s document holds a port: the agent sends nothing
 * before, and Studio's first message over a new port is the lifecycle.
 */
async function connected(frame: Frame): Promise<void> {
  await expect.poll(() => inFrame(frame, () => lifecycleIn(frame))).not.toBeNull();
}

/**
 * Goes back once in the page's history, which the frames share, and waits
 * until one more of `frames` shows its home page again.
 */
async function back(page: Page, frames: readonly Frame[]): Promise<void> {
  const home = () => frames.filter((each) => routeIn(each) === '/').length;
  const before = home();
  await page.evaluate(() => history.back());
  await expect.poll(home).toBe(before + 1);
}

/** Moves `frame` to `route` under its own grant, as a click on one of its own links does. */
async function follow(frame: Frame, route: string): Promise<void> {
  // A click before the document's handshake would tell Studio nothing.
  await connected(frame);
  await frame.evaluate((to) => {
    const base = location.pathname.match(/^\/preview\/[A-Za-z0-9_-]{22}/)![0];
    const link = document.createElement('a');
    link.id = 'compare-move';
    link.href = to === '/' ? base : `${base}${to}`;
    link.textContent = 'Move';
    link.style.display = 'block';
    document.body.prepend(link);
  }, route);
  await frame.locator('#compare-move').click();
}

test(
  'two appearance combinations side by side, each frame its own grant, nonce, and port, keep their attributes, CSS, navigation, and state apart, and move together only once the owner links them (#7, item 7)',
  { annotation: [PAGE] },
  async ({ page, app }, testInfo) => {
    test.setTimeout(120_000);
    // Each hello the page hears, with the frame it came from.
    await page.addInitScript(() => {
      const hellos: Array<{ nonce: string; frame: number }> = [];
      (window as unknown as { hellos: typeof hellos }).hellos = hellos;
      addEventListener('message', (event) => {
        const data = event.data as { type?: string; payload?: { nonce?: string } } | null;
        if (data?.type !== 'hello' || !data.payload?.nonce) return;
        const frames = [...document.querySelectorAll('iframe')];
        hellos.push({
          nonce: data.payload.nonce,
          frame: frames.findIndex((each) => each.contentWindow === event.source),
        });
      });
    });
    const { frame: alone } = await openPreview(
      page,
      app,
      secret.password,
      'Compare Person',
      SITE,
      PORTFOLIO,
    );
    // At mobile width, where the sections run long enough to scroll through.
    await controls(page)
      .getByRole('combobox', { name: 'Width (simulated)' })
      .selectOption('mobile');
    await expect(stageAt(page, 0)).toHaveAttribute('data-phase', 'ready');
    await expect.poll(() => alone.evaluate(() => innerWidth)).toBe(390);
    const before = await documentOf(alone);
    expect(before).toMatchObject({ variant: 'fallback', requested: 'missing-variant' });

    // Compare: a second frame, with linking off.
    const compare = controls(page).getByRole('checkbox', { name: 'Compare two frames' });
    const linked = controls(page).getByRole('checkbox', { name: 'Link scrolling and navigation' });
    await expect(linked).toBeDisabled();
    await compare.focus();
    await page.keyboard.press('Space');
    await expect(compare).toBeChecked();
    await expect(linked).toBeEnabled();
    await expect(linked).not.toBeChecked();
    await expect(page.getByRole('region', { name: 'First preview' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Second preview' })).toBeVisible();
    await expect(frameElementAt(page, 0)).toHaveAttribute('title', /, first of two$/);
    await expect(frameElementAt(page, 1)).toHaveAttribute('title', /, second of two$/);

    // The second frame's own appearance: fixture-environment, with installed packs.
    const group = secondAppearance(page);
    // The change is a new grant, which the refresh throttle may hold up to 2
    // seconds: the frame counts as changed once it shows that grant, ready.
    await remints(page, 1, () =>
      group.getByRole('combobox', { name: 'Composition' }).selectOption('fixture-environment'),
    );
    // The site is on the platform defaults (#19, Slice 4), the packs this
    // build installs, so the override keeps them.
    await expect(group.getByRole('combobox', { name: 'Color scheme' })).toHaveValue(
      'warm-parchment',
    );
    await expect(group.getByRole('combobox', { name: 'Typography' })).toHaveValue('humanist-ui');
    await expect(frameElementAt(page, 1)).toHaveAttribute(
      'title',
      /^Preview — not live, fixture-environment, .*, second of two$/,
    );
    await expect(stageAt(page, 0)).toHaveAttribute('data-phase', 'ready');
    const first = await grantFrameAt(page, 0);
    const second = await grantFrameAt(page, 1);
    await expect.poll(async () => (await documentOf(second)).variant).toBe('fixture-environment');

    // Grants, nonces, and ports of their own.
    const a = await documentOf(first);
    const b = await documentOf(second);
    expect(a.grant).not.toBe(b.grant);
    // Both at the one width the controls set.
    expect(await first.evaluate(() => innerWidth)).toBe(390);
    expect(await second.evaluate(() => innerWidth)).toBe(390);
    const hellos = await page.evaluate(
      () => (window as unknown as { hellos: Array<{ nonce: string; frame: number }> }).hellos,
    );
    const nonceOf = (frame: number) =>
      new Set(hellos.filter((each) => each.frame === frame).map(({ nonce }) => nonce));
    expect(nonceOf(0).size).toBeGreaterThan(0);
    expect(nonceOf(1).size).toBeGreaterThan(0);
    for (const nonce of nonceOf(0)) expect(nonceOf(1).has(nonce)).toBe(false);
    expect(hellos.every(({ frame }) => frame === 0 || frame === 1)).toBe(true);

    // Attributes and CSS: the first frame is as it was alone, the second its own.
    expect(a).toMatchObject({
      variant: 'fallback',
      requested: 'missing-variant',
      background: before.background,
      color: before.color,
      font: before.font,
      header: null,
      stylesheets: before.stylesheets,
    });
    expect(b).toMatchObject({ variant: 'fixture-environment', requested: null, header: '1px' });
    mkdirSync(SCREENSHOTS, { recursive: true });
    const shot = path.join(SCREENSHOTS, 'compare-fallback-and-fixture-environment.png');
    await page
      .locator('.studio-preview__frames')
      .screenshot({ path: shot, animations: 'disabled' });
    await testInfo.attach('compare-fallback-and-fixture-environment', {
      path: shot,
      contentType: 'image/png',
    });

    // State: what one document holds, the other never sees.
    await first.evaluate(() => {
      (window as unknown as { marked: string }).marked = 'first';
    });
    expect((await documentOf(second)).marked).toBeNull();

    // Unlinked, each scrolls and moves on its own.
    await first.evaluate(() => {
      const third = document.querySelector('[data-section-id="third"]')!;
      scrollTo(0, scrollY + third.getBoundingClientRect().top);
    });
    await expect.poll(() => sectionTop(first, 'third')).toBe(0);
    await page.waitForTimeout(500);
    expect((await documentOf(second)).scrolled).toBe(0);
    await follow(first, '/work/garden');
    await expect.poll(async () => routeIn(first)).toBe('/work/garden');
    await expect(stageAt(page, 0)).toHaveAttribute('data-phase', 'ready');
    await page.waitForTimeout(500);
    expect(routeIn(second)).toBe('/');

    // Back home, where the frame's agent is: neither composition has another
    // page that renders until #10 resolves works, and a work's path is the
    // frame's 404 document, which says nothing of where it goes next.
    const frames = [first, second];
    await back(page, frames);

    // Linked: a move in either frame moves the other.
    await linked.check();
    await follow(first, '/work/garden');
    await expect.poll(async () => routeIn(second)).toBe('/work/garden');
    await back(page, frames);
    await back(page, frames);
    await follow(second, '/work/garden');
    await expect.poll(async () => routeIn(first)).toBe('/work/garden');
    await back(page, frames);
    await back(page, frames);
    await connected(first);
    await connected(second);
    // Each still in its own grant, with its own composition.
    expect(await documentOf(first)).toMatchObject({ grant: a.grant, variant: 'fallback' });
    expect(await documentOf(second)).toMatchObject({
      grant: b.grant,
      variant: 'fixture-environment',
    });
    // A reader scrolling one scrolls the other to the same section.
    await first.evaluate(() => {
      const fourth = document.querySelector('[data-section-id="fourth"]')!;
      scrollTo(0, scrollY + fourth.getBoundingClientRect().top);
    });
    await expect.poll(() => sectionTop(second, 'fourth')).toBe(0);

    // Unlinked again, nothing passes.
    await linked.uncheck();
    await follow(first, '/work/garden');
    await expect.poll(async () => routeIn(first)).toBe('/work/garden');
    await page.waitForTimeout(500);
    expect(routeIn(second)).toBe('/');
  },
);
