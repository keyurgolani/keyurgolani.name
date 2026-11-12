import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { PNG } from 'pngjs';
import { expect, test } from '../harness/fixtures';
import { ENHANCEMENT_PENDING } from '../../packages/variant-contract/src/settle';
import { watchEnhancements } from '../quality/lib/a11y/conditions';

// Aurora Glass's checks in a browser (variants-10 brief §5.2, step 11): one
// Pause the sky stops both loops, the curtains' drift and the bead's breath
// (WCAG 2.2.2); the drift rests once the opening has scrolled away, since a
// fixed sky never pauses offscreen on its own (AG-M7); under reduced motion
// nothing loops and Pause stays on the page still (aria-disabled), taking no
// press (the quality inventory under reduced motion); no text sits on the sky; the
// Index opens over the page and gives focus back; at most three surfaces
// blur (AG-M6); and no sideways scroll on a phone. On the complete
// fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
};

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

/** The page's infinite animations and whether each is running. */
const loops = () =>
  document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
    .map((animation) => animation.playState);

/**
 * The focused capsule item's band and ring against the capsule's padding box, and its height
 * (the code review's items 1 and 2): `past` is how far the band goes past that box (at most 0),
 * `ringPast` how far the ring goes past the band (at most 0).
 */
const bandFit = (el: Element) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el, '::before');
  const cap = el.closest('.ag-capsule')!;
  const c = cap.getBoundingClientRect();
  const cb = getComputedStyle(cap);
  const box = {
    left: c.left + parseFloat(cb.borderLeftWidth),
    right: c.right - parseFloat(cb.borderRightWidth),
    top: c.top + parseFloat(cb.borderTopWidth),
    bottom: c.bottom - parseFloat(cb.borderBottomWidth),
  };
  const band = {
    left: r.left + parseFloat(cs.left),
    right: r.right - parseFloat(cs.right),
    top: r.top + parseFloat(cs.top),
    bottom: r.bottom - parseFloat(cs.bottom),
  };
  const own = getComputedStyle(el);
  const out = parseFloat(own.outlineOffset) + parseFloat(own.outlineWidth);
  return {
    focused: el.matches(':focus-visible'),
    height: r.height,
    past: Math.max(
      box.left - band.left,
      band.right - box.right,
      box.top - band.top,
      band.bottom - box.bottom,
    ),
    ringPast: Math.max(
      band.left - (r.left - out),
      r.right + out - band.right,
      band.top - (r.top - out),
      r.bottom + out - band.bottom,
    ),
  };
};

/** Tab until `selector` has focus (keyboard focus, so :focus-visible), at most 30 presses. */
async function tabTo(page: import('@playwright/test').Page, selector: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.locator(selector).evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab never reached ${selector}`);
}

test(
  'Pause the sky stops both loops, and pressing it again starts them',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const pause = page.getByRole('button', { name: 'Pause the sky' });
    await expect(pause).toBeVisible();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(loops)).toEqual(['paused', 'paused']);
    await pause.click();
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
  },
);

test(
  'the drift rests once the opening has scrolled away, and runs again when it comes back',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect.poll(() => page.evaluate(loops)).toEqual(['paused', 'paused']);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
  },
);

test(
  'the sky rests while the tab is hidden, and runs again when it shows',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
    const setHidden = (hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    await expect(page.locator('.ag')).toHaveAttribute('data-ag-sky', 'paused');
    await expect.poll(() => page.evaluate(loops)).toEqual(['paused', 'paused']);
    await setHidden(false);
    await expect(page.locator('.ag')).toHaveAttribute('data-ag-sky', 'drift');
    await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
  },
);

test(
  'the sky stops for good after its cycles: nothing loops and Pause is withdrawn (AG-M7)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const pause = page.getByRole('button', { name: 'Pause the sky' });
    await expect(pause).toBeVisible();
    // Live, it carries no note: the still state's note is what tells the two apart. The note is
    // hidden outright, so live there's no stray text and no description.
    const note = page.locator(`#${await pause.getAttribute('aria-describedby')}`);
    await expect(note).toBeHidden();
    await expect(note).toHaveAttribute('hidden', '');
    // Its name is the word alone, live as still, and live it has no description.
    await expect(pause).toHaveAccessibleName(/^Pause the sky$/);
    await expect(pause).toHaveAccessibleDescription('');
    // Four full drift cycles are eight of its alternating iterations; seven leave it running.
    const iterate = (times: number) =>
      page.evaluate((n) => {
        const curtains = document.querySelector('.ag-sky__curtains')!;
        for (let i = 0; i < n; i += 1)
          curtains.dispatchEvent(new AnimationEvent('animationiteration', { bubbles: true }));
      }, times);
    await iterate(7);
    await expect(page.locator('.ag')).toHaveAttribute('data-ag-sky', 'drift');
    await iterate(1);
    await expect(page.locator('.ag')).not.toHaveAttribute('data-ag-sky', /.*/);
    await expect(pause).toBeHidden();
    await expect.poll(() => page.evaluate(loops)).toEqual([]);
    // It stays stopped: scrolling away and back doesn't start it again.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(loops)).toEqual([]);
    await expect(pause).toBeHidden();
  },
);

test.describe('under reduced motion', () => {
  // At 1024 Pause is the capsule's last item: its note, "held", follows it inside the capsule,
  // and the capsule keeps to its width (D's check of option 2).
  test.describe('at 1024', () => {
    test.use({ viewport: { width: 1024, height: 768 } });
    test(
      'the capsule’s still Pause says held, inside the capsule',
      { annotation },
      async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/', { waitUntil: 'networkidle' });
        const pause = page.locator('.ag-capsule .ag-orn--capsule');
        await expect(pause).toBeVisible();
        await expect(pause).toHaveAttribute('aria-disabled', 'true');
        await expect(pause).toHaveAccessibleName(/^Pause the sky$/);
        await expect(pause).toHaveAccessibleDescription(/^held$/);
        const note = page.locator('.ag-capsule .ag-orn__held');
        await expect(note).toBeVisible();
        await expect(note).toHaveText('held');
        await expect(page.locator('.ag-ornament .ag-orn__held')).toBeHidden();
        const fit = await page.locator('.ag-capsule').evaluate((capsule) => {
          const rect = capsule.getBoundingClientRect();
          const kids = [...capsule.children]
            .map((kid) => kid.getBoundingClientRect())
            .filter((box) => box.width > 0);
          return {
            inside: kids.every((box) => box.left >= rect.left - 1 && box.right <= rect.right + 1),
            page: rect.right <= document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          };
        });
        expect(fit).toEqual({ inside: true, page: true, scroll: true });
      },
    );
  });

  test(
    'nothing loops, and Pause stays on the page still, taking no press',
    { annotation },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/', { waitUntil: 'networkidle' });
      const pause = page.getByRole('button', { name: 'Pause the sky' });
      await expect(pause).toBeVisible();
      await expect(pause).toBeInViewport();
      await expect(pause).toHaveAttribute('aria-disabled', 'true');
      // It says why right after itself, as the live control doesn't (D's delta check), its name
      // kept: the note is plain text outside the button, its description, not hidden from the tree.
      const note = page.locator(`#${await pause.getAttribute('aria-describedby')}`);
      await expect(note).toBeVisible();
      await expect(note).toHaveText('held: reduced motion');
      await expect(note).not.toHaveAttribute('aria-hidden', /.*/);
      await expect(pause.locator('[data-ag-held]')).toHaveCount(0);
      // The note is its description, not part of its name: the name is the word alone.
      await expect(pause).toHaveAccessibleName(/^Pause the sky$/);
      await expect(pause).toHaveAccessibleDescription(/^held: reduced motion$/);
      await expect(pause).toHaveAttribute('aria-pressed', 'false');
      // The dispatched press below skips Playwright's actionability checks, so the control's
      // reachability is asserted here: the element at its centre is the control itself.
      expect(
        await pause.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return !!hit && button.contains(hit);
        }),
      ).toBe(true);
      // A press reaches it (Playwright won't click an aria-disabled control), and changes nothing.
      await pause.dispatchEvent('click');
      await expect(pause).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.ag')).not.toHaveAttribute('data-ag-sky', /.*/);
      expect(await page.evaluate(loops)).toEqual([]);
    },
  );
});

test(
  'no text sits on the sky: every text node with a box is on a pane, a sheet or the chrome',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const bare = await page.evaluate(() => {
      const root = document.querySelector('.ag')!;
      const surfaces =
        '.ag-pane, .ag-lite, .ag-sheet, .ag-call, .ag-offer, .ag-capsule, .ag-orn, .ag-sec--split > .ag-sec__head, [data-visitor-control-slot], .ag-index';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const out: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const parent = node.parentElement;
        if (
          !text ||
          !parent ||
          parent.closest('.ag-hidden, [hidden], .ag-index:not(:popover-open)')
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (!parent.closest(surfaces)) out.push(text.slice(0, 40));
      }
      return out;
    });
    expect(bare).toEqual([]);
  },
);

test(
  'the focused skip link paints on top of the sky and the chrome (C1)',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    const link = page.locator("[data-ui-slot='skip-link']");
    await expect(link).toBeFocused();
    // What's painted, not what's hit (the sky takes no pointer events, so elementFromPoint skips it):
    // one pixel of the link's own padding, on its middle line, must be the link's own fill.
    const spot = await link.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: Math.round(rect.left + Math.max(2, parseFloat(style.paddingLeft) / 2)),
        y: Math.round(rect.top + rect.height / 2),
        width: rect.width,
        fill: style.backgroundColor,
      };
    });
    expect(spot.width).toBeGreaterThan(1);
    const fill = spot.fill
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    const png = PNG.sync.read(
      await page.screenshot({ clip: { x: spot.x, y: spot.y, width: 1, height: 1 } }),
    );
    const painted = [png.data[0]!, png.data[1]!, png.data[2]!];
    // A solid fill paints exactly; the sky behind (the bug) differs by tens in some channel.
    const off = Math.max(...painted.map((channel, index) => Math.abs(channel - fill[index]!)));
    expect(off, `${painted} against the link's ${spot.fill}`).toBeLessThanOrEqual(3);
  },
);

test('at most three surfaces blur (AG-M6)', { annotation }, async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const blurred = await page.evaluate(
    () =>
      [...document.querySelectorAll('.ag *')].filter((element) => {
        const value = getComputedStyle(element).backdropFilter;
        return value !== '' && value !== 'none';
      }).length,
  );
  expect(blurred).toBeLessThanOrEqual(3);
});

test(
  'the Index opens over the page, a link in it closes it, and Escape gives focus back',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.ag[data-ag-live]')).toHaveCount(1);
    await expect(page.locator('.ag-capsule__index--plain')).toBeHidden();
    const button = page.locator('.ag-capsule__index--live');
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('.ag-index');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAccessibleName('Index');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await dialog.locator('.ag-index__dest').nth(1).click();
    await expect(dialog).toBeHidden();
  },
);

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  test(
    'the Index is a plain link to a contents list after main, and following a link leaves nothing open',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('.ag[data-ag-live]')).toHaveCount(0);
      await expect(page.locator('.ag-capsule__index--live')).toBeHidden();
      const link = page.locator('.ag-capsule__index--plain');
      await expect(link).toBeVisible();
      await expect(link).toHaveAccessibleName('Index');
      const list = page.locator('.ag-index');
      // In the flow, not the top layer: visible, static, its Close gone.
      await expect(list).toBeVisible();
      expect(await list.evaluate((el) => getComputedStyle(el).position)).toBe('static');
      expect(await list.evaluate((el) => el.matches(':popover-open'))).toBe(false);
      await expect(list.locator('.ag-index__close')).toBeHidden();
      await link.click();
      await expect(page).toHaveURL(/ag--index$/);
      // Following one of its links lands on the band, with nothing over it.
      const dest = list.locator('.ag-index__dest').nth(1);
      const target = (await dest.getAttribute('href'))!.split('#')[1]!;
      await dest.click();
      await expect(page).toHaveURL(new RegExp(`#${target}$`));
      expect(await list.evaluate((el) => el.matches(':popover-open'))).toBe(false);
      await expect(page.locator(`[id="${target}"]`)).toBeInViewport();
    },
  );
});

test.describe('between 48 and 64rem', () => {
  test.use({ viewport: { width: 800, height: 900 } });
  test(
    'a long name wraps between its words in the capsule, never cut; the Index (holding the destinations) and the call keep their room',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      // The fixture's name is short; a long one, set in place, is what the layout has to hold.
      await page.locator('.ag-capsule__name').evaluate((el) => {
        el.textContent = 'Maximiliana Konstantinopoulou-Vanderbilt-Featherstonehaugh';
      });
      const box = await page.locator('.ag-capsule').evaluate((el) => {
        const name = el.querySelector<HTMLElement>('.ag-capsule__name')!;
        const rect = el.getBoundingClientRect();
        const kids = [...el.children].map((child) => child.getBoundingClientRect());
        return {
          left: rect.left,
          right: rect.right,
          vw: document.documentElement.clientWidth,
          clipped:
            name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1,
          ellipsis: getComputedStyle(name).textOverflow,
          inside: kids.every(
            (kid) => kid.width === 0 || (kid.left >= rect.left - 1 && kid.right <= rect.right + 1),
          ),
        };
      });
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      // Row 150: the name is never cut and never splits a word; it wraps between its words.
      expect(box.clipped).toBe(false);
      expect(box.ellipsis).toBe('clip');
      expect(box.inside).toBe(true);
      // At 800px the destinations fold into the Index, as on a phone.
      await expect(page.locator('.ag-capsule__dest')).toBeHidden();
      await expect(page.locator('.ag-index .ag-index__dest')).not.toHaveCount(0);
      await expect(page.locator('.ag-capsule__cta')).toBeVisible();
      await expect(page.locator('.ag-capsule__index--live')).toBeVisible();
      const ornament = await page.locator('.ag-ornament').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(ornament.left).toBeGreaterThanOrEqual(box.right);
      expect(ornament.right).toBeLessThanOrEqual(box.vw);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    },
  );
});

test(
  'focus follows Pause when the width moves it between the ornament and the capsule',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const ornament = page.locator('.ag-ornament .ag-orn');
    const capsule = page.locator('.ag-capsule .ag-orn--capsule');
    await ornament.focus();
    await expect(ornament).toBeFocused();
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(capsule).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(ornament).toBeFocused();
  },
);

test.describe('at 1100px, Pause in the capsule', () => {
  test.use({ viewport: { width: 1100, height: 900 } });
  test(
    "focused, Pause's and the Index's bands stay inside the capsule's padding box, the ring inside the band, each 44px tall",
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      for (const selector of ['.ag-capsule__index--live', '.ag-capsule .ag-orn--capsule']) {
        await tabTo(page, selector);
        const fit = await page.locator(selector).evaluate(bandFit);
        expect(fit.focused, selector).toBe(true);
        expect(fit.past, `${selector}: band past the capsule's padding box`).toBeLessThanOrEqual(
          0.5,
        );
        expect(fit.ringPast, `${selector}: ring past the band`).toBeLessThanOrEqual(0.5);
        expect(fit.height, `${selector}: height`).toBeGreaterThanOrEqual(44);
      }
    },
  );
  test(
    'pressing it stops the sky and the button says so: filled, its mark the triangle of play',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const pause = page.locator('.ag-capsule .ag-orn--capsule');
      await expect(pause).toBeVisible();
      await expect(page.locator('.ag-ornament .ag-orn')).toBeHidden();
      const look = () =>
        pause.evaluate((el) => ({
          background: getComputedStyle(el).backgroundColor,
          mark: getComputedStyle(el.querySelector('.ag-orn__mark')!).clipPath,
        }));
      const before = await look();
      await expect.poll(() => page.evaluate(loops)).toEqual(['running', 'running']);
      await pause.click();
      await expect(pause).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => page.evaluate(loops)).toEqual(['paused', 'paused']);
      // Off the button, so hover can't be what fills it, then the pressed rule's own colour.
      await page.mouse.move(4, 600);
      expect(await pause.evaluate((el) => el.matches(':hover'))).toBe(false);
      const pressedFill = await pause.evaluate((el) => {
        const probe = document.createElement('i');
        probe.style.backgroundColor = 'var(--color-text-primary)';
        el.closest('.ag')!.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      });
      // The fill transitions over the feedback duration: wait for it to land on that colour.
      await expect.poll(async () => (await look()).background).toBe(pressedFill);
      const after = await look();
      expect(after.mark).toMatch(/^polygon/);
      expect(before.mark).toBe('none');
      await pause.click();
      await expect(pause).toHaveAttribute('aria-pressed', 'false');
    },
  );
});

test.describe('between 56 and 64rem', () => {
  test.use({ viewport: { width: 960, height: 900 } });
  test(
    'a long Contact title stays inside the capsule, beside Pause and the ornament',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      // The words go in the call's own text span, so its wrap is what's tested (row 150: between
      // its words, never cut).
      const words = page.locator('.ag-capsule__cta-text');
      await words.evaluate((el) => {
        el.textContent = "Let's build something careful together";
      });
      const fit = await words.evaluate((el) => ({
        clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        ellipsis: getComputedStyle(el).textOverflow,
        cta: el.closest('a')!.getBoundingClientRect().right,
        pause: document.querySelector('.ag-capsule .ag-orn--capsule')!.getBoundingClientRect().left,
      }));
      expect(fit.clipped).toBe(false);
      expect(fit.ellipsis).toBe('clip');
      expect(fit.cta).toBeLessThanOrEqual(fit.pause);
      const box = await page.locator('.ag-capsule').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const kids = [...el.children].map((child) => child.getBoundingClientRect());
        return {
          right: rect.right,
          vw: document.documentElement.clientWidth,
          inside: kids.every(
            (kid) => kid.width === 0 || (kid.left >= rect.left - 1 && kid.right <= rect.right + 1),
          ),
        };
      });
      expect(box.inside).toBe(true);
      expect(box.right).toBeLessThanOrEqual(box.vw);
      // Pause is the capsule's last item here, its mark alone.
      const pause = page.locator('.ag-capsule .ag-orn--capsule');
      await expect(pause).toBeVisible();
      await expect(pause).toHaveAccessibleName('Pause the sky');
      // Under the chrome's 64em the destinations are in the Index (row 150).
      await expect(page.locator('.ag-capsule__dest')).toBeHidden();
      const ornament = await page
        .locator('.ag-ornament')
        .evaluate((el) => el.getBoundingClientRect().left);
      expect(ornament).toBeGreaterThanOrEqual(box.right);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    },
  );
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test(
    'no sideways scroll, and the capsule is the name and Menu',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.locator('.ag-capsule__index--live')).toHaveAccessibleName('Menu');
      // Focused, Menu's band and ring stay inside the capsule's padding box.
      await tabTo(page, '.ag-capsule__index--live');
      const fit = await page.locator('.ag-capsule__index--live').evaluate(bandFit);
      expect(fit.past).toBeLessThanOrEqual(0.5);
      expect(fit.ringPast).toBeLessThanOrEqual(0.5);
      expect(fit.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('.ag-capsule__dest')).toBeHidden();
    },
  );
});

// The settle signal (the capture race, 2026-11-03; @portfolio/variant-contract/settle): the kit's
// <Enhancement> renders an inert <template data-enhancement-pending="sky"> in its place until the
// enhancement has attached, and the sky holds its own, data-enhancement-pending="sky" on .ag-sky, until
// its observers' first deliveries. Both come off once the first pass has run, or once the kit has
// failed the enhancement, so a variant shot or a quality read waits on them (watchEnhancements()) and
// never hangs on them.
test.describe("the sky's settle signal", () => {
  const PENDING = `[${ENHANCEMENT_PENDING}]`;
  const live = (page: import('@playwright/test').Page) =>
    page.locator('.ag').evaluate((el) => el.hasAttribute('data-ag-live'));

  test(
    'the server renders the kit’s and the sky’s, and both come off once the page is live, with no hydration mismatch',
    { annotation },
    async ({ page, request }) => {
      const html = await (await request.get('/')).text();
      expect(html).toContain('<template data-enhancement-pending="sky"></template>');
      expect(html).toMatch(/class="ag-sky"[^>]*data-enhancement-pending="sky"/);
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      const watch = watchEnhancements(page);
      try {
        await page.goto('/');
        expect(await watch.settled(), 'the watch settles').toBe(true);
        await expect(page.locator(PENDING)).toHaveCount(0);
        // Off only once the first pass has run: the page is live, Pause is shown, the loops run.
        expect(await live(page)).toBe(true);
        await expect(page.getByRole('button', { name: 'Pause the sky' })).toBeVisible();
        // React reports a hydration mismatch as a console error (#418, #423 or #425 in production).
        expect(errors.filter((text) => /hydrat|#41[89]|#42[35]/i.test(text))).toEqual([]);
      } finally {
        watch.stop();
      }
    },
  );

  test(
    'with the enhancement’s chunk failing, the kit takes it off, so a capture never waits on it',
    { annotation },
    async ({ page, request }) => {
      // As failed enhancement takes the optional chunks away: every script chunk the HTML doesn't
      // load itself, the sky's among them.
      const html = await (await request.get('/')).text();
      const own = new Set(
        [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
          (match) => new URL(match[1]!, 'http://app.test').pathname,
        ),
      );
      let blocked = 0;
      await page.route('**/_next/static/chunks/**', (route) => {
        const asked = new URL(route.request().url()).pathname;
        if (route.request().resourceType() !== 'script' || own.has(asked)) return route.fallback();
        blocked += 1;
        return route.abort('blockedbyclient');
      });
      const watch = watchEnhancements(page);
      try {
        await page.goto('/');
        expect(await watch.settled(), 'the watch settles on a failed chunk').toBe(true);
        expect(blocked, 'optional chunks blocked').toBeGreaterThan(0);
        await expect(page.locator(PENDING)).toHaveCount(0);
        // Nothing ran: the page is the no-script one.
        expect(await live(page)).toBe(false);
      } finally {
        watch.stop();
      }
    },
  );

  test.describe('under reduced motion', () => {
    test('it comes off too, with the sky still', { annotation }, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const watch = watchEnhancements(page);
      try {
        await page.goto('/');
        expect(await watch.settled()).toBe(true);
        await expect(page.locator(PENDING)).toHaveCount(0);
        expect(await live(page)).toBe(true);
        await expect.poll(() => page.evaluate(loops)).toEqual([]);
      } finally {
        watch.stop();
      }
    });
  });

  test.describe('with JavaScript off', () => {
    test.use({ javaScriptEnabled: false });
    test('it stays in the markup, and nothing waits on it', { annotation }, async ({ page }) => {
      const watch = watchEnhancements(page);
      try {
        await page.goto('/');
        // The kit's template and the sky's hold.
        await expect(page.locator(PENDING)).toHaveCount(2);
        const started = Date.now();
        expect(await watch.settled()).toBe(true);
        expect(Date.now() - started).toBeLessThan(1_000);
      } finally {
        watch.stop();
      }
    });
  });
});
