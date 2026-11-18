import type { Page } from '@playwright/test';

// A look shot of one element, for the look specs a fix's proof runs at its base and its head: the
// element scrolled to the window's top, two frames drawn, and the box round it, `pad` px out, as
// wide as the page scrolls, so what runs past the window shows. The window's own fixed and sticky
// boxes, a pinned Index or a sticky bar, are hidden for the capture: they belong to the window,
// not to the element, and a capture paints them wherever the scroll left them, so a pair at the
// base and the head would hold them on one side only. A sticky or fixed box that holds the element,
// or that the element holds, stays.

const HIDDEN = 'data-look-shot-hidden';

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
  await target.evaluate((element, hidden) => {
    for (const each of document.querySelectorAll('body *')) {
      if (each === element || each.contains(element) || element.contains(each)) continue;
      const { position } = getComputedStyle(each);
      if (position === 'fixed' || position === 'sticky') each.setAttribute(hidden, '');
    }
    const style = document.createElement('style');
    style.setAttribute(hidden, '');
    style.textContent = `[${hidden}] { visibility: hidden !important; }`;
    document.head.append(style);
  }, HIDDEN);
  try {
    await frames(page);
    const box = (await target.boundingBox())!;
    const { scrollY, width } = await page.evaluate(() => ({
      scrollY: window.scrollY,
      width: document.documentElement.scrollWidth,
    }));
    return await page.screenshot({
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      clip: { x: 0, y: Math.max(0, box.y + scrollY - pad), width, height: box.height + 2 * pad },
    });
  } finally {
    await page.evaluate((hidden) => {
      for (const each of document.querySelectorAll(`[${hidden}]`)) {
        if (each.tagName === 'STYLE') each.remove();
        else each.removeAttribute(hidden);
      }
    }, HIDDEN);
  }
}
