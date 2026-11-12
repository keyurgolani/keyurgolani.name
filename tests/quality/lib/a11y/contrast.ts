// Contrast where axe can't tell (#11, Slice 2, item 1, and the owner's
// [37]): text over a gradient, an image, a translucent surface, or a
// canvas comes back from axe's color-contrast rule as incomplete. Each such
// element is sampled with its glyphs hidden, and its text color, laid over
// every background pixel round its glyphs, must reach the text or
// large-text ratio of quality/thresholds.json against the worst one. One it
// can't sample fails too, so an incomplete result never passes by default.
//
// Round its glyphs is their mask dilated by HALO, inside its content box
// (the lead's ruling, 2026-10-28): decoration that touches or crowds a
// letter, a star, a dot, a rim or a rule, is its background, and decoration
// elsewhere in the box isn't. The mask is the text's own paint: the same
// clip shot twice more, the glyphs filled black and then white over the
// real background, everything else as the background shot has it, and the
// pixels where the two differ by GLYPH_COVERAGE in every channel. A text
// with no glyph pixel in its box is unresolved.
// Where the element renders high contrast, by its own presentation
// boundary's display mode or contrast, or by prefers-contrast: more, the
// ratios are the file's highContrast ones, 7 and 4.5, and axe's AAA rule,
// color-contrast-enhanced, runs beside color-contrast (run-cell.ts): its
// incomplete items come here with color-contrast's, each element once.
//
// Its neighbours' glyphs at the box's edge are hidden too (neighbourTexts):
// another in-flow text whose line box overlaps the sampled box by no more
// than NEIGHBOUR_MARGIN, across on the same line or down from the line
// above or below. A glyph with no side bearing, such as an en dash in an
// Arial-metric font right before a date, paints its antialiased edge inside
// the date's box, and that edge isn't the date's background. Text that
// overlaps the box further, or covers it, or sits out of flow (absolute or
// fixed), is the element's backdrop, such as a large numeral behind a
// heading, so it stays and is measured. The mark goes on the neighbour
// text's parent element and hides by fill alone, so no layout moves and no
// currentColor border or icon changes; the parent's own pseudo-element text
// is hidden with it, which only matters inside the edge band. Every mark,
// and the style that hides them, carries one call's key and comes off
// after each sample and when the call ends.
//
// What's painted over the box isn't its background when it's stuck: a
// fixed or sticky header or dock the element doesn't sit in, which a
// visitor scrolls out from under (covers.ts). The sampler scrolls
// the box clear of it, by the cover's edge and COVER_GAP, and reads again;
// one that still covers it leaves the box unresolved, which fails as one
// it can't sample, never as a ratio. A box its transforms or an ancestor's
// rotate or skew is sampled inside its own content quad (insideQuad), not
// the axis-aligned clip round it, whose corners hold its parent's paint;
// one in 3D, or split across lines, is unresolved.
//
// Its box is read, and its three shots taken, once what moves it has come
// to rest (stillnessScript): an arrival its scroll into view sets off, on it
// or on an ancestor, time-based or scroll-driven, would otherwise move it
// between its box's read and its shots, which end every finite animation
// and cancel the rest, and its glyphs would paint off the box. Only an
// animation that can move or repaint it counts (MOVES, PAINTS on the node
// itself, and INHERITED_PAINTS on an ancestor whose value reaches it).
// NODE_LIMIT_MS at most: one with an infinite time-based
// animation, or one still moving then, is unresolved, saying which. At rest,
// a counted scroll-driven animation's guarded values are pinned inline for
// the shots, which would cancel it, and its target's style attribute is put
// back as it was once the element is read (releaseScript).

import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../../quality/thresholds';
import { blend, contrast, decodePng, encodePng, parseCssColor, pixel, type Image } from '../pixels';
import type { AxeResults } from '../records';
import { nodeSelector } from '../records';
import { clearOfStuckCovers, stuckCoverScript } from './covers';
import type { Finding } from './interaction';

const thresholds = loadThresholds();
const PX_PER_PT = 4 / 3;

/**
 * The longest the sampler gives one element at each step: its scroll into
 * view, its read, and its animations' end.
 */
export const NODE_LIMIT_MS = 2_000;

/**
 * The style that hides one call's marks, the sampled element's glyphs by
 * color and a neighbour's by fill, and that fills the element's glyphs
 * black or white, by its data-quality-mask, for its mask: by fill and
 * decoration alone, so a currentColor border or icon stays hidden in both.
 * A decoration an ancestor paints goes too (row 157): an ancestor's
 * underline, overline or line-through propagates to the element's text, in
 * the ancestor's decoration color, so hiding the element's own leaves it
 * under the glyphs, read as background (an underlined link's words in an
 * inline span read 1:1). Every ancestor's, since a decoration propagates
 * through block containers too; it's a line along text alone, so no
 * background goes with it.
 */
const hideCss = (key: string) =>
  `[data-quality-glyphs="${key}"], [data-quality-glyphs="${key}"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; } :has([data-quality-glyphs="${key}"]) { text-decoration-color: transparent !important; } [data-quality-neighbours="${key}"], [data-quality-neighbours="${key}"] * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }${(
    ['black', 'white'] as const
  )
    .map((fill) => {
      const marked = `[data-quality-glyphs="${key}"][data-quality-mask="${fill}"]`;
      return ` ${marked}, ${marked} * { -webkit-text-fill-color: ${fill} !important; text-decoration-color: ${fill} !important; } ${marked}:is(text, tspan), ${marked} :is(text, tspan) { fill: ${fill} !important; }`;
    })
    .join('')}`;

/**
 * The properties whose animation, on the element, an ancestor or a
 * descendant, moves or repaints its glyphs, as getKeyframes() names them:
 * the transforms, offset-* (`cssOffset` is the shorthand), opacity, filter
 * and clip-path.
 */
export const MOVES =
  /^(?:transform|translate|rotate|scale|cssOffset|offset[A-Z]\w*|opacity|filter|clipPath)$/;

/** The properties whose animation repaints its glyphs or what's under them on the element itself. */
export const PAINTS = /^(?:color|background(?:[A-Z]\w*)?)$/;

/**
 * The inherited paint properties: an ancestor's animation of one repaints the
 * element's glyphs when it reaches them, that is when the element's own value
 * is the ancestor's, inherited down every element between (none sets its own).
 * The sampler reads the text's color from its computed style when it reads the
 * element (sampleScript(), the `color` it returns), outside the shots, so a
 * tab's color transition its word inherits, read part-way, puts the word near
 * its ground's color (Flux's .fx-tab__word, 1.00:1); hence the wait.
 * stillnessScript() and restlessScript() carry the same pattern inline, since
 * each runs in the page on its own; both paths call them, so they agree.
 *
 * The ground needs no wait: it's read off shots taken with animations
 * disabled, which end every finite animation and transition, so an ancestor's
 * background moving between two states is shot at its end, as a visitor sees
 * it at rest. What still doesn't count is an ancestor's animation of a
 * property that neither moves the glyphs (MOVES) nor paints them (the
 * element's own PAINTS, and the inherited color here), such as an outline's
 * color or a custom property, which can't change the sampled pixels.
 *
 * Ending them can move the page on, though, past the color read before: a
 * script that turns the text's color as a transition goes, by a timeout or
 * on its end, turns it while the shots are taken, or after, when the
 * transition would have ended (Flux's drop, row 25). So the color is read
 * again once the shots are taken and that time has passed (inkScript(),
 * shotEndsScript()), and one that turned is read once more, the page at rest
 * first (pageRestScript()), or unresolved (inkUnresolved()).
 */
export const INHERITED_PAINTS = /^color$/;

/**
 * What still moves an element once the sampler gives up, or null once it
 * holds still: an infinite time-based animation, one still running or a
 * scroll-driven one still changing at the limit, or a scroll-driven one at
 * rest whose values its inline pin can't hold for the shots; or the wait
 * itself failing (the element detached, its context gone), which fails
 * closed: a node the wait couldn't see come to rest is never sampled.
 */
export type Motion = {
  readonly kind: 'infinite' | 'running' | 'scrolling' | 'unholdable' | 'failed';
  readonly name: string;
} | null;

/**
 * Waits, up to `limit` ms, for what moves `el` to come to rest, after one
 * frame at least, so that what its scroll into view set off has begun (a
 * scroll-driven animation still reads its old progress straight after the
 * scroll): every time-based finite animation finished or idle, and every
 * scroll-driven one (on a ScrollTimeline or ViewTimeline) at the same
 * progress for two frames, where a visitor sees it, since one never
 * finishes while its element rests part-way through its range. It counts
 * the animations whose target is `el`, an ancestor, or a descendant (a
 * pseudo-element's by its owner), that animate a property in `moves`, or
 * in `paints` on `el` itself, or an inherited paint (INHERITED_PAINTS) on an
 * ancestor whose value reaches `el`, inherited down every element between;
 * an ancestor's on anything else, or a sibling's, doesn't count.
 *
 * At rest, it pins each counted scroll-driven animation's guarded
 * properties (those its keyframes name that count) inline, !important, at
 * their values then: the shots cancel a scroll-driven animation, whose end
 * isn't a time, and would show its target un-animated, off the box read
 * now. Each target's style attribute as it was before its first pin, it
 * keeps on the window under `__qualityHeld_<key>` for releaseScript(). A
 * value the pin doesn't hold, read back, makes it unholdable. Null once it rests and is pinned;
 * else what still moves it: an infinite time-based animation at once, or
 * the first still running at the limit. Runs in the browser.
 */
export function stillnessScript(
  el: Element,
  {
    limit,
    moves,
    paints,
    key,
  }: {
    readonly limit: number;
    readonly moves: string;
    readonly paints: string;
    readonly key: string;
  },
): Promise<Motion> {
  const [moving, painting] = [new RegExp(moves), new RegExp(paints)];
  const frame =
    (window as unknown as { __qualityRaf?: typeof requestAnimationFrame }).__qualityRaf ??
    requestAnimationFrame;
  // A ScrollTimeline, or a ViewTimeline, which extends it; the DOM types don't name it yet.
  const Scrolling = (globalThis as unknown as { ScrollTimeline?: abstract new () => object })
    .ScrollTimeline;
  const scrolled = (animation: Animation) =>
    Scrolling !== undefined && animation.timeline instanceof Scrolling;
  const named = (animation: Animation) =>
    (animation as CSSAnimation).animationName ??
    ((animation as CSSTransition).transitionProperty
      ? `a transition of ${(animation as CSSTransition).transitionProperty}`
      : animation.id || 'unnamed');
  // INHERITED_PAINTS, inline: this runs in the page on its own.
  const inheriting = /^color$/;
  // Whether an ancestor's value of an inherited paint reaches `el`: every element from `el` up to
  // it computes its parent's color, so none between sets its own. A pseudo-element's doesn't.
  const reaches = (effect: KeyframeEffect, target: Element): boolean => {
    if (effect.pseudoElement || target === el || !target.contains(el)) return false;
    for (let node: Element = el; node !== target; node = node.parentElement!) {
      if (getComputedStyle(node).color !== getComputedStyle(node.parentElement!).color)
        return false;
    }
    return true;
  };
  // The properties of `animation` that count for `el`, as getKeyframes() names them.
  const guarded = (animation: Animation): string[] => {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !effect.target) return [];
    const target = effect.target;
    if (target !== el && !target.contains(el) && !el.contains(target)) return [];
    const properties = new Set<string>();
    for (const keyframe of effect.getKeyframes()) {
      for (const property of Object.keys(keyframe)) {
        if (
          moving.test(property) ||
          (target === el && painting.test(property)) ||
          (inheriting.test(property) && reaches(effect, target))
        )
          properties.add(property);
      }
    }
    return [...properties];
  };
  // getKeyframes()'s name for a property as CSS writes it: cssOffset is offset.
  const css = (property: string) =>
    property === 'cssOffset' ? 'offset' : property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const pin = (animations: readonly Animation[]): Motion => {
    // Each target's style attribute as it was, null when it had none, before its first pin.
    const held: { target: Element; style: string | null }[] = [];
    (window as unknown as Record<string, unknown>)[`__qualityHeld_${key}`] = held;
    const wanted: { target: Element; property: string; value: string; name: string }[] = [];
    // Every value read first, at rest, before any pin can change another's.
    for (const animation of animations) {
      const target = (animation.effect as KeyframeEffect).target!;
      const style = getComputedStyle(target);
      for (const property of guarded(animation).map(css))
        wanted.push({
          target,
          property,
          value: style.getPropertyValue(property),
          name: named(animation),
        });
    }
    // The pins are the sampler's own writes, never the page's changes (watchTurnsScript(), under
    // the call's key, the batch's `<key>_<at>` cut to it).
    const own = (window as unknown as Record<string, unknown>)[
      `__qualityTurnsOwn_${key.split('_')[0]}`
    ] as { take: () => void; drop: () => void } | undefined;
    own?.take();
    try {
      for (const { target, property, value, name } of wanted) {
        const inline = (target as HTMLElement).style;
        if (!inline) return { kind: 'unholdable', name };
        if (!held.some((each) => each.target === target))
          held.push({ target, style: target.getAttribute('style') });
        inline.setProperty(property, value, 'important');
        if (
          inline.getPropertyValue(property) === '' ||
          getComputedStyle(target).getPropertyValue(property) !== value
        )
          return { kind: 'unholdable', name };
      }
    } finally {
      own?.drop();
    }
    return null;
  };
  return new Promise((done) => {
    const last = new Map<Animation, { progress: number | null | undefined; held: number }>();
    let left: Motion = null;
    let over = false;
    const finish = (motion: Motion) => {
      over = true;
      clearTimeout(late);
      done(motion);
    };
    const late = setTimeout(() => finish(left ?? { kind: 'running', name: 'unnamed' }), limit);
    const look = () => {
      if (over) return;
      left = null;
      const counted = document.getAnimations().filter((each) => guarded(each).length > 0);
      for (const animation of counted) {
        if (scrolled(animation)) {
          const progress = animation.effect?.getComputedTiming().progress;
          const before = last.get(animation);
          const held = before && before.progress === progress ? before.held + 1 : 0;
          last.set(animation, { progress, held });
          if (held < 2) left ??= { kind: 'scrolling', name: named(animation) };
        } else if (animation.effect?.getComputedTiming().iterations === Infinity) {
          finish({ kind: 'infinite', name: named(animation) });
          return;
        } else if (animation.playState !== 'finished' && animation.playState !== 'idle') {
          left ??= { kind: 'running', name: named(animation) };
        }
      }
      if (left === null) finish(pin(counted.filter(scrolled)));
      else frame(look);
    };
    frame(() => frame(look));
  });
}

/**
 * Takes off what stillnessScript() pinned under `key`: each target's style
 * attribute as it was, byte for byte, or none if it had none. Runs in the
 * browser. A write the page itself makes to the same style attribute while
 * the pins hold (a layout custom property a script sets, say) is overwritten
 * too: the hold lasts the three shots, a few milliseconds, and only the test's
 * page sees it.
 */
export function releaseScript(key: string): void {
  const name = `__qualityHeld_${key}`;
  const held = (window as unknown as Record<string, unknown>)[name] as
    { target: Element; style: string | null }[] | undefined;
  // The release is the sampler's own write too (stillnessScript()'s pins).
  const own = (window as unknown as Record<string, unknown>)[
    `__qualityTurnsOwn_${key.split('_')[0]}`
  ] as { take: () => void; drop: () => void } | undefined;
  own?.take();
  try {
    for (const { target, style } of held ?? []) {
      // Reading the attribute first writes the pins' CSSOM changes into it, which the engine may
      // otherwise do after the restore, as an empty style="".
      void target.getAttribute('style');
      if (style === null) target.removeAttribute('style');
      else target.setAttribute('style', style);
    }
  } finally {
    own?.drop();
  }
  delete (window as unknown as Record<string, unknown>)[name];
}

/** A box in the viewport, in CSS pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Another text near a sampled box: its line boxes, and whether it's out of flow (absolute or fixed). */
export interface NearText {
  readonly rects: readonly Box[];
  readonly outOfFlow: boolean;
}

/**
 * How far another text's line box may overlap a sampled box, or stop short
 * of it, and still be an edge to hide, in CSS pixels: a glyph's antialiased
 * edge, or a little overhang.
 */
export const NEIGHBOUR_MARGIN = 2;

/**
 * Whether `rect` paints only into `box`'s edge band: beside it on the same
 * line, overlapping it across by at most NEIGHBOUR_MARGIN, or above or below
 * it, overlapping it down by at most that, a gap within the margin counting
 * too. A rect that overlaps further both ways, or covers the box, doesn't.
 */
export function reaches(rect: Box, box: Box): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const m = NEIGHBOUR_MARGIN;
  const across = Math.min(rect.x + rect.width, box.x + box.width) - Math.max(rect.x, box.x);
  const down = Math.min(rect.y + rect.height, box.y + box.height) - Math.max(rect.y, box.y);
  const edge = (overlap: number) => overlap > -m && overlap <= m;
  return (edge(across) && down > -m) || (edge(down) && across > -m);
}

/** The other texts, by index, to hide while `box` is sampled: each in-flow one with a line box at its edge. */
export function neighbourTexts(texts: readonly NearText[], box: Box): number[] {
  return texts.flatMap((text, at) =>
    !text.outOfFlow && text.rects.some((rect) => reaches(rect, box)) ? [at] : [],
  );
}

/** axe's AA contrast rule, and its AAA one, which runs where the page renders high contrast. */
export const CONTRAST_RULE = 'color-contrast';
export const ENHANCED_CONTRAST_RULE = 'color-contrast-enhanced';

/** Whether text is held to the normal ratios or to quality/thresholds.json's highContrast ones. */
export type ContrastMode = 'normal' | 'high-contrast';

/** The query under which every boundary renders high contrast, as the platform stylesheet has it. */
export const MORE_CONTRAST = '(prefers-contrast: more)';

/** A presentation boundary that renders high contrast: the mode, or data-contrast="more". */
export const HIGH_CONTRAST_BOUNDARY =
  '[data-appearance-boundary][data-display-mode="high-contrast"], [data-appearance-boundary][data-contrast="more"]';

interface Sample {
  readonly color: string;
  /** What the element's own boundary renders, or prefers-contrast: more for the whole page. */
  readonly mode: ContrastMode;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly box: Box;
  /** The other texts near the box, in the order the page keeps them. */
  readonly texts: readonly NearText[];
  /** Its transforms and its ancestors' are 2D. */
  readonly flat: boolean;
  /** They rotate or skew it, so its box isn't on the axes. */
  readonly turned: boolean;
  /** Its content box on screen when turned, if it has one quad; `box` is then the quad's bounds. */
  readonly quad: Quad | null;
}

/**
 * Reads `el` for its sample, once it holds still, and marks its glyphs
 * with `key` (data-quality-glyphs): its color, its mode, its font, its
 * content box in the viewport (a rotated one's quad and the quad's
 * bounds), and the other texts near the box, whose nodes the page keeps
 * under `near` for neighbourTexts() to pick from. Runs in the browser.
 */
export function sampleScript(
  el: Element,
  {
    key,
    near,
    query,
    boundary,
  }: {
    readonly key: string;
    readonly near: string;
    readonly query: string;
    readonly boundary: string;
  },
): Sample {
  const style = getComputedStyle(el);
  const high =
    window.matchMedia(query).matches ||
    el.closest('[data-appearance-boundary]')?.matches(boundary) === true;
  // The 2D map its transforms and its ancestors' put it through: CSS
  // applies translate, rotate, scale, then transform, and each
  // ancestor's after its child's. Only rotation and skew matter here,
  // as they take the box off the axes; a 3D one can't be sampled.
  let matrix = new DOMMatrix();
  let flat = true;
  for (let up: Element | null = el; up; up = up.parentElement) {
    const s = getComputedStyle(up);
    let own = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
    if (s.scale && s.scale !== 'none') {
      const [sx = 1, sy = sx, sz = 1] = s.scale.split(/\s+/).map(Number);
      if (sz !== 1) flat = false;
      own = new DOMMatrix().scale(sx, sy).multiply(own);
    }
    if (s.rotate && s.rotate !== 'none') {
      const parts = s.rotate.trim().split(/\s+/);
      const angle = parts.pop()!;
      const axis = parts.join(' ');
      const value = Number.parseFloat(angle);
      const deg = angle.endsWith('grad')
        ? value * 0.9
        : angle.endsWith('rad')
          ? (value * 180) / Math.PI
          : angle.endsWith('turn')
            ? value * 360
            : value;
      if (axis && axis !== 'z' && axis !== '0 0 1') flat = false;
      own = new DOMMatrix().rotate(deg).multiply(own);
    }
    if (!own.is2D) flat = false;
    matrix = own.multiply(matrix);
  }
  const turned = Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6;
  const r = el.getBoundingClientRect();
  const fill = style.webkitTextFillColor;
  const x = Math.max(
    0,
    r.x +
      (Number.parseFloat(style.borderLeftWidth) || 0) +
      (Number.parseFloat(style.paddingLeft) || 0),
  );
  const y = Math.max(
    0,
    r.y +
      (Number.parseFloat(style.borderTopWidth) || 0) +
      (Number.parseFloat(style.paddingTop) || 0),
  );
  const right = Math.min(
    innerWidth,
    r.right -
      (Number.parseFloat(style.borderRightWidth) || 0) -
      (Number.parseFloat(style.paddingRight) || 0),
  );
  const bottom = Math.min(
    innerHeight,
    r.bottom -
      (Number.parseFloat(style.borderBottomWidth) || 0) -
      (Number.parseFloat(style.paddingBottom) || 0),
  );
  el.setAttribute('data-quality-glyphs', key);
  // The other texts whose parent's box comes near this one, with their line boxes and
  // whether an ancestor the element doesn't share takes them out of flow, which
  // neighbourTexts() picks from; the page keeps them for the next call.
  const nodes: Text[] = [];
  const texts: {
    rects: { x: number; y: number; width: number; height: number }[];
    outOfFlow: boolean;
  }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.trim() || el.contains(text) || !text.parentElement) continue;
    const parent = text.parentElement.getBoundingClientRect();
    const empty = parent.width === 0 && parent.height === 0;
    if (
      !empty &&
      (parent.right < x - 8 ||
        parent.left > right + 8 ||
        parent.bottom < y - 8 ||
        parent.top > bottom + 8)
    ) {
      continue;
    }
    let outOfFlow = false;
    for (
      let up: Element | null = text.parentElement;
      up && !up.contains(el);
      up = up.parentElement
    ) {
      const position = getComputedStyle(up).position;
      if (position === 'absolute' || position === 'fixed') outOfFlow = true;
    }
    const range = document.createRange();
    range.selectNodeContents(text);
    nodes.push(text);
    texts.push({
      rects: [...range.getClientRects()].map((rect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })),
      outOfFlow,
    });
  }
  (window as unknown as Record<string, Text[]>)[near] = nodes;
  // A rotated or skewed box: its own content box, through the map, about its
  // center, which the map keeps at its bounding box's center; the clip is that
  // quad's bounds, and only the pixels inside it count. An inline box split
  // across lines has no one quad.
  let quad: Quad | null = null;
  let box = { x, y, width: right - x, height: bottom - y };
  if (turned && el instanceof HTMLElement && el.getClientRects().length === 1) {
    const [w, h] = [el.offsetWidth / 2, el.offsetHeight / 2];
    const side = (name: string) =>
      (Number.parseFloat(style.getPropertyValue(`border-${name}-width`)) || 0) +
      (Number.parseFloat(style.getPropertyValue(`padding-${name}`)) || 0);
    quad = {
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      left: -w + side('left'),
      right: w - side('right'),
      top: -h + side('top'),
      bottom: h - side('bottom'),
    };
    const corners = [
      [quad.left, quad.top],
      [quad.right, quad.top],
      [quad.right, quad.bottom],
      [quad.left, quad.bottom],
    ].map(([u, v]) => [
      quad!.cx + quad!.a * u! + quad!.c * v!,
      quad!.cy + quad!.b * u! + quad!.d * v!,
    ]);
    const qx = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]!))));
    const qy = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]!))));
    const qr = Math.min(innerWidth, Math.ceil(Math.max(...corners.map((p) => p[0]!))));
    const qb = Math.min(innerHeight, Math.ceil(Math.max(...corners.map((p) => p[1]!))));
    box = { x: qx, y: qy, width: qr - qx, height: qb - qy };
  }
  return {
    mode: high ? ('high-contrast' as const) : ('normal' as const),
    color: fill && fill !== style.color && !/^rgba?\(0, 0, 0, 0\)$/.test(fill) ? fill : style.color,
    fontSize: Number.parseFloat(style.fontSize) || 0,
    fontWeight: Number(style.fontWeight) || 400,
    box,
    texts,
    flat,
    turned,
    quad,
  };
}

/**
 * The worst ratio of `color` over the background in the PNG `shot`, or
 * null for an empty one. With `inside`, only the pixels it keeps, by column
 * and row in the image, count; null when it keeps none.
 */
export function worstRatio(
  shot: Uint8Array,
  color: string,
  inside?: (column: number, row: number, image: Image) => boolean,
): number | null {
  const parsed = parseCssColor(color);
  const image = decodePng(shot);
  if (!parsed || image.width * image.height === 0) return null;
  let worst = 21;
  let counted = 0;
  for (let i = 0; i < image.width * image.height; i++) {
    if (inside && !inside(i % image.width, Math.floor(i / image.width), image)) continue;
    counted++;
    const under = pixel(image, i);
    worst = Math.min(worst, contrast(blend(parsed.rgb, parsed.alpha, under), under));
  }
  return counted > 0 ? worst : null;
}

/**
 * How far round its glyphs a text's background counts, in CSS pixels: a
 * decoration that touches or crowds a letter is its background, and one
 * further off in its box isn't.
 */
export const HALO = 2;

/**
 * How much of a pixel a glyph must cover to be in its mask: the share of
 * 255 by which its white and black renders differ, in every channel.
 */
export const GLYPH_COVERAGE = 0.2;

/**
 * The glyph mask of a text from two shots of one clip, its glyphs filled
 * black in `black` and white in `white` over the same background: 1 where
 * they differ by GLYPH_COVERAGE of 255 in every channel, which only its
 * glyphs' paint does. Null when the shots aren't the same size.
 */
export function glyphMask(black: Image, white: Image): Uint8Array | null {
  if (black.width !== white.width || black.height !== white.height) return null;
  const mask = new Uint8Array(black.width * black.height);
  const least = GLYPH_COVERAGE * 255;
  for (let i = 0; i < mask.length; i++) {
    let lowest = 255;
    for (let channel = 0; channel < 3; channel++)
      lowest = Math.min(lowest, white.data[i * 4 + channel]! - black.data[i * 4 + channel]!);
    if (lowest >= least) mask[i] = 1;
  }
  return mask;
}

/** `mask`, `width` pixels a row, dilated by a disc of `radius` pixels: each pixel whose center is that close to one in it. */
export function dilate(mask: Uint8Array, width: number, radius: number): Uint8Array {
  const height = width > 0 ? mask.length / width : 0;
  const reach = Math.floor(radius);
  const disc: [number, number][] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++)
      if (dx * dx + dy * dy <= radius * radius + 1e-9) disc.push([dx, dy]);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [column, row] = [i % width, Math.floor(i / width)];
    for (const [dx, dy] of disc) {
      const [x, y] = [column + dx, row + dy];
      if (x >= 0 && x < width && y >= 0 && y < height) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * The pixels within HALO of a text's glyphs, from its black and white PNG
 * shots of `clip`, as a filter for worstRatio(): HALO is in CSS pixels, so
 * by the shot's own scale. Null when the shots aren't the same size, and
 * `glyphs` 0 when no glyph paints in the clip.
 */
export function glyphHalo(
  black: Uint8Array,
  white: Uint8Array,
  clip: Box,
): { glyphs: number; inside: (column: number, row: number, image: Image) => boolean } | null {
  const [dark, light] = [decodePng(black), decodePng(white)];
  const mask = glyphMask(dark, light);
  if (!mask || clip.width <= 0) return null;
  const halo = dilate(mask, dark.width, (HALO * dark.width) / clip.width);
  return {
    glyphs: mask.reduce((sum, on) => sum + on, 0),
    inside: (column, row, image) =>
      image.width === dark.width &&
      image.height === dark.height &&
      halo[row * dark.width + column] === 1,
  };
}

/**
 * A box drawn rotated or skewed: its content box in its own coordinates,
 * centered on the origin (left, right, top, bottom), and the 2D linear map
 * (a, b, c, d, as DOMMatrix names them) its transforms and its ancestors'
 * put it through, about its center on screen, (cx, cy) in the viewport.
 */
export interface Quad {
  readonly cx: number;
  readonly cy: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** How far inside a rotated content box a pixel's center must be: its antialiased edge isn't its background. */
export const QUAD_INSET = 1;

/**
 * Whether the pixel at `column`, `row` of a shot of `clip` has its center
 * inside `quad`, QUAD_INSET in from its edge: the pixels a rotated box's
 * text sits on, and none of its parent's around it, which an axis-aligned
 * clip takes in at the corners.
 */
export function insideQuad(
  quad: Quad,
  clip: Box,
): (column: number, row: number, image: Image) => boolean {
  const det = quad.a * quad.d - quad.b * quad.c;
  return (column, row, image) => {
    if (Math.abs(det) < 1e-9) return false;
    const x = clip.x + ((column + 0.5) * clip.width) / image.width - quad.cx;
    const y = clip.y + ((row + 0.5) * clip.height) / image.height - quad.cy;
    const u = (quad.d * x - quad.c * y) / det;
    const v = (-quad.b * x + quad.a * y) / det;
    return (
      u >= quad.left + QUAD_INSET &&
      u <= quad.right - QUAD_INSET &&
      v >= quad.top + QUAD_INSET &&
      v <= quad.bottom - QUAD_INSET
    );
  };
}

/** The contrast rule a sampled element fails, as the exceptions file names it (lib/exceptions.ts). */
export type ContrastRule =
  'text' | 'large-text' | 'high-contrast-text' | 'high-contrast-large-text';

/**
 * The ratio text needs at `fontSize` px and `fontWeight` in `mode`: large
 * text's, or normal text's, from the file's highContrast ratios when the
 * element renders high contrast.
 */
export function neededRatio(
  fontSize: number,
  fontWeight: number,
  mode: ContrastMode = 'normal',
): { rule: ContrastRule; ratio: number } {
  const { largeTextPt, largeBoldTextPt, largeBoldWeight } = thresholds.contrast;
  const { text, largeText } =
    mode === 'high-contrast' ? thresholds.contrast.highContrast : thresholds.contrast;
  const large =
    fontSize >= largeTextPt * PX_PER_PT - 0.01 ||
    (fontSize >= largeBoldTextPt * PX_PER_PT - 0.01 && fontWeight >= largeBoldWeight);
  const prefix = mode === 'high-contrast' ? 'high-contrast-' : '';
  return large
    ? { rule: `${prefix}large-text`, ratio: largeText }
    : { rule: `${prefix}text`, ratio: text };
}

/**
 * Whether anything on the page renders high contrast: prefers-contrast:
 * more, or a presentation boundary in the mode or at data-contrast="more".
 * Runs in the browser.
 */
export function rendersHighContrastScript({
  query,
  boundary,
}: {
  readonly query: string;
  readonly boundary: string;
}): boolean {
  return window.matchMedia(query).matches || document.querySelector(boundary) !== null;
}

/**
 * Whether each element `selectors` names renders high contrast: every one
 * under prefers-contrast: more, and otherwise each whose own presentation
 * boundary, the closest, renders it. A null selector, for a node in a frame
 * or shadow root, or one that matches nothing, says false there. Runs in
 * the browser.
 */
export function elementsHighContrastScript({
  query,
  boundary,
  selectors,
}: {
  readonly query: string;
  readonly boundary: string;
  readonly selectors: readonly (string | null)[];
}): boolean[] {
  const more = window.matchMedia(query).matches;
  return selectors.map((selector) => {
    if (more) return true;
    const el = selector === null ? null : document.querySelector(selector);
    return el?.closest('[data-appearance-boundary]')?.matches(boundary) === true;
  });
}

/**
 * `results` with color-contrast-enhanced's violations kept only on the
 * elements that render high contrast, so a nested boundary in another
 * mode, or a node the page can't read, stays under color-contrast's AA
 * ratios alone.
 */
export async function highContrastViolations<T extends Pick<AxeResults, 'violations'>>(
  page: Page,
  results: T,
): Promise<T> {
  const at = results.violations.findIndex((rule) => rule.id === ENHANCED_CONTRAST_RULE);
  if (at === -1) return results;
  const rule = results.violations[at]!;
  const high = await page.evaluate(elementsHighContrastScript, {
    query: MORE_CONTRAST,
    boundary: HIGH_CONTRAST_BOUNDARY,
    selectors: rule.nodes.map(nodeSelector),
  });
  const nodes = rule.nodes.filter((_, index) => high[index]);
  const violations = [...results.violations];
  if (nodes.length === 0) violations.splice(at, 1);
  else violations[at] = { ...rule, nodes };
  return { ...results, violations };
}

/**
 * What a sampled element's three shots say: null when its color reaches
 * the ratio its mode needs against every background pixel round its
 * glyphs, else its finding, a ratio short of it or why it's unresolved.
 * Both the per-element path and the batch path judge by it.
 */
export function judged(
  selector: string,
  sample: Sample,
  shot: Uint8Array,
  black: Uint8Array,
  white: Uint8Array,
): Finding | null {
  const unresolved = (actual: string): Finding => ({
    gate: 'contrast',
    rule: 'text',
    path: selector,
    expected: 'a contrast measured against its worst background pixel',
    actual,
  });
  const halo = glyphHalo(black, white, sample.box);
  if (!halo || halo.glyphs === 0) {
    return unresolved(
      halo
        ? 'unresolved: none of its glyphs paints inside its box, so there is no halo round them to sample'
        : "unresolved: its glyphs' shots and its background's aren't the same size",
    );
  }
  const quad = sample.quad ? insideQuad(sample.quad, sample.box) : undefined;
  const worst = worstRatio(
    shot,
    sample.color,
    (column, row, image) => halo.inside(column, row, image) && (!quad || quad(column, row, image)),
  );
  const need = neededRatio(sample.fontSize, sample.fontWeight, sample.mode);
  if (worst === null)
    return unresolved(
      !parseCssColor(sample.color)
        ? `its color ${sample.color} isn't one the sampler reads`
        : sample.quad
          ? 'unresolved: its rotated content box holds no whole pixel round its glyphs to sample'
          : "unresolved: its background's shot holds no pixel round its glyphs",
    );
  if (worst < need.ratio)
    return {
      gate: 'contrast',
      rule: need.rule,
      path: selector,
      expected: `${need.ratio}:1`,
      actual: `${worst.toFixed(2)}:1 against its worst background pixel`,
    };
  return null;
}

/**
 * The incomplete contrast items, color-contrast's and color-contrast-
 * enhanced's, each element once, by its target: the sampler holds each to
 * the ratios its own mode needs, whichever rule named it.
 */
export function incompleteContrastNodes(
  results: Pick<AxeResults, 'incomplete'>,
): AxeResults['incomplete'][number]['nodes'] {
  const seen = new Set<string>();
  return results.incomplete
    .filter((rule) => rule.id === CONTRAST_RULE || rule.id === ENHANCED_CONTRAST_RULE)
    .flatMap((rule) => rule.nodes)
    .filter((node) => {
      const key = JSON.stringify(node.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Whether axe names `node` inside a frame: its target has a part for each document, the frame's first. */
export const inFrame = (node: { readonly target: readonly unknown[] }): boolean =>
  node.target.length > 1;

/** How many incomplete contrast items axe names inside a frame. */
export function framedItems(results: Pick<AxeResults, 'incomplete'>): number {
  return incompleteContrastNodes(results).filter(inFrame).length;
}

/** Why a still element is unresolved: what still moves it, as stillnessScript() says. */
export function stillUnresolved(motion: NonNullable<Motion>): string {
  return motion.kind === 'infinite'
    ? `unresolved: an infinite animation, ${motion.name}, moves or repaints it, so its glyphs never hold still to sample`
    : motion.kind === 'scrolling'
      ? `unresolved: a scroll-driven animation, ${motion.name}, that moves or repaints it was still changing after ${NODE_LIMIT_MS / 1000} s, so its glyphs never held still to sample`
      : motion.kind === 'unholdable'
        ? `unresolved: it rests part-way through a scroll-driven animation, ${motion.name}, and the shots can't hold it where it rests`
        : motion.kind === 'failed'
          ? `unresolved: the wait for what moves it to come to rest failed (${motion.name}), so it was never seen at rest to sample`
          : `unresolved: an animation, ${motion.name}, that moves or repaints it was still running after ${NODE_LIMIT_MS / 1000} s, so its glyphs never held still to sample`;
}

/**
 * `el`'s text color as sampleScript() reads it (its text fill where that
 * paints instead), read again once its shots are taken and its marks are
 * off. Its color comes from its computed style, outside the shots, and its
 * background from the shots; the two are of one state of the page only if
 * this is still the color sampleScript() read (row 25: Flux's tab words,
 * whose ink a timeout turns as the drop's transition, which the shots end,
 * passes them). A color transition still running where its ink comes from,
 * on it or on an element whose color it inherits, is read at its end, as the
 * shots read every finite animation: taking its marks off sets one off on an
 * element that transitions its color (Kinetic Cosmos's links, from the marks'
 * transparent back to their ink), and a page's own is heading to the state
 * the shots showed. Runs in the browser.
 */
/**
 * How long a word's ancestors' attributes hold still before its color is read again, once one has
 * changed since the sampler moved to it (row 25). A page can turn a word's ink by a chain of
 * timeouts that outlasts every transition its shots ended (Flux's snap: a move, a snap, a turn,
 * each up to its drop's duration apart), so the wait runs from the last change, not from the
 * shots; 400 ms is past the longest gap in that chain (row 25's probe: 60 of 93 re-reads raced a
 * turn without it, 0 of 110 with it). The chain can start before the sampler reaches the word (the
 * batch path's scroll set it off, a stop or more before), so the wait looks back over all the
 * sampler has watched, from its start, never only from the word's own scroll.
 */
export const QUIET_MS = 400;

/** The attributes the sampler sets itself, which never count as the page changing. */
const OWN_ATTRIBUTE = /^data-quality-/;

/**
 * What watchTurnsScript() keeps under its key: when it began, and each node's last attribute
 * change, by node (row25-quiet-rc2-hardening): whether a node changed since a time is whether its
 * last change is at or after it, so the watch holds one entry a node, however often the page
 * changes it.
 */
interface Turns {
  readonly start: number;
  readonly last: Map<Node, number>;
}

/**
 * Watches every attribute the page changes (the sampler's own data-quality-* marks left out) under
 * `key`, from the sampler's start to its end, so that turnsQuietScript() knows when an attribute
 * of a word or an ancestor last changed, wherever the sampler was then (row 25).
 */
export function watchTurnsScript({ key, own }: { key: string; own: string }): true {
  const w = window as unknown as Record<string, unknown>;
  const ownAttribute = new RegExp(own);
  const state: Turns = { start: performance.now(), last: new Map() };
  const handle = (list: MutationRecord[]) => {
    const t = performance.now();
    for (const record of list)
      if (!ownAttribute.test(record.attributeName ?? '')) state.last.set(record.target, t);
  };
  const observer = new MutationObserver(handle);
  observer.observe(document.documentElement, { subtree: true, attributes: true });
  (w[`__qualityTurnsOff_${key}`] as (() => void) | undefined)?.();
  w[`__qualityTurns_${key}`] = state;
  w[`__qualityTurnsOff_${key}`] = () => observer.disconnect();
  // The sampler's own writes (its pins and their release, row25-quiet-rc2-hardening part 2a):
  // take() hands the page's changes still pending to the watch first, in order, as its observer
  // would have; drop() then throws away the records the sampler's own writes queued.
  w[`__qualityTurnsOwn_${key}`] = {
    take: () => handle(observer.takeRecords()),
    drop: () => void observer.takeRecords(),
  };
  return true;
}

/**
 * Before a color is read again: waits until no attribute of `els` or their ancestors has changed
 * for `ms`, and watchTurnsScript() has watched for `ms` at least (a chain the page began before
 * the watch shows its next turn within it), held to `cap`. Says `still` when that already holds
 * (no wait), `quiet` once it does, `restless` when it never did within the cap, and `restless`
 * too when there's no watch to ask, so a wait that can't be read fails closed. Runs in the
 * browser, on the per-element path and inside the batch path's helpers.
 */
export function turnsQuietScript(
  els: Element | readonly Element[],
  { key, ms, cap }: { key: string; ms: number; cap: number },
): Promise<'still' | 'quiet' | 'restless'> {
  const w = window as unknown as Record<string, unknown>;
  const state = w[`__qualityTurns_${key}`] as Turns | undefined;
  if (!state) return Promise.resolve('restless');
  const list: readonly Element[] = Array.isArray(els) ? els : [els as Element];
  // Whether one of them or an ancestor changed since `since`: a node whose last change is then.
  const changedSince = (since: number): boolean => {
    for (const [target, t] of state.last)
      if (t >= since && list.some((el) => target.contains(el))) return true;
    return false;
  };
  const calm = (now: number) => now - state.start >= ms && !changedSince(now - ms);
  const begun = performance.now();
  if (calm(begun)) return Promise.resolve('still');
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      if (calm(now)) return resolve('quiet');
      if (now - begun >= cap) return resolve('restless');
      setTimeout(tick, 25);
    };
    tick();
  });
}

/** Ends watchTurnsScript()'s watch under `key`. */
export function unwatchTurnsScript(key: string): true {
  const w = window as unknown as Record<string, unknown>;
  (w[`__qualityTurnsOff_${key}`] as (() => void) | undefined)?.();
  delete w[`__qualityTurns_${key}`];
  delete w[`__qualityTurnsOff_${key}`];
  delete w[`__qualityTurnsOwn_${key}`];
  return true;
}

/** Why a word whose ancestors never held still within the cap has no color to read. */
export const turnsUnresolved = (cap: number): string =>
  `unresolved: its ancestors' attributes were still changing ${cap / 1000} s after its shots, so its color can't be read from one state of the page`;

export function inkScript(el: Element): string {
  const style = getComputedStyle(el);
  const ending = (property: 'color' | 'webkitTextFillColor'): string | null => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      for (const animation of node.getAnimations()) {
        const effect = animation.effect;
        if (animation.playState !== 'running' || !(effect instanceof KeyframeEffect)) continue;
        if (effect.pseudoElement) continue;
        const frames = effect.getKeyframes();
        const end = frames[frames.length - 1]?.[property];
        if (typeof end === 'string') return end;
      }
      // Up only while it inherits: an element that sets its own value stops the walk.
      const parent: Element | null = node.parentElement;
      if (!parent || getComputedStyle(node)[property] !== getComputedStyle(parent)[property]) break;
    }
    return null;
  };
  // A fill of its own, as sampleScript() has it: one that isn't its current color (a currentcolor
  // fill follows the color part-way through a transition), and paints.
  const [now, fillNow] = [style.color, style.webkitTextFillColor];
  const ownFill = !!fillNow && fillNow !== now && !/^rgba?\(0, 0, 0, 0\)$/.test(fillNow);
  return ownFill ? (ending('webkitTextFillColor') ?? fillNow) : (ending('color') ?? now);
}

/**
 * Whether two colors read off the page are one: the same string, or exactly
 * the same channels and alpha, however the page serialized them (an interpolated
 * color reads `rgba(r, g, b, 1)` where the same color at rest reads
 * `rgb(r, g, b)`). An unreadable one is never the same.
 */
export function sameInk(a: string, b: string | null): boolean {
  if (b === null) return false;
  if (a === b) return true;
  const [x, y] = [parseCssColor(a), parseCssColor(b)];
  if (!x || !y) return false;
  return x.rgb.every((channel, i) => channel === y.rgb[i]) && x.alpha === y.alpha;
}

/**
 * Right before a shot: until when, on the page's clock (performance.now()),
 * the running finite animations on the document's timeline would have run,
 * which the shot ends early (animations: 'disabled'), kept on the window as
 * the latest such time any shot of the call has ended, and how long from now
 * that is, in ms. A page that times its own changes to a transition (Flux
 * turns each tab's ink by a timeout as the drop's clip passes it) makes them
 * on the transition's clock, not the shots': a shot shows the transition's
 * end at once, and the ink it set off comes as late as the transition would
 * have ended, after this element's read or the next one's. So the color is
 * read again only once that time has passed (shotSettleScript()). Each
 * animation counts for `limit` ms at most (NODE_LIMIT_MS), so a long one a
 * shot ended doesn't hold every later element's read past the wait's limit.
 * Runs in the browser.
 */
export function shotEndsScript({ key, limit }: { key: string; limit: number }): number {
  const w = window as unknown as Record<string, number | undefined>;
  const now = performance.now();
  let until = w[`__qualityShotUntil_${key}`] ?? now;
  // The sampler's own: a transition of a property its marks set (glyph color, fill, decoration,
  // shadow) inside an element it marked, which a page's timers can't be keyed to.
  const marked = `[data-quality-glyphs="${key}"], [data-quality-neighbours="${key}"], [data-quality-mask]`;
  const own = /^(?:color|webkitTextFillColor|textDecorationColor|textShadow|fill)$/;
  const ours = (animation: Animation) => {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !effect.target?.closest(marked)) return false;
    const properties = effect
      .getKeyframes()
      .flatMap((frame) => Object.keys(frame))
      .filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p));
    return properties.length > 0 && properties.every((p) => own.test(p));
  };
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running' || animation.timeline !== document.timeline) continue;
    if (ours(animation)) continue;
    const timing = animation.effect?.getComputedTiming();
    if (!timing || typeof timing.localTime !== 'number') continue;
    const end = Number(timing.endTime);
    if (!Number.isFinite(end)) continue;
    const left = (end - timing.localTime) / (Math.abs(animation.playbackRate) || 1);
    until = Math.max(until, now + Math.min(left, limit));
  }
  w[`__qualityShotUntil_${key}`] = until;
  return Math.max(0, until - now);
}

/**
 * Waits `ms` (shotEndsScript()'s, held to NODE_LIMIT_MS by the caller), then
 * two frames, so what the page set off by then has painted. Runs in the browser.
 */
export function shotSettleScript(ms: number): Promise<true> {
  const frame =
    (window as unknown as { __qualityRaf?: typeof requestAnimationFrame }).__qualityRaf ??
    requestAnimationFrame;
  return new Promise((done) => setTimeout(() => frame(() => frame(() => done(true))), ms));
}

/**
 * Waits, up to `limit` ms, for no finite animation on the document's
 * timeline to be running for two frames together: the page at rest, as a
 * visitor sees it once its motion ends, before an element whose color turned
 * is read once more. True at rest, false at the limit. Runs in the browser.
 */
export function pageRestScript(limit: number): Promise<boolean> {
  const frame =
    (window as unknown as { __qualityRaf?: typeof requestAnimationFrame }).__qualityRaf ??
    requestAnimationFrame;
  const running = () =>
    document.getAnimations().some((animation) => {
      if (animation.playState !== 'running' || animation.timeline !== document.timeline)
        return false;
      return Number.isFinite(Number(animation.effect?.getComputedTiming().endTime));
    });
  return new Promise((done) => {
    const began = performance.now();
    let quiet = 0;
    const look = () => {
      quiet = running() ? 0 : quiet + 1;
      if (quiet >= 2) done(true);
      else if (performance.now() - began >= limit) done(false);
      else frame(look);
    };
    frame(look);
  });
}

/**
 * Why an element whose color turned while its shots were taken, both times
 * it was read, is unresolved: each read's color, then the color once its
 * shots were taken (null where the page couldn't say).
 */
export function inkUnresolved(
  first: readonly [string, string | null],
  second: readonly [string, string | null],
): string {
  const turn = ([from, to]: readonly [string, string | null]) =>
    `${from} to ${to ?? 'a color it could not read'}`;
  return `unresolved: its color turned while its background was shot, ${turn(first)}, and again once it held still, ${turn(second)}, so its color and its background never came from one state of the page`;
}

// The batch path (row 14): an element costs the per-element path about
// fifteen round trips and three shots, and a page with hundreds of them,
// such as Schematic's, whose texts sit on its field's grid paper, ran past
// its cell's limit on CI. So the elements that share a viewport are read
// together, and measure exactly what each would on its own: the same
// clip, the same three shots, and the same marks in the clip.
//
// At each scroll stop, the call's first scroll position and then stops
// down the page, one evaluate (batchPlanScript) reads every element left
// that is wholly in the viewport, inside every box that clips it, and
// clear of stuck covers, waits for each to hold still, STILL_TOGETHER at
// a time, and reads each as the per-element path does (sampleScript).
// Each waits by
// stillnessScript() with that path's NODE_LIMIT_MS, MOVES and PAINTS, its
// pins taken off by releaseScript(), and one that comes back with a Motion
// is unresolved, saying which, as on that path. Each is checked again by
// the wait's own rule, with no wait (restlessScript()), right before it's
// read and before each of its batch's shots, since the waits after its own
// and the batches before take time: one something has started moving
// since takes the per-element path. One that rests on a
// scroll-driven animation's pin, is rotated or skewed, has no box, is
// covered, is clipped, or isn't wholly in any viewport takes the
// per-element path, unchanged, and so does one whose selector a shadow
// tree matches too, as a locator searches those as well. Away from the first
// stop, so does one by a fixed or sticky box, a fixed background, or a
// scroll-driven animation's target, whose paint the scroll moves against
// it, and one in, round, or by anything the page has changed as it
// scrolled (an IntersectionObserver's aria-current, a class, a text): the
// per-element path reads it where its own scroll puts it.
//
// The rest are split into batches no two of whose members can reach each
// other's clip (batches()): a member's glyph mark hides its own text by
// color, and so its currentColor borders and icons too, and its
// neighbours' marks hide theirs by fill, and either, painted where another
// member's clip is, would change what that one's shots hold. So each
// member's marks' paint, its subtree's boxes and its shadows and outline
// (markReachScript), must stay BATCH_GAP clear of every other member's
// box, unless it's a neighbour both hide by fill; one whose paint can't be
// bounded, a filter's or an out-of-flow pseudo-element's, or one under a
// backdrop filter, has a batch to itself. A batch sets its members' marks
// at once, takes each member's ground shot, then fills every member's
// glyphs black and takes each one's, then white, and judges each by its
// own three shots (judged()), as the per-element path does. Each member's
// shot is the pixels page.screenshot({ clip }) gives its box, cut from one
// shot of the batch (cutShots()), checked against a member's own shot for
// each way their origins round; a cut that differs gives every member its
// own shot.

/** How the sampler reads the incomplete elements: in batches, by default, or each on its own. */
export interface SamplerOptions {
  /** Batch the elements that share a viewport; false reads every one on its own. */
  readonly batch?: boolean;
}

/**
 * How far round a batch member's box another member's marks must keep
 * their paint, in CSS pixels, and how far a fixed or sticky box must be
 * from it, away from the first stop.
 */
export const BATCH_GAP = 8;

/** The most elements a mark's subtree may hold for its paint to be read from their boxes; past it, its reach is unbounded. */
export const MARK_SUBTREE_LIMIT = 400;

/**
 * How many of a stop's elements wait to hold still at once: one, so the
 * waits are taken in turn, as the per-element path takes them. Each wait
 * reads the page's animations every frame, and under a 12x CPU throttle
 * Schematic's 230, all at once, left 207 with no frame within
 * NODE_LIMIT_MS, and four at a time still left 32 (2026-11-03).
 */
export const STILL_TOGETHER = 1;

/** The most scroll stops one call makes; the elements still left then take the per-element path. */
export const BATCH_STOPS = 200;

/** A mark a batch member sets, and where its paint can reach. */
export interface MarkReach {
  /** The marked element, by its index in the call's registry: one element, one id. */
  readonly id: number;
  /** The member's own element, its glyphs hidden by color, or a neighbour text's parent, hidden by fill. */
  readonly role: 'glyphs' | 'fill';
  /** Where its paint can reach in the viewport, its shadows and outline included; null when that can't be bounded. */
  readonly extent: Box | null;
}

/** A batch candidate: its content box, its marks, and whether it needs a batch to itself. */
export interface BatchCandidate {
  readonly box: Box;
  readonly marks: readonly MarkReach[];
  readonly alone: boolean;
}

/** `box` grown by `by` on every side. */
export const grown = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
});

/** Whether two boxes share any area. */
export const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Whether `a` and `b` can't share a batch: either needs one to itself, or
 * a mark of one can paint within BATCH_GAP of the other's box, other than
 * a neighbour both hide by fill, which each one's own path hides as well.
 */
export function batchConflict(a: BatchCandidate, b: BatchCandidate): boolean {
  if (a.alone || b.alone) return true;
  const reach = (from: BatchCandidate, onto: BatchCandidate) =>
    from.marks.some(
      (mark) =>
        !(
          mark.role === 'fill' &&
          onto.marks.some((each) => each.id === mark.id && each.role === 'fill')
        ) &&
        (mark.extent === null || overlaps(mark.extent, grown(onto.box, BATCH_GAP))),
    );
  return reach(a, b) || reach(b, a);
}

/** The candidates, by index, in batches no two of whose members conflict: each in the first that takes it, in order. */
export function batches(candidates: readonly BatchCandidate[]): number[][] {
  const out: number[][] = [];
  for (const [at, candidate] of candidates.entries()) {
    const home = out.find((batch) =>
      batch.every((other) => !batchConflict(candidate, candidates[other]!)),
    );
    if (home) home.push(at);
    else out.push([at]);
  }
  return out;
}

/** What the plan says of one element at a scroll stop, by its index among the call's items. */
export type PlanEntry =
  | {
      readonly at: number;
      /** Not wholly in the viewport here: a later stop may take it. */
      readonly state: 'away';
      /** Its top and bottom in the page, for the next stop. */
      readonly top: number;
      readonly bottom: number;
    }
  | {
      readonly at: number;
      /** It takes the per-element path, for `why`. */
      readonly state: 'own';
      readonly why: string;
    }
  | {
      readonly at: number;
      /** Something still moves it at the limit: unresolved, as on its own path. */
      readonly state: 'motion';
      readonly motion: NonNullable<Motion>;
    }
  | {
      readonly at: number;
      /** Still, sampled, and marked for nothing yet. */
      readonly state: 'ready';
      readonly sample: Sample;
      /** Under a backdrop filter, which reads what's behind it from round its box: it has a batch to itself. */
      readonly alone: boolean;
    };

/** One element the batch path reads: its index among the call's items, and its selector. */
interface BatchItem {
  readonly at: number;
  readonly selector: string;
}

/** The scripts batchPlanScript() calls in the page, installed once per call under `__qualityBatch_<key>`. */
interface BatchHelpers {
  readonly still: typeof stillnessScript;
  readonly release: typeof releaseScript;
  readonly cover: typeof stuckCoverScript;
  readonly sample: typeof sampleScript;
  readonly restless: typeof restlessScript;
  readonly ink: typeof inkScript;
  readonly quiet: typeof turnsQuietScript;
}

/**
 * What moves `el` now, after its wait came back at rest, by the wait's own
 * rule (stillnessScript()): an animation whose target is `el`, an ancestor
 * or a descendant, animating a property in `moves`, or in `paints` on `el`
 * itself, or an inherited paint on an ancestor whose value reaches `el`,
 * that's running (neither finished nor idle) or scroll-driven (a
 * member at rest held none, or it would have pinned it). Its name, or null.
 * One pass, no wait: the batch path checks each member again with it right
 * before it reads it and before each of its batch's shots, since the waits
 * and the batches before can take seconds, and something can start moving
 * it meanwhile (C's review of row 14). Runs in the browser.
 */
export function restlessScript(
  el: Element,
  { moves, paints }: { readonly moves: string; readonly paints: string },
): string | null {
  const [moving, painting] = [new RegExp(moves), new RegExp(paints)];
  // INHERITED_PAINTS and stillnessScript()'s reaches(), inline: this runs in the page on its own.
  const inheriting = /^color$/;
  const reaches = (effect: KeyframeEffect, target: Element): boolean => {
    if (effect.pseudoElement || target === el || !target.contains(el)) return false;
    for (let node: Element = el; node !== target; node = node.parentElement!) {
      if (getComputedStyle(node).color !== getComputedStyle(node.parentElement!).color)
        return false;
    }
    return true;
  };
  const Scrolling = (globalThis as unknown as { ScrollTimeline?: abstract new () => object })
    .ScrollTimeline;
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !effect.target) continue;
    const target = effect.target;
    if (target !== el && !target.contains(el) && !el.contains(target)) continue;
    const counts = effect
      .getKeyframes()
      .some((keyframe) =>
        Object.keys(keyframe).some(
          (property) =>
            moving.test(property) ||
            (target === el && painting.test(property)) ||
            (inheriting.test(property) && reaches(effect, target)),
        ),
      );
    if (!counts) continue;
    const name =
      (animation as CSSAnimation).animationName ??
      ((animation as CSSTransition).transitionProperty
        ? `a transition of ${(animation as CSSTransition).transitionProperty}`
        : animation.id || 'unnamed');
    if (Scrolling && animation.timeline instanceof Scrolling) return name;
    if (animation.playState !== 'finished' && animation.playState !== 'idle') return name;
  }
  return null;
}

/**
 * The batch path's plan at one scroll stop (`first`: the call's own
 * scroll position): for each of `items`, by its index, whether it's away,
 * takes its own path and why, is moved for good, or is ready, sampled,
 * once every candidate has come to rest. The elements it samples it keeps
 * under `__qualityBatchEls_<key>`, by index, and their near texts under
 * `<near>_<index>`, and it takes their glyph marks off again. Runs in the
 * browser.
 */
export async function batchPlanScript({
  key,
  near,
  items,
  first,
  limit,
  moves,
  paints,
  query,
  boundary,
  gap,
  subtree,
  together,
}: {
  readonly key: string;
  readonly near: string;
  readonly items: readonly BatchItem[];
  readonly first: boolean;
  readonly together: number;
  readonly limit: number;
  readonly moves: string;
  readonly paints: string;
  readonly query: string;
  readonly boundary: string;
  readonly gap: number;
  readonly subtree: number;
}): Promise<PlanEntry[]> {
  const w = window as unknown as Record<string, unknown>;
  const helpers = w[`__qualityBatch_${key}`] as BatchHelpers;
  const els = (w[`__qualityBatchEls_${key}`] ??= []) as (Element | undefined)[];
  const out: PlanEntry[] = [];
  const own = (at: number, why: string) => out.push({ at, state: 'own', why });
  type Area = { x: number; y: number; width: number; height: number };
  const areaOf = (r: DOMRect): Area => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const meets = (a: Area, b: Area) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const around = (a: Area, by: number): Area => ({
    x: a.x - by,
    y: a.y - by,
    width: a.width + 2 * by,
    height: a.height + 2 * by,
  });
  const whole: Area = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  // What an element's subtree paints over, by its boxes, or the whole viewport past `subtree` elements.
  const spread = (el: Element): Area => {
    const all = [el, ...el.querySelectorAll('*')];
    if (all.length > subtree) return whole;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const each of all) {
      const r = each.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      [x0, y0, x1, y1] = [
        Math.min(x0, r.left),
        Math.min(y0, r.top),
        Math.max(x1, r.right),
        Math.max(y1, r.bottom),
      ];
    }
    return x0 === Infinity
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  // One read of every element: what paints by the viewport rather than the page, and what reads
  // its backdrop.
  const variant: Area[] = [];
  const backdrops: Area[] = [];
  // Every element, in shadow trees too, and the open shadow roots, which a locator searches as
  // well as the document (Next's route announcer keeps one on every page).
  const every: Element[] = [...document.querySelectorAll('*')];
  const shadows: ShadowRoot[] = [];
  for (let at = 0; at < every.length; at++) {
    const shadow = every[at]!.shadowRoot;
    if (shadow) {
      shadows.push(shadow);
      every.push(...shadow.querySelectorAll('*'));
    }
  }
  for (const el of every) {
    // One that renders nothing (display: none, its own or an ancestor's) paints nowhere.
    if (el.getClientRects().length === 0) continue;
    const s = getComputedStyle(el);
    if (
      !first &&
      (s.position === 'fixed' ||
        s.position === 'sticky' ||
        /\bfixed\b/.test(s.backgroundAttachment))
    )
      variant.push(spread(el));
    const backdrop =
      s.backdropFilter || (s as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
    if (backdrop && backdrop !== 'none') backdrops.push(areaOf(el.getBoundingClientRect()));
  }
  if (!first) {
    const Scrolling = (globalThis as unknown as { ScrollTimeline?: abstract new () => object })
      .ScrollTimeline;
    for (const animation of document.getAnimations()) {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (Scrolling && animation.timeline instanceof Scrolling && target)
        variant.push(spread(target));
    }
  }
  const live: { at: number; el: Element }[] = [];
  for (const { at, selector } of items) {
    let found: NodeListOf<Element>;
    try {
      found = document.querySelectorAll(selector);
    } catch {
      own(at, 'its selector isn’t one querySelector reads');
      continue;
    }
    // The one element a locator would find: none in a shadow tree, which it searches too.
    if (found.length !== 1 || shadows.some((shadow) => shadow.querySelector(selector) !== null)) {
      own(
        at,
        'its selector names more than one element, or none, in the page and its shadow trees',
      );
      continue;
    }
    const el = found[0]!;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) {
      own(at, 'it has no box');
      continue;
    }
    // Inside every box that clips it, as a locator's scroll into view, which then does nothing, reads it.
    let clipped = false;
    for (
      let up = el.parentElement;
      up && up !== document.body && up !== document.documentElement;
      up = up.parentElement
    ) {
      const s = getComputedStyle(up);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const u = up.getBoundingClientRect();
      if (
        r.left < u.left + (Number.parseFloat(s.borderLeftWidth) || 0) ||
        r.top < u.top + (Number.parseFloat(s.borderTopWidth) || 0) ||
        r.right > u.right - (Number.parseFloat(s.borderRightWidth) || 0) ||
        r.bottom > u.bottom - (Number.parseFloat(s.borderBottomWidth) || 0)
      )
        clipped = true;
    }
    if (clipped) {
      own(at, 'a box that clips it, or scrolls it, holds only part of it');
      continue;
    }
    if (r.left < 0 || r.right > innerWidth || r.height > innerHeight) {
      own(at, 'no vertical scroll stop holds all of it');
      continue;
    }
    if (r.top < 0 || r.bottom > innerHeight) {
      out.push({ at, state: 'away', top: r.top + scrollY, bottom: r.bottom + scrollY });
      continue;
    }
    if (helpers.cover(el, 0)) {
      own(at, 'a stuck cover sits over it');
      continue;
    }
    live.push({ at, el });
  }
  // Every candidate's wait at once, each under its own key; each one's pins come off, the last to
  // pin first, so a target two of them pinned gets its own style back.
  let done = 0;
  const settled: { at: number; el: Element; motion: Motion; order: number; frames: number }[] = [];
  // Frames since the call's page began counting, to tell a wait that saw none of its own.
  let frames = 0;
  let counting = true;
  const tick = () => {
    frames++;
    if (counting) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // `together` waits at a time: each looks over the page's animations every frame, and hundreds
  // at once on a throttled page starve the frames they wait for.
  for (let from = 0; from < live.length; from += together) {
    settled.push(
      ...(await Promise.all(
        live.slice(from, from + together).map(({ at, el }) => {
          const began = frames;
          // A wait that fails is that node's own Motion, `failed`, as on its own path.
          return Promise.resolve()
            .then(() => helpers.still(el, { limit, moves, paints, key: `${key}_${at}` }))
            .catch((error: unknown): Motion => ({
              kind: 'failed',
              name: String(error instanceof Error ? error.message : error)
                .split('\n')[0]!
                .slice(0, 160),
            }))
            .then((motion) => ({ at, el, motion, order: done++, frames: frames - began }));
        }),
      )),
    );
  }
  counting = false;
  const pinned = new Set<number>();
  for (const { at } of [...settled].sort((a, b) => b.order - a.order)) {
    const held = w[`__qualityHeld_${key}_${at}`] as unknown[] | undefined;
    if (held && held.length > 0) pinned.add(at);
    helpers.release(`${key}_${at}`);
  }
  // What the page has changed since the call began, as it scrolled (an IntersectionObserver's
  // aria-current, a class, a text): every element whose attribute differs from its first old
  // value, other than the sampler's own marks, or whose text or children changed, kept for the call.
  const seen = w[`__qualityBatchSeen_${key}`] as
    { observer: MutationObserver; records: MutationRecord[]; touched: Element[] } | undefined;
  if (seen) {
    const records = [...seen.records, ...seen.observer.takeRecords()];
    seen.records.length = 0;
    const first = new Map<string, { el: Element; name: string; old: string | null }>();
    const ids = new Map<Element, number>();
    const idOf = (el: Element) => {
      if (!ids.has(el)) ids.set(el, ids.size);
      return ids.get(el)!;
    };
    for (const record of records) {
      if (record.type === 'attributes') {
        const name = record.attributeName ?? '';
        if (name.startsWith('data-quality-') || !(record.target instanceof Element)) continue;
        const id = `${idOf(record.target)} ${name}`;
        if (!first.has(id)) first.set(id, { el: record.target, name, old: record.oldValue });
      } else {
        const el = record.target instanceof Element ? record.target : record.target.parentElement;
        if (el && !seen.touched.includes(el)) seen.touched.push(el);
      }
    }
    for (const { el, name, old } of first.values()) {
      if ((el.getAttribute(name) ?? '') !== (old ?? '') && !seen.touched.includes(el))
        seen.touched.push(el);
    }
  }
  const touched = (seen?.touched ?? []).map((el) => ({ el, area: spread(el) }));
  const named = (el: Element) =>
    `<${el.localName}${el.id ? `#${el.id}` : ''}${[...el.classList]
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('')}>`;
  for (const { at, el, motion, frames: seenFrames } of settled) {
    // A wait that ran out with fewer than the two frames it waits before it looks never looked:
    // a throttled page's frame outlasted it. Its own path waits again.
    if (motion?.kind === 'running' && seenFrames < 2) {
      own(at, `its wait saw ${seenFrames} frame(s) before NODE_LIMIT_MS ran out`);
      continue;
    }
    // What still moves it at the limit leaves it unresolved, as on its own path.
    if (motion) {
      out.push({ at, state: 'motion', motion });
      continue;
    }
    // At rest on a scroll-driven animation, its own path holds the pin through its shots.
    if (pinned.has(at)) {
      own(at, 'it rests on a scroll-driven animation, which its own path pins for its shots');
      continue;
    }
    // Checked again, as the waits after its own took time: what started moving it since takes it
    // to its own path, which waits for that too.
    const restless = helpers.restless(el, { moves, paints });
    if (restless) {
      own(at, `${restless} started moving it after its wait`);
      continue;
    }
    const sample = helpers.sample(el, { key, near: `${near}_${at}`, query, boundary });
    // Its mark comes off at once, as no other element's is on while its own path reads one: a
    // marked ancestor's transparent color is what a descendant read after it would inherit.
    el.removeAttribute('data-quality-glyphs');
    els[at] = el;
    const zone = around(sample.box, gap);
    if (!first && variant.some((area) => meets(area, zone))) {
      own(
        at,
        'a fixed or sticky box, a fixed background, or a scroll-driven animation paints by it',
      );
      continue;
    }
    const changed = first
      ? undefined
      : touched.find(
          (each) => each.el.contains(el) || el.contains(each.el) || meets(each.area, zone),
        );
    if (changed) {
      own(at, `the page changed ${named(changed.el)}, in, round or by it, as it scrolled`);
      continue;
    }
    out.push({ at, state: 'ready', sample, alone: backdrops.some((area) => meets(area, zone)) });
  }
  // A batch sets its own members' glyph marks.
  for (const el of document.querySelectorAll(`[data-quality-glyphs="${key}"]:not(style)`))
    el.removeAttribute('data-quality-glyphs');
  return out;
}

/**
 * Each member's marks, `members` by index with the near texts it hides
 * (neighbourTexts()'s indices), and where each mark's paint can reach:
 * its own element's subtree, or a hidden text's parent's, by every box
 * and text line in it, grown by the largest shadow, outline, and a
 * quarter of the font size for its glyphs' ink. A subtree past `subtree`
 * elements, one under a filter or holding one, or with an out-of-flow
 * pseudo-element, can't be bounded. Runs in the browser.
 */
export function markReachScript({
  key,
  near,
  members,
  subtree,
}: {
  readonly key: string;
  readonly near: string;
  readonly members: readonly { readonly at: number; readonly hide: readonly number[] }[];
  readonly subtree: number;
}): MarkReach[][] {
  const w = window as unknown as Record<string, unknown>;
  const els = w[`__qualityBatchEls_${key}`] as Element[];
  const registry = (w[`__qualityBatchMarks_${key}`] ??= []) as Element[];
  const idOf = (el: Element) => {
    const known = registry.indexOf(el);
    return known >= 0 ? known : registry.push(el) - 1;
  };
  // The farthest a shadow list's shadow reaches: its offsets, blur and spread, in px, added up.
  const shadow = (value: string) =>
    !value || value === 'none'
      ? 0
      : Math.max(
          0,
          ...value
            .split(/,(?![^(]*\))/)
            .map((one) =>
              (one.match(/-?[\d.]+px/g) ?? []).reduce(
                (sum, n) => sum + Math.abs(Number.parseFloat(n)),
                0,
              ),
            ),
        );
  const extentOf = (el: Element): Box | null => {
    for (let up = el.parentElement; up; up = up.parentElement) {
      if (getComputedStyle(up).filter !== 'none') return null;
    }
    const all = [el, ...el.querySelectorAll('*')];
    if (all.length > subtree) return null;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const take = (r: DOMRect, by: number) => {
      if (r.width <= 0 && r.height <= 0) return;
      [x0, y0, x1, y1] = [
        Math.min(x0, r.left - by),
        Math.min(y0, r.top - by),
        Math.max(x1, r.right + by),
        Math.max(y1, r.bottom + by),
      ];
    };
    for (const each of all) {
      const s = getComputedStyle(each);
      if (s.filter !== 'none') return null;
      let by = Math.max(
        shadow(s.textShadow),
        shadow(s.boxShadow),
        s.outlineStyle !== 'none'
          ? (Number.parseFloat(s.outlineWidth) || 0) +
              Math.abs(Number.parseFloat(s.outlineOffset) || 0)
          : 0,
      );
      // An outside list marker paints to the left of its item's box.
      if (s.display.includes('list-item') && s.listStylePosition === 'outside')
        by = Math.max(by, 2 * (Number.parseFloat(s.fontSize) || 0));
      for (const pseudo of ['::before', '::after']) {
        const p = getComputedStyle(each, pseudo);
        if (p.content === 'none' || p.content === 'normal') continue;
        if (p.position === 'absolute' || p.position === 'fixed') return null;
        by = Math.max(by, shadow(p.textShadow), shadow(p.boxShadow));
      }
      for (const r of each.getClientRects()) take(r, by);
      take(each.getBoundingClientRect(), by);
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const parent = (text as Text).parentElement;
      const s = parent ? getComputedStyle(parent) : null;
      const by =
        0.25 * (Number.parseFloat(s?.fontSize ?? '') || 0) + (s ? shadow(s.textShadow) : 0);
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const r of range.getClientRects()) take(r, by);
    }
    return x0 === Infinity
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  return members.map(({ at, hide }) => {
    const el = els[at]!;
    const texts = (w[`${near}_${at}`] as Text[] | undefined) ?? [];
    const marks: MarkReach[] = [{ id: idOf(el), role: 'glyphs', extent: extentOf(el) }];
    for (const index of hide) {
      const parent = texts[index]?.parentElement;
      if (parent) marks.push({ id: idOf(parent), role: 'fill', extent: extentOf(parent) });
    }
    return marks;
  });
}

/** Takes a batch's marks off, its members' masks too, but never the call's style element. Runs in the browser. */
export function unmarkBatchScript(key: string): void {
  for (const el of document.querySelectorAll(
    `[data-quality-glyphs="${key}"]:not(style), [data-quality-neighbours="${key}"]`,
  )) {
    if (el.getAttribute('data-quality-glyphs') === key) {
      el.removeAttribute('data-quality-glyphs');
      el.removeAttribute('data-quality-mask');
    }
    if (el.getAttribute('data-quality-neighbours') === key)
      el.removeAttribute('data-quality-neighbours');
  }
}

/**
 * How a batch shoots its boxes: `cut`, each cut from one page.screenshot()
 * of all of them (cutShots()), or `screenshot`, page.screenshot() for each,
 * as the per-element path does.
 */
const BATCH_CAMERA: 'cut' | 'screenshot' = 'cut';

/**
 * Where and how big page.screenshot({ clip: box }) shoots `box`, as
 * Playwright 1.58 sends Chromium the clip: trimmed to `viewport`, its size
 * floored; Chromium renders a clip from its origin rounded to the pixel, so
 * that shot is the pixels from there, the whole-pixel `x` and `y` here.
 */
export function shotRect(
  box: Box,
  viewport: { readonly width: number; readonly height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(box.x, viewport.width));
  const y = Math.max(0, Math.min(box.y, viewport.height));
  const right = Math.max(0, Math.min(box.x + box.width, viewport.width));
  const bottom = Math.max(0, Math.min(box.y + box.height, viewport.height));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.floor(right - x + 1e-3),
    height: Math.floor(bottom - y + 1e-3),
  };
}

/** `rect` of `image`, or null when it isn't wholly inside it. */
export function cutImage(
  image: Image,
  rect: { x: number; y: number; width: number; height: number },
): Image | null {
  const { x, y, width, height } = rect;
  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) return null;
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++)
    data.set(
      image.data.subarray(
        ((y + row) * image.width + x) * 4,
        ((y + row) * image.width + x + width) * 4,
      ),
      row * width * 4,
    );
  return { width, height, data };
}

/** Whether two images hold the same pixels. */
export const samePixels = (a: Image, b: Image): boolean =>
  a.width === b.width && a.height === b.height && a.data.every((value, at) => value === b.data[at]);

/**
 * Each box's shot, as page.screenshot({ clip: box }) takes it, cut from
 * one page.screenshot() of every box on whole pixels (shotRect()): the
 * same render, as nothing changes between the shots. It's checked, each
 * time: for each way the boxes' origins round (a fraction under or over a
 * half, across and down), one box is shot on its own, and if any cut
 * isn't its own shot, pixel for pixel, every box gets its own shot.
 */
export async function cutShots(
  page: Pick<Page, 'screenshot'>,
  viewport: { readonly width: number; readonly height: number },
  boxes: readonly Box[],
): Promise<Uint8Array[]> {
  const own = (clip: Box) => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  if (boxes.length === 0) return [];
  if (boxes.length === 1) return [await own(boxes[0]!)];
  const rects = boxes.map((box) => shotRect(box, viewport));
  const ux = Math.min(...rects.map((rect) => rect.x));
  const uy = Math.min(...rects.map((rect) => rect.y));
  const union = decodePng(
    await own({
      x: ux,
      y: uy,
      width: Math.max(...rects.map((rect) => rect.x + rect.width)) - ux,
      height: Math.max(...rects.map((rect) => rect.y + rect.height)) - uy,
    }),
  );
  const cuts = rects.map((rect) => cutImage(union, { ...rect, x: rect.x - ux, y: rect.y - uy }));
  const out: (Uint8Array | undefined)[] = [];
  const checked = new Set<string>();
  let same = cuts.every((cut) => cut !== null);
  for (const [at, box] of boxes.entries()) {
    if (!same) break;
    const way = `${box.x - Math.floor(box.x) >= 0.5} ${box.y - Math.floor(box.y) >= 0.5}`;
    if (checked.has(way)) continue;
    checked.add(way);
    out[at] = await own(box);
    same = samePixels(decodePng(out[at]!), cuts[at]!);
  }
  const shots: Uint8Array[] = [];
  for (const [at, box] of boxes.entries())
    shots.push(out[at] ?? (same ? encodePng(cuts[at]!) : await own(box)));
  return shots;
}

/** A batch's camera: `take` shoots each box as page.screenshot() would. */
interface Camera {
  readonly take: (boxes: readonly Box[]) => Promise<Uint8Array[]>;
}

/** The batch path's camera for `page`, by BATCH_CAMERA. */
async function shotsFor(page: Page): Promise<Camera> {
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  return {
    take: async (boxes) => {
      if (BATCH_CAMERA === 'cut') return cutShots(page, viewport, boxes);
      const out: Uint8Array[] = [];
      for (const clip of boxes)
        out.push(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
      return out;
    },
  };
}

/**
 * The batch path (see above): the findings of every element it reads,
 * by its index in `nodes`; every element it leaves out takes the
 * per-element path. On a page it can't plan in, such as a stand-in, it
 * reads none. It puts the page back where it was.
 */
export async function batchFindings(
  page: Page,
  nodes: AxeResults['incomplete'][number]['nodes'],
  key: string,
  near: string,
): Promise<Map<number, Finding[]>> {
  const done = new Map<number, Finding[]>();
  const items: BatchItem[] = nodes.flatMap((node, at) => {
    const selector = nodeSelector(node);
    return selector ? [{ at, selector }] : [];
  });
  if (items.length === 0 || typeof page.screenshot !== 'function') return done;
  const selectors = new Map(items.map(({ at, selector }) => [at, selector]));
  const installed = await page
    .evaluate(
      `globalThis[${JSON.stringify(`__qualityBatch_${key}`)}] = { still: ${stillnessScript}, release: ${releaseScript}, cover: ${stuckCoverScript}, sample: ${sampleScript}, restless: ${restlessScript}, ink: ${inkScript}, quiet: ${turnsQuietScript} }, true`,
    )
    .catch(() => false);
  if (installed !== true) return done;
  // What the page changes as the batch path scrolls it, which batchPlanScript() reads.
  const origin = await page
    .evaluate((key) => {
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((list) => records.push(...list));
      observer.observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        childList: true,
      });
      (window as unknown as Record<string, unknown>)[`__qualityBatchSeen_${key}`] = {
        observer,
        records,
        touched: [],
      };
      return [scrollX, scrollY, innerHeight] as const;
    }, key)
    .catch(() => null);
  if (!Array.isArray(origin)) return done;
  // When this stop's scroll began (row 25): a stop whose members' ancestors changed after it
  // judges none of them (the batch's inks, below); the sampler's own watch has each change.
  await page
    .evaluate((key) => {
      (window as unknown as Record<string, unknown>)[`__qualityBatchStop_${key}`] =
        performance.now();
    }, key)
    .catch(() => undefined);
  const [left, top, height] = origin;
  const camera = await shotsFor(page);
  const visited = new Set<number>([top]);
  let pending = items;
  try {
    for (let stop = 0; stop < BATCH_STOPS && pending.length > 0; stop++) {
      const plan = await page
        .evaluate(batchPlanScript, {
          key,
          near,
          items: pending,
          first: stop === 0,
          limit: NODE_LIMIT_MS,
          moves: MOVES.source,
          paints: PAINTS.source,
          query: MORE_CONTRAST,
          boundary: HIGH_CONTRAST_BOUNDARY,
          gap: BATCH_GAP,
          subtree: MARK_SUBTREE_LIMIT,
          together: STILL_TOGETHER,
        })
        .catch(() => null);
      if (!Array.isArray(plan)) break;
      const ready: Extract<PlanEntry, { state: 'ready' }>[] = [];
      const away: Extract<PlanEntry, { state: 'away' }>[] = [];
      for (const entry of plan) {
        if (entry.state === 'motion')
          done.set(entry.at, [
            {
              gate: 'contrast',
              rule: 'text',
              path: selectors.get(entry.at),
              expected: 'a contrast measured against its worst background pixel',
              actual: stillUnresolved(entry.motion),
            },
          ]);
        else if (entry.state === 'away') away.push(entry);
        // One the per-element path would call box-less or rotated takes it, to say so its own way.
        else if (
          entry.state === 'ready' &&
          entry.sample.box.width >= 1 &&
          entry.sample.box.height >= 1 &&
          entry.sample.flat &&
          !entry.sample.turned
        )
          ready.push(entry);
      }
      if (ready.length > 0) {
        const hides = ready.map((entry) => neighbourTexts(entry.sample.texts, entry.sample.box));
        const reaches = await page
          .evaluate(markReachScript, {
            key,
            near,
            members: ready.map((entry, k) => ({ at: entry.at, hide: hides[k]! })),
            subtree: MARK_SUBTREE_LIMIT,
          })
          .catch(() => null);
        if (Array.isArray(reaches) && reaches.length === ready.length) {
          const candidates = ready.map((entry, k) => ({
            box: entry.sample.box,
            marks: reaches[k]!,
            alone: entry.alone,
          }));
          for (const batch of batches(candidates)) {
            let members = batch.map((k) => ({ entry: ready[k]!, hide: hides[k]! }));
            // Right before each of the batch's shots, each member is checked again
            // (restlessScript()); one something has started moving leaves the batch, unmarked
            // and unmasked from then, for its own path, which waits for that too. The rest are
            // marked, or masked `fill`, in the same pass.
            const settle = async (fill: 'black' | 'white' | null) => {
              const moved = await page.evaluate(
                ({ key, near, marks, moves, paints, fill }) => {
                  const w = window as unknown as Record<string, unknown>;
                  const els = w[`__qualityBatchEls_${key}`] as Element[];
                  const helpers = w[`__qualityBatch_${key}`] as BatchHelpers;
                  const out: number[] = [];
                  for (const { at, hide } of marks) {
                    const el = els[at]!;
                    if (helpers.restless(el, { moves, paints })) {
                      out.push(at);
                      continue;
                    }
                    if (fill) {
                      el.setAttribute('data-quality-mask', fill);
                      continue;
                    }
                    el.setAttribute('data-quality-glyphs', key);
                    const texts = (w[`${near}_${at}`] as Text[] | undefined) ?? [];
                    for (const index of hide)
                      texts[index]?.parentElement?.setAttribute('data-quality-neighbours', key);
                  }
                  return out;
                },
                {
                  key,
                  near,
                  marks: members.map(({ entry, hide }) => ({ at: entry.at, hide })),
                  moves: MOVES.source,
                  paints: PAINTS.source,
                  fill,
                },
              );
              members = members.filter(({ entry }) => !moved.includes(entry.at));
            };
            // Each shot first notes what it ends (shotEndsScript()), as on the per-element path.
            const ends: { left: number | null } = { left: 0 };
            const shoot = async () => {
              ends.left = await page
                .evaluate(shotEndsScript, { key, limit: NODE_LIMIT_MS })
                .catch(() => null);
              const taken = await camera.take(members.map(({ entry }) => entry.sample.box));
              return new Map(members.map(({ entry }, k) => [entry.at, taken[k]!]));
            };
            await settle(null);
            const shots = await shoot();
            await settle('black');
            const blacks = await shoot();
            await settle('white');
            const whites = await shoot();
            await page.evaluate(unmarkBatchScript, key);
            if (ends.left !== 0)
              await page
                .evaluate(shotSettleScript, Math.min(ends.left ?? NODE_LIMIT_MS, NODE_LIMIT_MS))
                .catch(() => undefined);
            // Each member's color read again once the shots are taken and what they ended has had
            // its time (inkScript()): one the page turned meanwhile leaves the batch for its own
            // path, which reads it once more, or says it never came from one state (row 25).
            // Whether the page changed an attribute of a member or an ancestor since this stop's
            // scroll began, once their ancestors have held still QUIET_MS (row 25): a chain an
            // earlier stop set off shows its next turn in that wait. If so, or if they never held
            // still, the batch judges none of them, and each goes its own path, which waits for
            // them too. Unreadable counts as changed.
            const changed = await page
              .evaluate(
                async ({ key, ats, ms, cap }) => {
                  const w = window as unknown as Record<string, unknown>;
                  const els = w[`__qualityBatchEls_${key}`] as Element[];
                  const helpers = w[`__qualityBatch_${key}`] as BatchHelpers;
                  const turns = w[`__qualityTurns_${key}`] as Turns | undefined;
                  const stopAt = w[`__qualityBatchStop_${key}`];
                  if (!turns || typeof stopAt !== 'number') return true;
                  const members = ats.map((at) => els[at]!);
                  if ((await helpers.quiet(members, { key, ms, cap })) === 'restless') return true;
                  for (const [target, t] of turns.last)
                    if (t >= stopAt && members.some((el) => target.contains(el))) return true;
                  return false;
                },
                {
                  key,
                  ats: members.map(({ entry }) => entry.at),
                  ms: QUIET_MS,
                  cap: NODE_LIMIT_MS,
                },
              )
              .catch(() => true);
            const inks = changed
              ? null
              : await page
                  .evaluate(
                    ({ key, ats }) => {
                      const w = window as unknown as Record<string, unknown>;
                      const els = w[`__qualityBatchEls_${key}`] as Element[];
                      const helpers = w[`__qualityBatch_${key}`] as BatchHelpers;
                      return ats.map((at) => helpers.ink(els[at]!));
                    },
                    { key, ats: members.map(({ entry }) => entry.at) },
                  )
                  .catch(() => null);
            for (const [k, { entry }] of members.entries()) {
              if (!Array.isArray(inks) || !sameInk(entry.sample.color, inks[k] ?? null)) continue;
              const found = judged(
                selectors.get(entry.at)!,
                entry.sample,
                shots.get(entry.at)!,
                blacks.get(entry.at)!,
                whites.get(entry.at)!,
              );
              done.set(entry.at, found ? [found] : []);
            }
          }
        }
      }
      // The next stop: the highest element left, a quarter of the viewport down, or as far as it fits.
      pending = pending.filter(({ at }) => away.some((entry) => entry.at === at));
      if (pending.length === 0) break;
      const highest = away.reduce((a, b) => (b.top < a.top ? b : a));
      const room = Math.max(
        0,
        Math.min(Math.floor(height / 4), Math.floor(height - (highest.bottom - highest.top)) - 1),
      );
      const next = Math.max(0, Math.floor(highest.top) - room);
      await page
        .evaluate((key) => {
          (window as unknown as Record<string, unknown>)[`__qualityBatchStop_${key}`] =
            performance.now();
        }, key)
        .catch(() => undefined);
      const reached = await page
        .evaluate(
          ([x, y]) =>
            new Promise<number>((resolve) => {
              scrollTo({ left: x, top: y, behavior: 'instant' });
              // Two frames, for the scroll to paint before anything reads it.
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY)));
            }),
          [left, next] as const,
        )
        .catch(() => null);
      if (typeof reached !== 'number' || visited.has(reached)) break;
      visited.add(reached);
    }
  } finally {
    await page
      .evaluate(
        ({ key, near, left, top, count }) => {
          const w = window as unknown as Record<string, unknown>;
          for (const el of document.querySelectorAll(
            `[data-quality-glyphs="${key}"]:not(style), [data-quality-neighbours="${key}"]`,
          )) {
            if (el.getAttribute('data-quality-glyphs') === key) {
              el.removeAttribute('data-quality-glyphs');
              el.removeAttribute('data-quality-mask');
            }
            if (el.getAttribute('data-quality-neighbours') === key)
              el.removeAttribute('data-quality-neighbours');
          }
          (
            w[`__qualityBatchSeen_${key}`] as { observer?: MutationObserver } | undefined
          )?.observer?.disconnect();
          for (const name of [
            `__qualityBatch_${key}`,
            `__qualityBatchEls_${key}`,
            `__qualityBatchMarks_${key}`,
            `__qualityBatchSeen_${key}`,
            `__qualityBatchStop_${key}`,
          ])
            delete w[name];
          for (let at = 0; at < count; at++) delete w[`${near}_${at}`];
          scrollTo({ left, top, behavior: 'instant' });
        },
        { key, near, left, top, count: nodes.length },
      )
      .catch(() => undefined);
  }
  return done;
}

/**
 * Text no contrast result names that a stuck cover sits over (row 152): axe matches and judges a text by its
 * element's box, so text whose lines paint past a box too small for them (one a pixel tall, say) can go unmatched,
 * and the sampler, which reads what axe calls incomplete, never sees it. One read of the page names each element
 * with text of its own whose line boxes, as far as they paint, run more than a pixel past its border box (cut to
 * every box on the way up that clips its overflow; text under a clip-path or clip is axe's alone), that no contrast
 * result of axe's names, and that a stuck cover sits over by those line boxes (stuckCoverScript); each joins the sampler's
 * items by a path of its own, so the sampler clears it of the cover and reads it, or says why it can't. A page that
 * can't be read (a test's stand-in) adds none.
 */
export async function coveredUnmatchedText(
  page: Page,
  results: Partial<Pick<AxeResults, 'violations' | 'incomplete' | 'passes'>>,
): Promise<{ target: string[] }[]> {
  const named = [
    ...(results.violations ?? []),
    ...(results.incomplete ?? []),
    ...(results.passes ?? []),
  ]
    .filter((rule) => rule.id === CONTRAST_RULE || rule.id === ENHANCED_CONTRAST_RULE)
    .flatMap((rule) => rule.nodes)
    .map(nodeSelector)
    .filter((selector): selector is string => selector !== null);
  const script = `((named) => {
    const cover = ${stuckCoverScript};
    const seen = new Set();
    for (const selector of named) {
      try { for (const el of document.querySelectorAll(selector)) seen.add(el); } catch {}
    }
    const path = (el) => {
      const parts = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentElement)
        parts.unshift(node.localName + ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')');
      return ['html', ...parts].join(' > ');
    };
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (seen.has(el)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (own.length === 0) continue;
      const box = el.getBoundingClientRect();
      if (!(box.width > 0 && box.height > 0)) continue;
      const lines = own.flatMap((n) => {
        const range = document.createRange();
        range.selectNodeContents(n);
        return [...range.getClientRects()];
      });
      const outside = (r) => r.right - r.left >= 1 && r.bottom - r.top >= 1 &&
        (r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1);
      if (!lines.some(outside)) continue;
      // What of a line paints: the line box cut to every box on the way up that clips (overflow other than visible),
      // the element's own among them. A clip-path or clip leaves a shape this can't read, so text under one is
      // left to axe, as it was (a skip link out of sight until focused, row 152's reach).
      let cut = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      let shaped = false;
      for (let up = el; up && up !== document.documentElement; up = up.parentElement) {
        const cs = getComputedStyle(up);
        if (cs.clipPath !== 'none' || (cs.clip && cs.clip !== 'auto')) shaped = true;
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const u = up.getBoundingClientRect();
          cut = {
            left: Math.max(cut.left, u.left), top: Math.max(cut.top, u.top),
            right: Math.min(cut.right, u.right), bottom: Math.min(cut.bottom, u.bottom),
          };
        }
      }
      if (shaped) continue;
      const past = lines.some((line) =>
        outside({
          left: Math.max(line.left, cut.left), top: Math.max(line.top, cut.top),
          right: Math.min(line.right, cut.right), bottom: Math.min(line.bottom, cut.bottom),
        }),
      );
      if (past && cover(el, 0)) out.push(path(el));
    }
    return out;
  })(${JSON.stringify(named)})`;
  const found = await page.evaluate(script).catch(() => undefined);
  return Array.isArray(found)
    ? found
        .filter((each): each is string => typeof each === 'string')
        .map((selector) => ({ target: [selector] }))
    : [];
}

/**
 * Each incomplete contrast element resolved against its worst background
 * pixel, at the ratios its own mode needs. With `framed`, for a surface
 * whose frame's document other cells cover, the items inside a frame are
 * left out first, before anything samples; every item in the page itself
 * stays. The elements the batch path can take (batchFindings()) are read
 * there, viewport by viewport, unless `batch` is false; every other one,
 * and every one with it off, is read on its own, as each was before it,
 * and the findings come in the items' order either way. Text no contrast
 * result names that a stuck cover sits over joins the items after axe's
 * (coveredUnmatchedText(), row 152).
 */
export async function incompleteContrastFindings(
  page: Page,
  results: Pick<AxeResults, 'incomplete'> & Partial<Pick<AxeResults, 'violations' | 'passes'>>,
  framed = false,
  { batch = true }: SamplerOptions = {},
): Promise<Finding[]> {
  // tsx names a script's inner functions with a helper the page doesn't have.
  await page.evaluate('globalThis.__name ??= (f) => f');
  const incomplete = [
    ...incompleteContrastNodes(results),
    ...((await coveredUnmatchedText(
      page,
      results,
    )) as unknown as AxeResults['incomplete'][number]['nodes']),
  ];
  const nodes = framed ? incomplete.filter((node) => !inFrame(node)) : incomplete;
  if (nodes.length === 0) return [];
  const findings: Finding[] = [];
  // This call's key: its style, its marks, and the texts the page keeps between calls carry it.
  const key = randomBytes(6).toString('hex');
  const near = `__qualityNearTexts_${key}`;
  await page.evaluate(
    ({ css, key }) => {
      const style = document.createElement('style');
      style.dataset.qualityGlyphs = key;
      style.textContent = css;
      document.head.append(style);
    },
    { css: hideCss(key), key },
  );
  // Every attribute the page changes from here to the end, when and where (row 25): a word's color
  // is read again once it and its ancestors have held still, wherever the sampler was when they
  // changed.
  await page.evaluate(watchTurnsScript, { key, own: OWN_ATTRIBUTE.source }).catch(() => undefined);
  /** Takes this call's neighbour marks off, and the texts the page kept. */
  const unmarkNeighbours = () =>
    page.evaluate(
      ({ key, near }) => {
        for (const el of document.querySelectorAll(`[data-quality-neighbours="${key}"]`))
          el.removeAttribute('data-quality-neighbours');
        delete (window as unknown as Record<string, unknown>)[near];
      },
      { key, near },
    );
  try {
    // The batch path's findings, by item, settled before any element takes its own path.
    const batched = batch ? await batchFindings(page, nodes, key, near) : new Map();
    for (const [index, node] of nodes.entries()) {
      const settled = batched.get(index);
      if (settled) {
        findings.push(...settled);
        continue;
      }
      const selector = nodeSelector(node);
      const unresolved = (actual: string) =>
        findings.push({
          gate: 'contrast',
          rule: 'text',
          path: selector ?? undefined,
          expected: 'a contrast measured against its worst background pixel',
          actual,
        });
      if (!selector) {
        unresolved("axe named it inside a frame or shadow root, which the sampler can't reach");
        continue;
      }
      const locator = page.locator(selector).first();
      const unmark = () =>
        locator.evaluate((el) => el.removeAttribute('data-quality-glyphs')).catch(() => undefined);
      // Where the page was, which it goes back to once this element is read.
      const at = await page.evaluate(() => [scrollX, scrollY] as const).catch(() => null);
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: NODE_LIMIT_MS }).catch(() => undefined);
        // A stuck header or dock over it isn't its background: scroll it clear, or say so.
        const cover = await clearOfStuckCovers(page, locator);
        if (cover.still) {
          unresolved(
            cover.scrolled
              ? `unresolved: ${cover.still}, fixed or sticky, still covers it once it's scrolled clear, so its background can't be sampled`
              : `unresolved: ${cover.still}, fixed or sticky, covers it, and leaves no room in the viewport to scroll it clear, so its background can't be sampled`,
          );
          continue;
        }
        // One read, or why it can't be read: what moves it comes to rest before its box is read
        // (and, `again`, the whole page, pageRestScript()), then its sample, its three shots, and
        // its color read again (inkScript()) once they're taken, its marks are off, and the time
        // the transitions its shots ended had left has passed (shotEndsScript()).
        const read = async (
          again: boolean,
        ): Promise<
          | string
          | {
              sample: Sample;
              shot: Buffer;
              black: Buffer;
              white: Buffer;
              after: string | null;
              restless: boolean;
            }
        > => {
          if (again) await page.evaluate(pageRestScript, NODE_LIMIT_MS).catch(() => false);
          const motion = await locator
            .evaluate(
              stillnessScript,
              { limit: NODE_LIMIT_MS, moves: MOVES.source, paints: PAINTS.source, key },
              { timeout: NODE_LIMIT_MS },
            )
            .catch((error: unknown): Motion => ({
              kind: 'failed',
              name: String(error instanceof Error ? error.message : error)
                .split('\n')[0]!
                .slice(0, 160),
            }));
          if (motion && typeof motion === 'object' && 'kind' in motion)
            return stillUnresolved(motion);
          const sample = await locator
            .evaluate(
              sampleScript,
              { key, near, query: MORE_CONTRAST, boundary: HIGH_CONTRAST_BOUNDARY },
              { timeout: NODE_LIMIT_MS },
            )
            .catch(() => null as Sample | null);
          if (!sample || sample.box.width < 1 || sample.box.height < 1) {
            await unmark();
            await unmarkNeighbours();
            return 'it has no box in the viewport to sample';
          }
          // An axis-aligned clip of a rotated box takes in what's round it at the corners.
          if (!sample.flat || (sample.turned && !sample.quad)) {
            await unmark();
            await unmarkNeighbours();
            return sample.flat
              ? 'unresolved: it is rotated or skewed across more than one line box, so it has no one quad to sample inside'
              : 'unresolved: it is transformed in 3D, so its box on screen has no 2D quad to sample inside';
          }
          // Hide the neighbours' glyphs at the box's edge, by their fill, so no layout moves.
          await page.evaluate(
            ({ key, near, hide }) => {
              const nodes = (window as unknown as Record<string, Text[] | undefined>)[near] ?? [];
              for (const at of hide)
                nodes[at]?.parentElement?.setAttribute('data-quality-neighbours', key);
            },
            { key, near, hide: neighbourTexts(sample.texts, sample.box) },
          );
          // Each shot first notes what it ends (shotEndsScript()); `left`, after the last, is how
          // long the wait for what those ends set off takes. One unknown takes the whole limit.
          const ends: { left: number | null } = { left: 0 };
          const capture = async () => {
            ends.left = await page
              .evaluate(shotEndsScript, { key, limit: NODE_LIMIT_MS })
              .catch(() => null);
            return page.screenshot({ clip: sample.box, animations: 'disabled', caret: 'hide' });
          };
          const shot = await capture();
          // Its glyphs alone, filled black and then white over the same background, for their mask.
          const masked = async (fill: 'black' | 'white') => {
            await locator.evaluate((el, fill) => el.setAttribute('data-quality-mask', fill), fill);
            return capture();
          };
          const black = await masked('black');
          const white = await masked('white');
          await locator
            .evaluate((el) => el.removeAttribute('data-quality-mask'))
            .catch(() => undefined);
          await unmark();
          await unmarkNeighbours();
          if (ends.left !== 0)
            await page
              .evaluate(shotSettleScript, Math.min(ends.left ?? NODE_LIMIT_MS, NODE_LIMIT_MS))
              .catch(() => undefined);
          // A page that changed something round it since the sampler moved to it may still be
          // turning it on a timer no shot ended: its color is read again only once its ancestors'
          // attributes have held still QUIET_MS, and never judged if they don't within the cap
          // (row 25): a color that turned is still read as turned, and one that didn't is
          // unresolved, never a pass (`restless`).
          const quiet = await locator
            .evaluate(turnsQuietScript, { key, ms: QUIET_MS, cap: NODE_LIMIT_MS })
            .catch(() => 'restless' as const);
          const after = await locator
            .evaluate(inkScript, undefined, { timeout: NODE_LIMIT_MS })
            .catch(() => null);
          return { sample, shot, black, white, after, restless: quiet === 'restless' };
        };
        // Its color and its background from one state of the page (row 25). Its color is read
        // outside the shots, and the page can turn it in between (a script's class as the
        // sampler's scroll moved the page, a timeout a transition the shots end sets off, even
        // one an earlier element's shots ended): one whose color isn't the same once its shots
        // are taken and what they ended has had its time is read once more, its pins off, its
        // wait run again and the page at rest, and one that turns again is unresolved, never
        // judged from two states.
        let taken = await read(false);
        if (typeof taken === 'string') {
          unresolved(taken);
          continue;
        }
        if (!sameInk(taken.sample.color, taken.after)) {
          const turned = [taken.sample.color, taken.after] as const;
          await page.evaluate(releaseScript, key).catch(() => undefined);
          taken = await read(true);
          if (typeof taken === 'string') {
            unresolved(taken);
            continue;
          }
          if (!sameInk(taken.sample.color, taken.after)) {
            unresolved(inkUnresolved(turned, [taken.sample.color, taken.after]));
            continue;
          }
        }
        // Its ancestors still changing at the cap, though its color held: no one state to judge.
        if (taken.restless) {
          unresolved(turnsUnresolved(NODE_LIMIT_MS));
          continue;
        }
        const found = judged(selector, taken.sample, taken.shot, taken.black, taken.white);
        if (found) findings.push(found);
      } finally {
        // What the wait pinned for the shots comes off, whatever happened since.
        await page.evaluate(releaseScript, key).catch(() => undefined);
        if (at) {
          await page
            .evaluate(([x, y]) => scrollTo({ left: x, top: y, behavior: 'instant' }), at)
            .catch(() => undefined);
        }
      }
    }
  } finally {
    await page.evaluate(unwatchTurnsScript, key).catch(() => undefined);
    await page.evaluate(
      ({ key, near }) => {
        document.querySelector(`style[data-quality-glyphs="${key}"]`)?.remove();
        for (const el of document.querySelectorAll(
          `[data-quality-glyphs="${key}"], [data-quality-neighbours="${key}"]`,
        )) {
          if (el.getAttribute('data-quality-glyphs') === key) {
            el.removeAttribute('data-quality-glyphs');
            el.removeAttribute('data-quality-mask');
          }
          if (el.getAttribute('data-quality-neighbours') === key)
            el.removeAttribute('data-quality-neighbours');
        }
        delete (window as unknown as Record<string, unknown>)[near];
        delete (window as unknown as Record<string, unknown>)[`__qualityShotUntil_${key}`];
      },
      { key, near },
    );
  }
  return findings;
}
