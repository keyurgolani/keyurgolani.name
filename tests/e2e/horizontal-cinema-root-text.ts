import type { Page } from '@playwright/test';

// Horizontal Cinema's pages read with the root text at a given size, as the reflow reads do: what
// the window holds, and what reaches furthest past it.

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Loads `route`, sets the root text to `size`, and lets the layout settle. */
export async function open(page: Page, route: string, size: string) {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
    size,
  );
  await frames(page);
  await page.waitForTimeout(250);
  await frames(page);
}

/** The page's scroll width against the window, and what reaches furthest past it. */
export const reach = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    let furthest: { at: string; right: number } | null = null;
    for (const element of document.body.querySelectorAll('*')) {
      const right = element.getBoundingClientRect().right;
      if (right > html.clientWidth + 1 && (!furthest || right > furthest.right)) {
        const name = `${element.localName}${element.id ? `#${element.id}` : ''}${[
          ...element.classList,
        ]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('')}`;
        furthest = { at: name, right: Math.round(right) };
      }
    }
    return { scroll: html.scrollWidth, window: html.clientWidth, furthest };
  });

/**
 * With every record section open, what in the home's full record runs past the window's edge,
 * where its scene clips it out of sight: each such element's name and right edge, widest first.
 */
export async function pastTheRecord(page: Page) {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll<HTMLDetailsElement>('details[data-record]'))
      details.open = true;
  });
  await frames(page);
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth + 1;
    const past: { at: string; right: number }[] = [];
    for (const element of document.querySelectorAll('.hc-record *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= edge) continue;
      const name = `${element.localName}${element.id ? `#${element.id}` : ''}${[
        ...element.classList,
      ]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('')}`;
      past.push({ at: name, right: Math.round(box.right) });
    }
    return past.sort((a, b) => b.right - a.right).slice(0, 8);
  });
}
