import { expect, test } from '../harness/fixtures';
import { completeThrough, twoFrames, type Delivered } from './observer-deliveries';
import {
  heldFor,
  holdableObserverDeliveries,
  holdDeliveriesFor,
  releaseDeliveries,
} from './observer-hold';

// Editorial Evidence's chapter rail, beside the head column, stays folded until it docks at its
// sticky top and is watched for the heads under it once it has, whatever the order its observer's
// entries arrive in. A page that goes down to where the rail docks and back to the top before the
// observer's task runs delivers both entries in one call, oldest first; read from the first, the
// rail took itself for docked at the top of the issue and left its fold. The rail's observer is
// held here while the page goes to the first chapter's opener and back (observer-hold.ts), so its
// one delivery holds the rail docked and then not; every other observer delivers as it goes. At
// the opener the place being read has no hanging head, so the rail's sticky top stays where it
// was, and its observer with it.

test.use({
  appOptions: completeThrough('editorial-evidence'),
  viewport: { width: 1440, height: 900 },
});

/** Docked: the rail's box is cut by the band under its sticky top, above that band's top. */
const docked = (entry: Delivered) =>
  entry.ratio < 1 && entry.rootTop !== null && entry.top < entry.rootTop;

test(
  "with the rail's observer's entries delivered together, the rail stays folded at the top of the issue, after a visit down to where it docks",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await holdableObserverDeliveries(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const rail = page.locator('.ee-rail');
    // At the top of the issue the rail is folded, watched by one observer of its own, made again
    // once the running head first sets the hanging head's height; read once that's done.
    await expect(rail).toHaveAttribute('data-ee-yield', 'fold');
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector<HTMLElement>('.ee-issue')!
            .style.getPropertyValue('--layout-ee-head-h'),
        ),
      )
      .not.toBe('');
    await twoFrames(page);
    await page.waitForTimeout(300);
    await expect.poll(async () => (await heldFor(page, '.ee-rail')).length).toBe(1);
    const id = (await heldFor(page, '.ee-rail'))[0]!.id;
    // Held, down to the first chapter's opener just under the reading line and back to the top.
    await holdDeliveriesFor(page, '.ee-rail');
    const stuck = await page.evaluate(async () => {
      const frames = () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100))),
        );
      const spy = document.querySelector<HTMLElement>('.ee-spy')!;
      const line = Math.ceil(Number.parseFloat(getComputedStyle(spy).paddingBlockStart) || 0);
      const opener = document.querySelector<HTMLElement>('[data-ee-chapter] .ee-chapter__open')!;
      window.scrollTo({
        top: window.scrollY + opener.getBoundingClientRect().top - line + 8,
        behavior: 'instant',
      });
      await frames();
      const rail = document.querySelector<HTMLElement>('.ee-rail')!;
      const at = rail.getBoundingClientRect().top;
      const top = Number.parseFloat(getComputedStyle(rail).insetBlockStart);
      window.scrollTo({ top: 0, behavior: 'instant' });
      await frames();
      return { at, top };
    });
    expect(
      Math.abs(stuck.at - stuck.top),
      `at the opener, the rail sits at its sticky top: ${JSON.stringify(stuck)}`,
    ).toBeLessThan(1);
    // The same observer still watches the rail, and holds it docked and then not.
    const watching = await heldFor(page, '.ee-rail');
    expect(
      watching.map((each) => each.id),
      "the rail's observer, not made again",
    ).toEqual([id]);
    const held = watching[0]!.held;
    expect(
      held.length > 1 && held.some(docked) && !docked(held.at(-1)!),
      `the held entries, docked and then not: ${JSON.stringify(held)}`,
    ).toBe(true);
    // In one call: the rail reads the latest, and stays folded.
    await releaseDeliveries(page);
    await twoFrames(page);
    await expect(rail).toHaveAttribute('data-ee-yield', 'fold');
  },
);
