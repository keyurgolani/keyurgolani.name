import type { Locator, Page } from '@playwright/test';
import { glyphHalo, worstRatio } from '../quality/lib/a11y/contrast';

// A text's contrast as the quality cells' contrast sampler reads it: its colour over the worst
// pixel of what's painted under and around its glyphs. Three shots of the element's content box
// (its border box less its borders and padding, inside the window), its glyphs black, white and
// transparent: the first two give the glyph mask, dilated by the sampler's halo (glyphHalo), and
// the third the background the text sits on, read inside that halo (worstRatio). Only what the box
// holds counts, as in the cells: a rule drawn outside it, a neighbour's border, isn't its ground.
// The text's own colour is its computed one, read before the shots.

const STYLE_ID = 'worst-pixel-ink';

export interface Ink {
  /** The text, trimmed. */
  readonly text: string;
  /** Its computed colour. */
  readonly color: string;
  /** Its worst ratio, or null when no glyph paints in its box. */
  readonly ratio: number | null;
}

/** `text`'s contrast against its worst background pixel, read as the cells read it. */
export async function inkOver(page: Page, text: Locator): Promise<Ink> {
  // Centred in the window, clear of a sticky bar at either edge.
  await text.evaluate((el) =>
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }),
  );
  const read = await text.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const px = (v: string) => Number.parseFloat(v) || 0;
    const left = Math.max(0, r.left + px(s.borderLeftWidth) + px(s.paddingLeft));
    const top = Math.max(0, r.top + px(s.borderTopWidth) + px(s.paddingTop));
    const right = Math.min(innerWidth, r.right - px(s.borderRightWidth) - px(s.paddingRight));
    const bottom = Math.min(innerHeight, r.bottom - px(s.borderBottomWidth) - px(s.paddingBottom));
    if (right - left < 1 || bottom - top < 1) return null;
    el.setAttribute('data-worst-pixel', '');
    return {
      text: (el.textContent ?? '').trim(),
      color: s.color,
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    };
  });
  if (!read) return { text: '', color: '', ratio: null };
  // The ground shot leaves every other text out too, as the cells' sampler leaves out a neighbour's
  // glyphs: a letter beside this text isn't its background.
  const shot = async (fill: string, others = false) => {
    await page.evaluate(
      ({ id, fill, others }) => {
        let style = document.getElementById(id);
        if (!style) {
          style = document.createElement('style');
          style.id = id;
          document.head.append(style);
        }
        const rest = others
          ? 'body *:not([data-worst-pixel]):not([data-worst-pixel] *) { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; transition: none !important; }'
          : '';
        style.textContent = `[data-worst-pixel], [data-worst-pixel] * { color: ${fill} !important; -webkit-text-fill-color: ${fill} !important; text-decoration-color: transparent !important; text-shadow: none !important; transition: none !important; caret-color: transparent !important; } ${rest}`;
      },
      { id: STYLE_ID, fill, others },
    );
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    return page.screenshot({ clip: read.clip, animations: 'disabled', caret: 'hide' });
  };
  try {
    const black = await shot('#000');
    const white = await shot('#fff');
    const ground = await shot('transparent', true);
    const halo = glyphHalo(black, white, read.clip);
    const ratio = halo && halo.glyphs > 0 ? worstRatio(ground, read.color, halo.inside) : null;
    return { text: read.text, color: read.color, ratio };
  } finally {
    await page.evaluate((id) => {
      document.getElementById(id)?.remove();
      document.querySelector('[data-worst-pixel]')?.removeAttribute('data-worst-pixel');
    }, STYLE_ID);
  }
}
