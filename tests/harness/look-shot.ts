import type { Page } from '@playwright/test';

// A look shot of one element, for the look specs a fix's proof runs at its base and its head: the
// element scrolled to the window's top, two frames drawn, and the box round it, `pad` px out.

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** The first element `selector` matches, shot with `pad` px of the page round it. */
export async function elementShot(
  page: Page,
  selector: string,
  { pad = 16 }: { readonly pad?: number } = {},
): Promise<Buffer> {
  const target = page.locator(selector).first();
  await target.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await frames(page);
  const box = (await target.boundingBox())!;
  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: {
      x: 0,
      y: Math.max(0, box.y - pad),
      width: await page.evaluate(() => window.innerWidth),
      height: box.height + 2 * pad,
    },
  });
}
