import type { Page } from '@playwright/test';

/** Each scene's bar, and each thing in a bar, that runs past its scene's sides, with both boxes. */
export function pastTheirScene(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const r = (n: number) => Math.round(n * 10) / 10;
    const out: string[] = [];
    for (const scene of document.querySelectorAll<HTMLElement>('.hc-scene')) {
      if (scene.getClientRects().length === 0) continue;
      const s = scene.getBoundingClientRect();
      for (const bar of scene.querySelectorAll<HTMLElement>(':scope > .hc-bar')) {
        for (const el of [bar, ...bar.children]) {
          if (el.getClientRects().length === 0) continue;
          const b = el.getBoundingClientRect();
          if (b.left >= s.left - 0.5 && b.right <= s.right + 0.5) continue;
          out.push(
            `${el.className || el.localName} "${(el.textContent ?? '').trim().slice(0, 32)}" in #${scene.id}: ${r(b.left)} to ${r(b.right)}, its scene ${r(s.left)} to ${r(s.right)}`,
          );
        }
      }
    }
    return out;
  });
}

/** Each bottom bar's credit or note, words and all, that has given way to nothing: no width left. */
export function creditsGone(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const bar of document.querySelectorAll<HTMLElement>('.hc-scene > .hc-bar--bottom')) {
      const first = bar.firstElementChild;
      if (!first || first.getClientRects().length === 0) continue;
      const words = (first.textContent ?? '').trim();
      if (!words) continue;
      const width = first.getBoundingClientRect().width;
      if (width > 0.5) continue;
      out.push(`"${words.slice(0, 32)}" in #${bar.closest('.hc-scene')!.id}: ${width} px wide`);
    }
    return out;
  });
}
