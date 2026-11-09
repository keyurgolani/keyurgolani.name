// Row 127, Swiss Signal: what the poster-line specs read (swiss-signal-hero-fit, swiss-signal-hero-floor).

/** The poster line's display text: its size, body size, each word's line boxes, and whether it may hyphenate. */
export const readPoster = () => {
  const text = document.querySelector('.ss-poster__line .ss-poster__text')!;
  const line = text.closest('.ss-poster__line')!.getBoundingClientRect();
  const style = getComputedStyle(text);
  const probe = document.createElement('span');
  probe.style.fontSize = 'var(--type-body-font-size)';
  text.parentElement!.appendChild(probe);
  const body = parseFloat(getComputedStyle(probe).fontSize);
  // A word's width at the floor, on one line: the one case a break inside it is allowed.
  probe.style.cssText = `font-size:${body}px;white-space:nowrap;font-family:${style.fontFamily};font-weight:${style.fontWeight};text-transform:${style.textTransform};letter-spacing:${style.letterSpacing};position:absolute;visibility:hidden`;
  const words: { word: string; lines: number; right: number; atFloor: number }[] = [];
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index!);
      range.setEnd(node, match.index! + match[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      probe.textContent = match[0];
      words.push({
        word: match[0],
        lines: new Set(rects.map((r) => Math.round(r.top))).size,
        right: Math.max(...rects.map((r) => r.right)),
        atFloor: probe.getBoundingClientRect().width,
      });
    }
  }
  probe.remove();
  return {
    words,
    size: parseFloat(style.fontSize),
    body,
    hyphens: style.hyphens,
    lineLeft: line.left,
    lineRight: line.right,
  };
};

export const rootAt200 = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '200%', 'important'),
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
};
