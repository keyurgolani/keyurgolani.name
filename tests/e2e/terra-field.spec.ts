import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Terra Field's checks in a browser (variants-10 brief §5.5, step 10): the
// arc commits (60 px or more at 1440, TF-M3), the seal is whole and never
// breaks a word (TF-M2), the field's text reads on it, Field notes opens as
// a modal dialog from its invoker and gives focus back, the marker leaves
// focus visible under it (S4), nothing runs a frame loop at rest or under
// reduced motion, and a phone has no sideways scroll. On the complete
// fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'terra-field'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test('the opening arc sags 60 px or more at 1440 (TF-M3)', { annotation }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'networkidle' });
  const sag = await page.locator('.tf-hero').evaluate((hero) => {
    const probe = document.createElement('div');
    probe.style.blockSize = 'var(--layout-depth)';
    probe.style.position = 'absolute';
    hero.append(probe);
    const px = probe.getBoundingClientRect().height;
    probe.remove();
    return px;
  });
  expect(sag).toBeGreaterThanOrEqual(60);
});

test(
  'the seal is whole: a circle, no word broken, at 1440 and 390 (TF-M2)',
  { annotation },
  async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const seal = page.locator('.tf-seal');
      if ((await seal.count()) === 0) continue;
      const fit = await seal.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const label = element.querySelector('.tf-seal__label');
        // A word breaks when a line holds part of one: measure each word as a range.
        const broken: string[] = [];
        if (label?.firstChild) {
          const text = label.textContent ?? '';
          let at = 0;
          for (const word of text.split(/\s+/)) {
            const start = text.indexOf(word, at);
            const range = document.createRange();
            range.setStart(label.firstChild, start);
            range.setEnd(label.firstChild, start + word.length);
            if (range.getClientRects().length > 1) broken.push(word);
            at = start + word.length;
          }
        }
        return {
          w: box.width,
          h: box.height,
          broken,
          overflows: label ? label.scrollWidth > label.clientWidth + 1 : false,
        };
      });
      expect(fit.broken, `${width}`).toEqual([]);
      expect(fit.overflows, `${width}`).toBe(false);
      expect(Math.abs(fit.w - fit.h), `${width}: a circle`).toBeLessThan(2);
    }
  },
);

test(
  'Field notes opens as a modal dialog, closes on Escape, and gives focus back',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const opener = page.locator('.tf-mast [data-tf-notes]');
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.tf-notes');
    await expect(dialog).toHaveJSProperty('open', true);
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveJSProperty('open', false);
    await expect(opener).toBeFocused();
    // A link in it closes it before the page moves, and focus goes where the reader went,
    // so the next Tab carries on from there, not from the masthead (code review low 2).
    await opener.click();
    const link = dialog.locator('.tf-notes__cols a').first();
    const target = decodeURIComponent((await link.getAttribute('href'))!.split('#')[1]!);
    await link.click();
    await expect(dialog).toHaveJSProperty('open', false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(target);
  },
);

test(
  'focus is never hidden under the sticky marker (S4, WCAG 2.4.11)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const covered: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const hit = await page.evaluate(() => {
        const focused = document.activeElement as HTMLElement | null;
        const chip = document.querySelector('.tf-marker__chip');
        if (!focused || !chip || chip.contains(focused)) return null;
        const a = focused.getBoundingClientRect();
        const b = chip.getBoundingClientRect();
        const overlap =
          a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
        return overlap && a.top < b.bottom && a.bottom <= b.bottom
          ? focused.textContent?.slice(0, 30)
          : null;
      });
      if (hit) covered.push(hit);
    }
    expect(covered).toEqual([]);
  },
);

test(
  'at rest, and under reduced motion, nothing runs a frame loop or an endless animation',
  { annotation },
  async ({ page }) => {
    for (const motion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const idle = await page.evaluate(
        () =>
          new Promise<{ frames: number; endless: number }>((resolve) => {
            let frames = 0;
            const original = window.requestAnimationFrame;
            window.requestAnimationFrame = (callback) => {
              frames++;
              return original(callback);
            };
            setTimeout(() => {
              window.requestAnimationFrame = original;
              resolve({
                frames,
                endless: document
                  .getAnimations()
                  .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
                  .length,
              });
            }, 2000);
          }),
      );
      expect(idle, motion).toEqual({ frames: 0, endless: 0 });
    }
  },
);

test(
  'no sideways scroll at 320, and the phone masthead is the name and Field notes',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    const shown = await page
      .locator('.tf-mast a, .tf-mast button')
      .evaluateAll(
        (elements) =>
          elements.filter((element) => (element as HTMLElement).offsetParent !== null).length,
      );
    expect(shown).toBe(2);
  },
);

test(
  'the full record: a fragment link opens its fold, print shows it, and no script shows a target',
  { annotation },
  async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const fold = page.locator('section[data-fold] details.tf-fold').first();
    if ((await fold.count()) === 0) return;
    const id = await fold.evaluate((element) => element.parentElement!.id);
    await expect(fold).toHaveJSProperty('open', false);
    await page.evaluate((target) => {
      location.hash = target;
    }, id);
    await expect(fold).toHaveJSProperty('open', true);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('section[data-fold] .tf-fold__body').first()).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: page.url() });
    const still = await context.newPage();
    await still.goto(`/#${id}`, { waitUntil: 'load' });
    await expect(still.locator(`#${id} .tf-fold__body`)).toBeVisible();
    await context.close();
  },
);

test(
  'with no script the opening is there from the first read: no part of it waits at opacity 0',
  { annotation },
  async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: page.url(),
      viewport: { width: 1440, height: 900 },
    });
    const still = await context.newPage();
    await still.goto('/', { waitUntil: 'load' });
    // Read at once, as the quality runner's no-JavaScript inventory does: nothing waits out a delay.
    const parts = await still.evaluate(() =>
      [
        '.tf-hero__kicker',
        '.tf-hero__line',
        '.tf-hero__lede',
        '.tf-hero__acts',
        '.tf-hero__sub',
        '.tf-seal',
      ].flatMap((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [];
        const shown = element.checkVisibility({ opacityProperty: true });
        const playing = element.getAnimations().length;
        return [`${selector} ${shown ? 'shown' : 'hidden'}, ${playing} playing`];
      }),
    );
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts).toEqual(parts.map((each) => each.replace(/ .*/, ' shown, 0 playing')));
    await expect(still.locator('.tf-root > noscript > [data-tf-nojs]')).toHaveCount(1);
    await context.close();
    // With script the opening still plays, from the first paint: the mark is only the parser's.
    await expect(page.locator('[data-tf-nojs]')).toHaveCount(0);
  },
);

test(
  'the masthead marks no destination in the opening, then the one the reader is in (aria-current)',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-tf-enhanced]').waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.tf-mast [aria-current]')).toHaveCount(0);
    await expect(page.locator('.tf-marker__where')).toHaveText('');
    const fields = await page
      .locator('[data-tf-destination]')
      .evaluateAll((all) => all.map((field) => field.getAttribute('data-tf-destination')!));
    const id = fields.at(-1)!;
    await page.locator(`[data-tf-destination='${id}']`).evaluate((field) => {
      scrollTo(0, field.getBoundingClientRect().top + scrollY + 40);
    });
    const link = page.locator(`.tf-mast [data-tf-to='${id}']`);
    const linked = (await link.count()) > 0;
    if (linked) await expect(link).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('.tf-mast [aria-current]')).toHaveCount(linked ? 1 : 0);
    await expect(page.locator('.tf-marker__where')).not.toHaveText('');
  },
);

test(
  'a malformed fragment strands nothing: folds still open on a fragment, and nothing throws',
  { annotation },
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#%E0%A4%A', { waitUntil: 'networkidle' });
    await page.locator('[data-tf-enhanced]').waitFor({ state: 'attached' });
    expect(errors).toEqual([]);
    const fold = page.locator('section[data-fold] details.tf-fold').first();
    if ((await fold.count()) > 0) {
      const id = await fold.evaluate((element) => element.parentElement!.id);
      await page.evaluate((target) => {
        location.hash = target;
      }, id);
      await expect(fold).toHaveJSProperty('open', true);
    }
    await page.evaluate(() => {
      location.hash = '%E0%A4%A';
    });
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  },
);

test(
  'under reduced motion nothing enters as the page scrolls: no reveal plays',
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-tf-enhanced]').waitFor({ state: 'attached' });
    const played = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.7) {
        scrollTo(0, y);
        await wait(80);
      }
      return document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && !target.closest('.tf-hero');
      }).length;
    });
    expect(played).toBe(0);
  },
);

test(
  'the band’s plates never overlap, and two of them leave no column empty (MF-4)',
  { annotation },
  async ({ page }) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const band = page.locator('.tf-band');
      if ((await band.count()) === 0) continue;
      const layout = await band.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const parts = [
          ...element.querySelectorAll(':scope > .tf-band__photo, :scope > .tf-plate'),
        ].map((part) => part.getBoundingClientRect());
        const overlaps = parts.some((a, i) =>
          parts.some(
            (b, j) =>
              j > i &&
              a.left < b.right - 1 &&
              b.left < a.right - 1 &&
              a.top < b.bottom - 1 &&
              b.top < a.bottom - 1,
          ),
        );
        // How much of the band's width the parts cover side by side.
        const spans = parts
          .map((rect) => [rect.left, rect.right] as const)
          .sort((a, b) => a[0] - b[0]);
        let covered = 0;
        let edge = box.left;
        for (const [left, right] of spans) {
          covered += Math.max(0, right - Math.max(left, edge));
          edge = Math.max(edge, right);
        }
        return { overlaps, parts: parts.length, coverage: covered / box.width };
      });
      expect(layout.overlaps, `${width}: parts overlap`).toBe(false);
      if (layout.parts >= 2)
        expect(layout.coverage, `${width}: a column track is empty`).toBeGreaterThan(0.85);
    }
  },
);

test(
  'a work’s own page: its title the one h1, every part in the index landing, the cover over the arc, no sideways scroll',
  { annotation: [{ type: 'route', description: '/work/<slug>' }, annotation[1]!] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const href = await page.locator('a[href*="/work/"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(href!, { waitUntil: 'networkidle' });
    await expect(page.locator('[data-tf-page="case"]')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    // Under read-only the fixture's covers are still processing, so no cover breaks the arc and
    // no empty frame stands in for one (code re-review R1); the sample spec holds the ready case.
    await expect(page.locator('.tf-casecover')).toHaveCount(0);
    await expect(page.locator('.tf-hero--case[data-cover]')).toHaveCount(0);
    const parts = page.locator('.tf-caseparts a');
    const count = await parts.count();
    for (let i = 0; i < count; i++) {
      const id = (await parts.nth(i).getAttribute('href'))!.slice(1);
      expect(await page.locator(`[id="${id}"]`).count(), id).toBe(1);
    }
    if (count > 0) {
      await parts.last().click();
      const id = (await parts.last().getAttribute('href'))!.slice(1);
      await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
    }
    // Every destination goes home, to its field there; Contact to this page's own close.
    for (const [id, to] of await page
      .locator('.tf-mast [data-tf-to]')
      .evaluateAll((links) =>
        links.map((link) => [link.getAttribute('data-tf-to')!, link.getAttribute('href')!]),
      )) {
      if (id === 'contact') {
        expect(to!.startsWith('#'), to).toBe(true);
        expect(await page.locator(`[id="${to!.slice(1)}"]`).count(), to).toBe(1);
      } else expect(to!.startsWith('#'), to).toBe(false);
    }
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways, `${width}`).toBeLessThanOrEqual(0);
    }
  },
);
