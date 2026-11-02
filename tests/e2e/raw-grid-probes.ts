// What Raw Grid's browser checks measure in the page, shared by its specs. Each runs in the
// page through page.evaluate, so it reaches nothing outside itself.

/** What a word scan found, and every word it measured (lower case), so a test can prove it read them. */
export interface WordScan {
  found: string[];
  measured: string[];
}

/**
 * Run in the page: every display, label, title or link word whose glyphs sit on two lines
 * (with `breaks`), and every one that runs past its cell or card, or past the page when it has
 * none (always).
 * - A word is what the browser keeps whole: the run between spaces (a no-break space joins)
 *   and after a hyphen or slash, which stays with the word before it, ending at dashes and
 *   Breakable's <wbr>s; with its punctuation, across the inline elements it spans, and with
 *   generated quote marks (::before, ::after) set as real text while it measures. So
 *   "RECORDINGS," and "engineer.”" are one word, and a comma, hyphen or closing quote that
 *   starts a line is a split.
 * - A new line is a glyph box below the one before it that starts before that one ends, in the
 *   line's direction: whatever the leading, so tight display lines count.
 * - Running prose is left out, since it may break a word too long for any line (a URL), but
 *   display text the kit sets as rich text is in: the thesis, a note, a fact, a decision, the
 *   reflection, a quote, a lone short text. An address's overflow is in, though it wraps at
 *   its own points. Text in a box that clips on purpose (an ellipsis) can't overflow it.
 */
export function brokenWords(options: { breaks: boolean }): WordScan {
  const root = document.querySelector('[data-variant]')!;
  const found = new Set<string>();
  const measured = new Set<string>();
  const page = document.documentElement.clientWidth;
  const DISPLAY =
    '.rg-thesis__lead, .rg-note, .rg-fact, .rg-t-title, .rg-reflect, .rg-quote, [data-wide="set"]';
  // Generated quote marks become real text while the scan runs, then go back.
  const made: Element[] = [];
  const hosts: Element[] = [];
  const hide = document.createElement('style');
  hide.textContent =
    '[data-probe-before]::before, [data-probe-after]::after { content: none !important; }';
  for (const element of root.querySelectorAll('*')) {
    for (const which of ['before', 'after'] as const) {
      const style = getComputedStyle(element, `::${which}`);
      const text = /^"((?:[^"\\]|\\.)+)"/.exec(style.content)?.[1];
      if (!text || style.display !== 'inline' || style.position !== 'static') continue;
      const span = document.createElement('span');
      span.textContent = text;
      if (which === 'before') element.prepend(span);
      else element.append(span);
      element.setAttribute(`data-probe-${which}`, '');
      made.push(span);
      hosts.push(element);
    }
  }
  document.head.append(hide);
  const newLine = (prev: DOMRect, next: DOMRect, rtl: boolean) =>
    next.top > prev.top + 0.25 * Math.min(prev.height, next.height) &&
    (rtl ? next.right > prev.left + 1 : next.left < prev.right - 1);
  const twoLines = (rects: DOMRect[], rtl: boolean) =>
    rects.some((rect, index) => index > 0 && newLine(rects[index - 1]!, rect, rtl));
  const narrow = (element: Element) => {
    for (let at: Element | null = element; at && at !== root; at = at.parentElement)
      if (at.getBoundingClientRect().width < 4) return true;
    return false;
  };
  const clipped = (element: Element, cell: Element | null) => {
    for (let at: Element | null = element; at && at !== root; at = at.parentElement) {
      if (getComputedStyle(at).overflowX !== 'visible') return true;
      if (at === cell) break;
    }
    return false;
  };
  // An inline-block, flex or grid item is its own box: the browser may break around it.
  const blockOf = (element: Element) => {
    let at: Element = element;
    while (at !== root && getComputedStyle(at).display === 'inline') at = at.parentElement!;
    return at;
  };
  const skipped = (host: Element) => {
    const prose = host.closest('.pf-rich-text');
    return (
      (prose !== null && prose.closest(DISPLAY) === null) ||
      host.closest('.rg-hidden, .rg-ticker, code, pre') !== null ||
      narrow(host)
    );
  };
  // Runs of text, each within one block box: its text nodes, and where each sits in the run.
  type Piece = { node: Text; start: number };
  const runs: { block: Element; text: string; pieces: Piece[] }[] = [];
  let run: (typeof runs)[number] | undefined;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      // A <wbr> or <br> is a break the browser may take, so a word ends there.
      if ((node.localName === 'wbr' || node.localName === 'br') && run) run.text += ' ';
      continue;
    }
    const text = node as Text;
    const host = text.parentElement;
    if (!host || !text.data.trim()) {
      if (run) run.text += text.data;
      continue;
    }
    if (skipped(host)) {
      if (run) run.text += ' ';
      continue;
    }
    const block = blockOf(host);
    if (!run || run.block !== block) {
      run = { block, text: '', pieces: [] };
      runs.push(run);
    }
    run.pieces.push({ node: text, start: run.text.length });
    run.text += text.data;
  }
  const at = (pieces: Piece[], index: number): [Text, number] => {
    let piece = pieces[0]!;
    for (const each of pieces) if (each.start <= index) piece = each;
    return [piece.node, Math.min(index - piece.start, piece.node.data.length)];
  };
  for (const { block, text, pieces } of runs) {
    const cell = block.closest('.rg-card, .rg-cell, .rg-index__col');
    const edge = (cell ?? root).getBoundingClientRect();
    const check = !clipped(block, cell);
    const address = block.closest('.rg-ink__addr') !== null;
    const rtl = getComputedStyle(block).direction === 'rtl';
    for (const match of text.matchAll(/[^ \t\n\r\f\-‐‒-—/]+[-‐/]?/g)) {
      if ([...match[0]].length < 2) continue;
      const range = document.createRange();
      range.setStart(...at(pieces, match.index));
      range.setEnd(...at(pieces, match.index + match[0].length - 1));
      range.setEnd(range.endContainer, range.endOffset + 1);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0.5);
      if (rects.length === 0) continue;
      measured.add(match[0].toLowerCase());
      const where = `${match[0]} in ${block.className || block.localName}`;
      const left = Math.max(edge.left, 0) - 1;
      const right = Math.min(edge.right, page) + 1;
      if (check && rects.some((rect) => rect.left < left || rect.right > right))
        found.add(`${where}: past its cell`);
      if (!options.breaks || address) continue;
      if (twoLines(rects, rtl)) found.add(`${where}: on two lines`);
    }
  }
  for (const span of made) span.remove();
  for (const host of hosts) host.removeAttribute('data-probe-before');
  for (const host of hosts) host.removeAttribute('data-probe-after');
  hide.remove();
  return { found: [...found], measured: [...measured] };
}

/**
 * Run in the page: each short call to action set on more than one line. A button, the big
 * link when it isn't an address, the second action and a card's way in are phrases: their
 * words keep one line at every width. A big link past sixteen characters is a sentence, which
 * may wrap by its words, as its fit allows (bigChars). A button that says an address (Breakable's
 * <wbr>s in it) wraps at the address's own points, as the big link's address does; brokenWords
 * still holds each piece of it whole.
 */
export function splitPhrases(): string[] {
  const root = document.querySelector('[data-variant]')!;
  const found: string[] = [];
  const newLine = (prev: DOMRect, next: DOMRect, rtl: boolean) =>
    next.top > prev.top + 0.25 * Math.min(prev.height, next.height) &&
    (rtl ? next.right > prev.left + 1 : next.left < prev.right - 1);
  const phrases = root.querySelectorAll(
    ".rg-btn, .rg-ink__big:not([data-case='sentence']), .rg-ink__second, .rg-case",
  );
  for (const phrase of phrases) {
    const words = phrase.textContent?.trim() ?? '';
    if (phrase.matches('.rg-ink__big') && [...words].length > 16) continue;
    if (phrase.matches('.rg-btn') && phrase.querySelector('wbr')) continue;
    const range = document.createRange();
    range.selectNodeContents(phrase);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0.5);
    const rtl = getComputedStyle(phrase).direction === 'rtl';
    if (rects.some((rect, index) => index > 0 && newLine(rects[index - 1]!, rect, rtl)))
      found.push(`${words} in ${phrase.className}: on two lines`);
  }
  return found;
}

/**
 * Run in the page: plant one of each split the scans must catch, in the page's own faces, at
 * tight display leading, inside the variant: a display word broken mid-word, a hyphen, a comma,
 * a generated closing quote and a link's mark each starting a line, and a call to action on two
 * lines. The mono boxes are sized in ch, so each break falls where it's meant to.
 */
export function plantSplits(): void {
  const root = document.querySelector('[data-variant]')!;
  const style = document.createElement('style');
  style.dataset.probePlant = '';
  style.textContent = `[data-probe-plant] .probe-quote::after { content: '”'; }
[data-probe-plant] .probe-mono { font-family: monospace; overflow-wrap: anywhere; }`;
  document.head.append(style);
  const plant = document.createElement('div');
  plant.className = 'rg-cell';
  plant.dataset.probePlant = '';
  plant.innerHTML = `
    <p class="rg-name" style="font-size: 48px; line-height: 0.9; inline-size: 5ch; overflow-wrap: anywhere">INFRASTRUCTURE</p>
    <p class="probe-mono" style="inline-size: 10ch">POSTMORTEM-KIT</p>
    <p class="probe-mono" style="inline-size: 10ch">RECORDINGS, VOL</p>
    <p class="probe-mono probe-quote" style="inline-size: 8ch">engineer</p>
    <p><a href="#" style="display: block; inline-size: 8.5ch; padding: 0; font-family: monospace">MASTODON<span class="rg-out" aria-hidden="true">↗</span></a></p>
    <p><a class="rg-btn" style="display: inline-block; inline-size: 6ch; font-family: monospace" href="#">Email me</a></p>`;
  root.prepend(plant);
}

/** Run in the page: take out what plantSplits put in. */
export function clearSplits(): void {
  for (const planted of document.querySelectorAll('[data-probe-plant]')) planted.remove();
}

/**
 * Run in the page: each case cell the field's width whose content fills under 70% of it, once
 * it's more than a line or two (a sentence, not a stretched card).
 */
export function thinCells(): string[] {
  const root = document.querySelector('[data-variant]')!;
  const field = root.querySelector('.rg-casepage')!.getBoundingClientRect();
  return [...root.querySelectorAll<HTMLElement>('.rg-casepage .rg-cell')].flatMap((cell) => {
    const box = cell.getBoundingClientRect();
    if (box.width < field.width * 0.9 || cell.matches('.rg-band__head')) return [];
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('.rg-hidden')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
    }
    for (const shown of cell.querySelectorAll('img, .pf-media-box, .rg-note, table'))
      rects.push(shown.getBoundingClientRect());
    if (rects.length === 0) return [`${cell.className}: empty`];
    const span =
      Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left));
    const tall =
      Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top));
    return span < box.width * 0.7 && tall > 80
      ? [`${cell.className}: content ${Math.round(span)} of ${Math.round(box.width)} px`]
      : [];
  });
}

/**
 * Run in the page on the focused element: whether it shows a focus ring, and the ring's lowest
 * contrast against what it lies on, sampled at the middle of each of its four sides: a parent's
 * rule where the ring crosses one, else the nearest painted ground. A translucent ring or ground
 * is composited over what's under it.
 */
export function ringContrast(element: Element) {
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgba = (color: string) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    return [...paint.getImageData(0, 0, 1, 1).data];
  };
  const over = (top: number[], under: number[]) => {
    const alpha = top[3]! / 255;
    return [0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)).concat(255);
  };
  const luminance = (color: number[]) => {
    const [r, g, b] = color.slice(0, 3).map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  // What the point lies on: the innermost ancestor holding it, its rule if the point is in
  // one, else its ground once painted; translucent grounds stack over the ones outside them.
  const groundAt = (x: number, y: number) => {
    const layers: number[][] = [];
    for (let at = element.parentElement; at; at = at.parentElement) {
      const box = at.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const style = getComputedStyle(at);
      const sides = [
        [y - box.top, style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
        [box.bottom - y, style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
        [x - box.left, style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
        [box.right - x, style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
      ] as const;
      const rule = sides.find(
        ([inset, width, kind]) => kind !== 'none' && inset < parseFloat(width),
      );
      const color = rgba(rule ? rule[3] : style.backgroundColor);
      if (color[3]! > 0) layers.push(color);
      if (color[3] === 255) break;
    }
    return layers.reduceRight((under, top) => over(top, under), [255, 255, 255, 255]);
  };
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const out = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) / 2;
  const [midX, midY] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
  const points = [
    [midX, box.top - out],
    [midX, box.bottom + out],
    [box.left - out, midY],
    [box.right + out, midY],
  ];
  const ratios = points.map(([x, y]) => {
    const under = groundAt(x!, y!);
    const [ring, ground] = [luminance(over(rgba(style.outlineColor), under)), luminance(under)];
    return (Math.max(ring, ground) + 0.05) / (Math.min(ring, ground) + 0.05);
  });
  return {
    visible: element.matches(':focus-visible'),
    style: style.outlineStyle,
    width: parseFloat(style.outlineWidth),
    ratio: Math.min(...ratios),
  };
}

/**
 * Run in the page: every box that runs past the page's right edge, outside any box that clips
 * it on purpose, deepest last, so a sideways scroll names what makes it.
 */
export function pastPage(): string[] {
  const width = document.documentElement.clientWidth;
  const found: string[] = [];
  for (const element of document.querySelectorAll('body *')) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.right <= width + 1) continue;
    let clipped = false;
    for (let at = element.parentElement; at && at !== document.body; at = at.parentElement)
      if (getComputedStyle(at).overflowX !== 'visible') clipped = true;
    if (!clipped)
      found.push(
        `${element.localName}${[...element.classList].map((name) => `.${name}`).join('')}: ${Math.round(box.right)} of ${width}`,
      );
  }
  return found.slice(-15);
}

/**
 * Run in the page: when the page scrolls sideways, what makes it, as the quality probe reads it
 * (the scrolling element's scroll width past the root's client width): the chain of elements,
 * from the body down, each the first child whose hiding ends the scroll. Empty when nothing
 * scrolls. It finds a pseudo-element's or a clipped box's overflow too, by its host.
 */
export function sidewaysCause(): string[] {
  const scroller = document.scrollingElement!;
  const width = document.documentElement.clientWidth;
  const over = () => scroller.scrollWidth > width + 1;
  if (!over()) return [];
  const chain = [`html: ${scroller.scrollWidth}px in ${width}px`];
  let parent: Element = document.body;
  for (;;) {
    let cause: HTMLElement | undefined;
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement)) continue;
      const before = child.style.getPropertyValue('display');
      const priority = child.style.getPropertyPriority('display');
      child.style.setProperty('display', 'none', 'important');
      const ends = !over();
      if (before) child.style.setProperty('display', before, priority);
      else child.style.removeProperty('display');
      if (ends) {
        cause = child;
        break;
      }
    }
    if (!cause) break;
    const box = cause.getBoundingClientRect();
    chain.push(
      `${cause.localName}${[...cause.classList].map((name) => `.${name}`).join('')} (${Math.round(box.left)} to ${Math.round(box.right)})`,
    );
    parent = cause;
  }
  return chain;
}

/**
 * Run in the page: each element in the variant that draws an absolutely placed pseudo-element
 * with a ground (a color or an image) over more than a quarter of a text it holds. axe can't
 * read a text's ground through one (its pseudoContent), so every text under it goes to the
 * quality cell's sampler, a screenshot walk of about half a second a text: Raw Grid's board,
 * as main's and the foot's ::before, sent 338 texts there and ran the cell past its 240 s on
 * CI (run 41510373684).
 */
export function groundedPseudos(): string[] {
  const root = document.querySelector('[data-variant]')!;
  const found = new Set<string>();
  const texts: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.textContent?.trim() && node.parentElement) texts.push(node.parentElement);
  const area = (element: Element, which: '::before' | '::after') => {
    const style = getComputedStyle(element, which);
    if (['none', 'normal'].includes(style.content) || style.display === 'none') return 0;
    if (style.visibility === 'hidden' || style.position !== 'absolute') return 0;
    const clear = /rgba\(.*,\s*0\)$|transparent/.test(style.backgroundColor);
    if (clear && style.backgroundImage === 'none') return 0;
    return parseFloat(style.width) * parseFloat(style.height);
  };
  for (const text of new Set(texts)) {
    const box = text.getBoundingClientRect();
    if (box.width * box.height === 0) continue;
    for (let at: Element | null = text; at && at !== root.parentElement; at = at.parentElement)
      for (const which of ['::before', '::after'] as const)
        if (area(at, which) > 0.25 * box.width * box.height)
          found.add(`${at.localName}.${[...at.classList].join('.')}${which}`);
  }
  return [...found];
}
