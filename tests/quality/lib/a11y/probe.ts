// What the accessibility suites read in the page (#11, Slice 2): one
// self-contained function the checks call with a request, so each read is
// one evaluate. It names an element by a CSS path the next request can find
// it by. It runs as a string, wrapped by inPage(), since tsx would wrap its
// inner functions in a __name() helper the page doesn't have, and it works
// with JavaScript off, where Playwright's evaluate still runs.

import type { Page } from '@playwright/test';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The focused element, as the keyboard checks see it. */
export interface Active {
  /** No element has focus but the document itself. */
  readonly none: boolean;
  readonly path: string;
  readonly tag: string;
  readonly box: Box;
  /** Rendered with a size, not hidden, transparent, or clipped to a pixel. */
  readonly shown: boolean;
  /** Some of it is inside the viewport. */
  readonly inView: boolean;
  /** What the point at its center (clamped to the viewport) hits: itself, a descendant, or its label. */
  readonly hitsItself: boolean;
  /** The top layer over it, or ''. */
  readonly hit: string;
  /** Every element that paints over its center, from the top. */
  readonly layers: readonly string[];
  /** One of them is near-opaque, so it covers the control whatever its pixels say. */
  readonly opaque: boolean;
  /** How far its focus indicator reaches past its box, in CSS px. */
  readonly reach: number;
  /**
   * Its sides' lengths on screen, when its transforms or an ancestor's
   * rotate or skew it, so `box`, the bounds round it, is larger than it is.
   */
  readonly sides?: { readonly width: number; readonly height: number };
  /** Its line boxes, when it wraps onto more than one, which a ring goes round one by one. */
  readonly fragments?: readonly Box[];
  /**
   * Its ring's rounding, when its border-radius is above 0 or its ring is an outline, its corners
   * then all 0 (a straight ring): see Rounding.
   */
  readonly rounding?: Rounding;
}

/**
 * A rounded focus target, or a straight one whose ring is an outline: each
 * corner's border radius, horizontal and vertical, in CSS px (top-left,
 * top-right, bottom-right, bottom-left), as computed, before CSS scales radii
 * that overlap (all 0 for a straight one), the outline's offset, which an
 * outline adds to each rounded corner's radius, and its width.
 */
export interface Rounding {
  readonly corners: readonly (readonly [number, number])[];
  readonly offset: number;
  /**
   * The outline's width, 0 with none (a ring that's a box-shadow): with one at perimeterPx or
   * more, the ring is measured along its centre line (ringCentreLine). Without it, by its pixels.
   */
  readonly width?: number;
}

/** A stop as the focus check reads it again: where it is now, and whether it shows and has focus. */
export interface Stop {
  readonly box: Box;
  readonly fragments?: readonly Box[];
  readonly shown: boolean;
  /**
   * What holds it, its nearest ancestor that draws a box, is shown and in
   * the viewport: so when the stop isn't, it's the stop itself that hid,
   * such as a skip link, not a menu or panel round it, such as one open
   * only on :focus-within, or moved off-screen until then.
   */
  readonly holderShown: boolean;
  /**
   * The holder is a visually hidden box, rendered, 1px or less both ways and
   * clipped (clip, clip-path, or overflow: hidden), such as an sr-only
   * wrapper a skip link grows on :focus-within; with `holderBox`, read while
   * the stop had focus, the check tells that it grew into the viewport.
   */
  readonly holderHidden: boolean;
  readonly holderBox: Box | null;
  /**
   * Its own visibility is visible, its own opacity above 0, and its content
   * isn't skipped by an ancestor's content-visibility: hiding, it moved or
   * was clipped.
   */
  readonly ownVisible: boolean;
  readonly focused: boolean;
}

export type ProbeRequest =
  | { readonly kind: 'tabbables' }
  | { readonly kind: 'active' }
  | { readonly kind: 'contains'; readonly container: string }
  | { readonly kind: 'overlays' }
  | { readonly kind: 'triggers' }
  | { readonly kind: 'expanded'; readonly path: string }
  | { readonly kind: 'shown' }
  | { readonly kind: 'hover-targets'; readonly limit: number }
  | { readonly kind: 'title-only' }
  | { readonly kind: 'inventory'; readonly paths?: boolean }
  | { readonly kind: 'script-only-text' }
  | { readonly kind: 'structure' }
  | { readonly kind: 'reflow' }
  | { readonly kind: 'transparency' }
  | { readonly kind: 'box'; readonly path: string }
  | { readonly kind: 'stop'; readonly path: string }
  | { readonly kind: 'named'; readonly name: string };

/** Runs in the page. Every helper is inside it, so it travels as one string. */
function probe(request: ProbeRequest): unknown {
  const doc = document;
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    for (
      let node: Element | null = el;
      node && node !== doc.documentElement;
      node = node.parentElement
    ) {
      if (node.id && doc.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        return parts.join(' > ');
      }
      const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
      parts.unshift(`${node.localName}:nth-child(${index})`);
    }
    parts.unshift('html');
    return parts.join(' > ');
  };
  const find = (path: string): Element | null => {
    try {
      return doc.querySelector(path);
    } catch {
      return null;
    }
  };
  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  // Its line boxes, the ones with a size: one for a block, one a line for a wrapped inline.
  const fragmentsOf = (el: Element): Box[] =>
    [...el.getClientRects()]
      .filter((r) => r.width >= 1 && r.height >= 1)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  const shown = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    const visible = (el as HTMLElement).checkVisibility?.({
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true,
    });
    if (visible === false) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const clip = getComputedStyle(el).clipPath;
    return !/inset\(50%\)/.test(clip);
  };
  // Present: shown, or inside a closed <details>, which a visitor opens.
  const present = (el: Element): boolean => shown(el) || Boolean(el.closest('details:not([open])'));
  // A visually hidden box, the sr-only pattern: rendered, as display: none isn't, 1px or less
  // both ways, and clipped (clip, clip-path, or overflow hidden or clip), so what it holds is
  // for assistive technology and no one sees it cut. A box only one way small, or not clipped,
  // isn't one: what it holds shows, cut or not.
  const visuallyHidden = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width > 1 || r.height > 1) return false;
    const s = getComputedStyle(el);
    return (
      /inset\(50%\)/.test(s.clipPath) ||
      /^rect\(/.test(s.clip) ||
      /hidden|clip/.test(`${s.overflowX} ${s.overflowY}`)
    );
  };
  const inVisuallyHidden = (el: Element): boolean => {
    for (let up = el.parentElement; up && up !== doc.body; up = up.parentElement) {
      if (visuallyHidden(up)) return true;
    }
    return false;
  };
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  /**
   * Whether `el` is a live status, as ARIA reads it: an aria-live that, trimmed and in lower case,
   * is "polite" or "assertive"; or role="status" (its first role token) unless aria-live is
   * explicitly "off". An empty or unknown aria-live is the default: off, or the role's polite. The
   * only element a data-script-only mark counts on.
   */
  const liveStatus = (el: Element | null): boolean => {
    if (el === null) return false;
    const live = (el.getAttribute('aria-live') ?? '').trim().toLowerCase();
    if (live === 'polite' || live === 'assertive') return true;
    if (live === 'off') return false;
    return (el.getAttribute('role') ?? '').trim().split(/\s+/)[0] === 'status';
  };
  const nameOf = (el: Element): string =>
    (
      el.getAttribute('aria-label') ??
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map((id) => (id ? text(doc.getElementById(id) ?? doc.createElement('i')) : ''))
        .join(' ')
        .trim() ??
      ''
    ).trim() ||
    text(el) ||
    (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
    el.getAttribute('alt') ||
    el.getAttribute('title') ||
    '';
  // Whether a closed <details> folds `el` away: a closed one holds it, and
  // it isn't inside that details' own summary, its first summary child,
  // which stays on screen and in the tab order. A summary of a details
  // nested in a closed one is folded away with the rest.
  const folded = (el: Element): boolean => {
    for (
      let details = el.parentElement?.closest('details');
      details;
      details = details.parentElement?.closest('details')
    ) {
      if ((details as HTMLDetailsElement).open) continue;
      const own = details.querySelector(':scope > summary');
      if (!own?.contains(el)) return true;
    }
    return false;
  };
  // Whether a closed popover or dialog holds `el`.
  const closedLayer = (el: Element): boolean => {
    if (el.closest('dialog:not([open])')) return true;
    for (
      let up: Element | null | undefined = el.closest('[popover]');
      up;
      up = up.parentElement?.closest('[popover]')
    ) {
      try {
        if (!up.matches(':popover-open')) return true;
      } catch {
        // An engine without :popover-open shows no popover it can't open.
        return true;
      }
    }
    return false;
  };
  const tabbable = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (h.tabIndex < 0 || h.hasAttribute('disabled')) return false;
    if (el.closest('[inert], [hidden]') || folded(el) || closedLayer(el)) return false;
    if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden')
      return false;
    if (el.localName === 'input' && (el as HTMLInputElement).type === 'radio') {
      const radio = el as HTMLInputElement;
      if (!radio.name) return true;
      const group = [
        ...doc.querySelectorAll<HTMLInputElement>(
          `input[type=radio][name="${CSS.escape(radio.name)}"]`,
        ),
      ];
      const chosen = group.find((each) => each.checked) ?? group[0];
      return chosen === radio;
    }
    return true;
  };
  // Whether `el` puts anything on screen of its own: a fill, an image, a
  // replaced element, or text. A transparent wrapper above a control
  // covers nothing.
  // A computed color's alpha: rgba(), or the slash form of color() and oklch().
  const alphaOf = (color: string): number => {
    if (color === 'transparent') return 0;
    const match = /[,/]\s*([\d.]+)(%?)\)$/.exec(color);
    if (!match || !/^rgba|\//.test(color)) return 1;
    return match[2] ? Number(match[1]) / 100 : Number(match[1]);
  };
  const paints = (el: Element): boolean => {
    const s = getComputedStyle(el);
    return (
      alphaOf(s.backgroundColor) > 0 ||
      s.backgroundImage !== 'none' ||
      el.matches('img, svg, video, canvas, iframe, input, select, textarea, button') ||
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())
    );
  };
  // How far a focus indicator reaches past the box: the outline's width and
  // offset, or the furthest outer box-shadow.
  const ringReach = (el: Element): number => {
    const s = getComputedStyle(el);
    const outline =
      s.outlineStyle === 'none'
        ? 0
        : (Number.parseFloat(s.outlineWidth) || 0) +
          Math.max(0, Number.parseFloat(s.outlineOffset) || 0);
    let shadow = 0;
    for (const part of s.boxShadow === 'none' ? [] : s.boxShadow.split(/,(?![^(]*\))/)) {
      if (/\binset\b/.test(part)) continue;
      const [x = 0, y = 0, blur = 0, spread = 0] = (part.match(/-?[\d.]+px/g) ?? []).map(
        Number.parseFloat,
      );
      shadow = Math.max(shadow, Math.max(Math.abs(x), Math.abs(y)) + blur + spread);
    }
    return Math.max(outline, shadow);
  };
  // An element's sides on screen when it, or an ancestor, is rotated or
  // skewed: its layout size through the 2D map CSS puts it through
  // (translate, rotate, scale, then transform, each ancestor's after its
  // child's). Null when it's on the axes, or for a 3D or inline-split box.
  const turnedSides = (el: Element): { width: number; height: number } | null => {
    let matrix = new DOMMatrix();
    for (let up: Element | null = el; up; up = up.parentElement) {
      const s = getComputedStyle(up);
      let own = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
      if (s.scale && s.scale !== 'none') {
        const [sx = 1, sy = sx] = s.scale.split(/\s+/).map(Number);
        own = new DOMMatrix().scale(sx, sy).multiply(own);
      }
      if (s.rotate && s.rotate !== 'none') {
        const parts = s.rotate.trim().split(/\s+/);
        const angle = parts.pop()!;
        const axis = parts.join(' ');
        if (axis && axis !== 'z' && axis !== '0 0 1') return null;
        const value = Number.parseFloat(angle);
        const deg = angle.endsWith('grad')
          ? value * 0.9
          : angle.endsWith('rad')
            ? (value * 180) / Math.PI
            : angle.endsWith('turn')
              ? value * 360
              : value;
        own = new DOMMatrix().rotate(deg).multiply(own);
      }
      if (!own.is2D) return null;
      matrix = own.multiply(matrix);
    }
    if (Math.abs(matrix.b) < 1e-6 && Math.abs(matrix.c) < 1e-6) return null;
    if (!(el instanceof HTMLElement) || el.getClientRects().length !== 1) return null;
    return {
      width: Math.hypot(matrix.a, matrix.b) * el.offsetWidth,
      height: Math.hypot(matrix.c, matrix.d) * el.offsetHeight,
    };
  };
  // A declared scroll region: it scrolls, a keyboard can reach it, and an
  // author gave it a name (aria-label, aria-labelledby, or a figure's own
  // figcaption, the name HTML gives a figure). Text inside doesn't count.
  const declaredScroller = (el: Element): boolean => {
    const s = getComputedStyle(el);
    return (
      /auto|scroll/.test(`${s.overflowX} ${s.overflowY}`) &&
      (el as HTMLElement).tabIndex >= 0 &&
      Boolean(
        el.getAttribute('aria-label')?.trim() ||
        el.getAttribute('aria-labelledby')?.trim() ||
        (el.localName === 'figure' && el.querySelector(':scope > figcaption')),
      )
    );
  };
  const FOCUSABLE =
    'a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable=false]), [tabindex]';
  const OVERLAY =
    'dialog[open], [role=dialog], [role=alertdialog], [role=menu], [role=listbox], [popover]';

  switch (request.kind) {
    case 'tabbables':
      return [...doc.querySelectorAll(FOCUSABLE)].filter(tabbable).map(cssPath);
    case 'active': {
      const el = doc.activeElement;
      if (!el || el === doc.body || el === doc.documentElement) {
        return { none: true, path: '', tag: '', box: { x: 0, y: 0, width: 0, height: 0 } };
      }
      const box = boxOf(el);
      const [vw, vh] = [innerWidth, innerHeight];
      // A link that wraps is hit at its first line box's center: the union's
      // center can fall between its lines, on whatever is beside them.
      const fragments = fragmentsOf(el);
      const first = fragments[0] ?? box;
      const cx = Math.min(Math.max(first.x + first.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(first.y + first.height / 2, 0), vh - 1);
      // The stack at the center, from the top: each element that paints
      // before the control (or its label) is a layer over it. The caller
      // forces pointer-events on, so a pointer-events: none layer is in the
      // stack, and it decides from pixels whether faint layers, such as a
      // grain overlay, really cover it; a near-opaque one does outright.
      let hit: Element | null = null;
      const layers: Element[] = [];
      for (const top of doc.elementsFromPoint(cx, cy)) {
        const label = top.closest('label') as HTMLLabelElement | null;
        if (top === el || el.contains(top) || label?.control === el || top.contains(el)) break;
        if (paints(top)) {
          hit ??= top;
          layers.push(top);
        }
      }
      const opaque = layers.some((layer) => {
        const s = getComputedStyle(layer);
        return alphaOf(s.backgroundColor) * Number(s.opacity) >= 0.9;
      });
      const sides = turnedSides(el);
      // Each corner's radius as computed, a percentage of the box's side resolved; the ring's
      // length scales overlapping radii as CSS does. The outline's offset beside them. A wrapped
      // inline's ring is measured by its lines.
      const cs = getComputedStyle(el);
      const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => {
        const [h = '0', v = h] = cs.getPropertyValue(`border-${corner}-radius`).trim().split(/\s+/);
        const px = (value: string, side: number) =>
          value.endsWith('%')
            ? (Number.parseFloat(value) / 100) * side
            : Number.parseFloat(value) || 0;
        return [px(h, box.width), px(v, box.height)] as [number, number];
      });
      // A straight outline is read too, its corners 0, so its ring can be held to its centre line
      // as a rounded one's is (item 17): a box-shadow ring round a square box is held to its pixels.
      const outline = cs.outlineStyle === 'none' ? 0 : Number.parseFloat(cs.outlineWidth) || 0;
      const rounding =
        corners.some(([h, v]) => h > 0 && v > 0) || outline > 0
          ? { corners, offset: Number.parseFloat(cs.outlineOffset) || 0, width: outline }
          : null;
      return {
        ...(sides ? { sides } : {}),
        // A rotated stop is held to its own sides; the rounded path and the centre line are for an
        // upright one.
        ...(rounding && !sides && fragments.length <= 1 ? { rounding } : {}),
        ...(fragments.length > 1 ? { fragments } : {}),
        none: false,
        path: cssPath(el),
        tag: el.localName,
        box,
        shown: shown(el),
        inView: box.x + box.width > 0 && box.y + box.height > 0 && box.x < vw && box.y < vh,
        hitsItself: layers.length === 0,
        hit: hit ? cssPath(hit) : '',
        layers: layers.map(cssPath),
        opaque,
        reach: ringReach(el),
      } satisfies Active;
    }
    case 'contains': {
      const container = find(request.container);
      const el = doc.activeElement;
      return {
        open: Boolean(container && shown(container)),
        inside: Boolean(container && el && container.contains(el)),
        none: !el || el === doc.body || el === doc.documentElement,
        count: container ? [...container.querySelectorAll(FOCUSABLE)].filter(tabbable).length : 0,
      };
    }
    case 'overlays':
      return [...doc.querySelectorAll(OVERLAY)]
        .filter((el) => shown(el) && (!el.hasAttribute('popover') || el.matches(':popover-open')))
        .map((el) => ({
          path: cssPath(el),
          modal: el.matches(':modal') || el.getAttribute('aria-modal') === 'true',
        }));
    case 'triggers':
      return [
        ...doc.querySelectorAll(
          'button[aria-haspopup]:not([aria-haspopup=false]), [role=button][aria-haspopup]:not([aria-haspopup=false]), button[aria-controls], button[aria-expanded], [popovertarget], button[commandfor]',
        ),
      ]
        .filter((el) => tabbable(el) && shown(el))
        .map((el) => ({ path: cssPath(el), name: nameOf(el) }));
    case 'expanded':
      return find(request.path)?.getAttribute('aria-expanded') ?? null;
    case 'shown':
      return [...doc.body.querySelectorAll('*')]
        .filter(
          (el) =>
            (el.matches('a, button, input, select, textarea, img, svg, [role]') ||
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) &&
            shown(el),
        )
        .map(cssPath);
    case 'hover-targets': {
      // Revealing subjects first: a rule with a combinator after :hover shows
      // or styles something else, which is what parity is about.
      const selectors = new Set<string>();
      const revealing = new Set<string>();
      const walk = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules)
            walk((rule as CSSGroupingRule).cssRules);
          const selector = (rule as CSSStyleRule).selectorText;
          if (!selector?.includes(':hover')) continue;
          for (const part of selector.split(',')) {
            const at = part.indexOf(':hover');
            if (at < 0) continue;
            const end = part.slice(at).search(/[\s>+~]/);
            const subject = (end < 0 ? part : part.slice(0, at + end))
              .replace(/:hover/g, '')
              .trim();
            if (subject) (end < 0 ? selectors : revealing).add(subject);
          }
        }
      };
      for (const sheet of doc.styleSheets) {
        try {
          walk(sheet.cssRules);
        } catch {
          // A sheet from another origin can't be read; the policy loads none.
        }
      }
      // Every element a revealing rule matches, since each can show its own
      // content. A rule with nothing after :hover styles only the element
      // under the pointer, the same way on each, so its first shown element
      // stands for the rest.
      const targets = new Set<Element>();
      const stood = new Set<Element>();
      for (const selector of revealing) {
        try {
          for (const el of doc.querySelectorAll(selector)) if (shown(el)) targets.add(el);
        } catch {
          // A selector the engine keeps but querySelectorAll refuses, such as a pseudo-element.
        }
      }
      for (const selector of selectors) {
        try {
          const matched = [...doc.querySelectorAll(selector)].filter((el) => shown(el));
          if (matched.length > 0 && !matched.some((el) => targets.has(el) || stood.has(el))) {
            stood.add(matched[0]!);
          }
        } catch {
          // As above.
        }
      }
      for (const el of stood) targets.add(el);
      return { paths: [...targets].slice(0, request.limit).map(cssPath), total: targets.size };
    }
    case 'title-only':
      return [...doc.querySelectorAll('[title]')]
        .filter((el) => shown(el) && el.getAttribute('title')!.trim())
        .filter((el) => {
          const title = el.getAttribute('title')!.replace(/\s+/g, ' ').trim().toLowerCase();
          const said =
            `${nameOf(el)} ${text(el)} ${el.getAttribute('aria-description') ?? ''}`.toLowerCase();
          return el.localName !== 'iframe' && !said.includes(title);
        })
        .map((el) => ({ path: cssPath(el), title: el.getAttribute('title')! }));
    case 'inventory': {
      // Every authored field, as a visitor gets it: headings, text blocks,
      // links with their targets, images by alt, and controls by name. With `paths`, each field
      // with the path of the first element that gives it.
      const items = new Map<string, Element>();
      const add = (el: Element, item: string) => {
        if (!items.has(item)) items.set(item, el);
      };
      // A same-document skip link: one to #main or #top, or to the page's own main or top
      // (its <main>'s id, or <html>'s or <body>'s). It moves the reader within the page and
      // carries nothing of the page's content, so it's a control, not a link: Swiss's "Back to
      // the top", which print hides. Any other fragment (#section-x) is still a link.
      const ownIds = new Set(['main', 'top']);
      for (const el of [doc.documentElement, doc.body, doc.querySelector('main, [role=main]')]) {
        if (el?.id) ownIds.add(el.id);
      }
      const skipLink = (el: Element | null): boolean => {
        const href = el?.getAttribute('href') ?? '';
        return href.startsWith('#') && ownIds.has(href.slice(1));
      };
      // Words only live script sets, such as HC's position status ("Opening, 1 of 21"), which a
      // static stand-in would get wrong wherever the reader is: an author marks the element
      // data-script-only, and its text blocks are `script-only:` fields, which no JavaScript and
      // print let go (NO_SCRIPT_IGNORE, PRINT_IGNORE). Only on a live status, role="status" or a
      // live aria-live: on any other element the mark is ignored and its words count. Text only: a
      // block that holds a heading, a link, an image or a control is no script-only field, its
      // words included, and each of those still counts as itself, so the mark waives nothing but
      // plain words. And the server renders such a status empty: one with words without
      // JavaScript is a finding of its own (scriptOnlyTextFindings, the `script-only-text` read),
      // so the mark can't excuse them.
      const scriptOnly = (el: Element): boolean =>
        liveStatus(el.closest('[data-script-only]')) &&
        el.querySelector(
          'h1, h2, h3, h4, h5, h6, [role=heading], a[href], area[href], img, button, input, select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable=false]), [role=button], [role=link], [tabindex]',
        ) === null;
      // A button that submits nothing: type=button or reset.
      const inertButton = (el: Element | null): boolean =>
        el?.localName === 'button' && /^(?:button|reset)$/.test((el as HTMLButtonElement).type);
      for (const el of doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
        if (present(el)) add(el, `heading: ${text(el)}`);
      }
      for (const el of doc.body.querySelectorAll(
        'p, li, dd, dt, td, th, figcaption, blockquote, time, pre',
      )) {
        const value = text(el);
        if (value && present(el) && !el.querySelector('p, li, dd, dt, td, th, blockquote, pre')) {
          // A block whose every word is inside a button that submits nothing (type=button or
          // reset) holds that button's own label, no text of its own: Flux's Copy email in its
          // <p>. It's a field of its own kind, so the conditions that let such a button go
          // (NO_SCRIPT_IGNORE, PRINT_IGNORE) let its label go with it, and nothing else.
          // A block whose only words are such controls' (skip links' too) and at most a short
          // label of its own, three words, is a control label, as Swiss's colophon cell holds
          // "This page" before Back to the top and Print as a résumé; the same conditions let
          // it go. A block with more words of its own, or a real link's or a submit button's,
          // is still text.
          const words = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let buttons = 0;
          let skips = 0;
          const own: string[] = [];
          for (let node = words.nextNode(); node; node = words.nextNode()) {
            const said = node.textContent?.trim();
            if (!said) continue;
            const button = node.parentElement?.closest('button') ?? null;
            const link = node.parentElement?.closest('a[href]') ?? null;
            if (button && el.contains(button) && inertButton(button)) buttons += 1;
            else if (link && el.contains(link) && skipLink(link)) skips += 1;
            else own.push(...said.split(/\s+/));
          }
          const kind =
            own.length === 0 && skips === 0
              ? 'button label'
              : buttons + skips > 0 && own.length <= 3
                ? 'control label'
                : 'text';
          add(el, `${scriptOnly(el) ? 'script-only' : kind}: ${value}`);
        }
      }
      for (const el of doc.body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (present(el)) {
          add(
            el,
            `${skipLink(el) ? 'control: skip-link' : 'link:'} ${el.getAttribute('href')} ${nameOf(el)}`,
          );
        }
      }
      for (const el of doc.body.querySelectorAll('img[alt]')) {
        if (el.getAttribute('alt')!.trim() && present(el))
          add(el, `image: ${el.getAttribute('alt')!.trim()}`);
      }
      for (const el of doc.body.querySelectorAll(
        'button, input:not([type=hidden]), select, textarea',
      )) {
        // A button by its type: one that submits a form is an action without
        // JavaScript; one that doesn't is an enhancement.
        const kind =
          el.localName === 'button' ? `button:${(el as HTMLButtonElement).type}` : el.localName;
        if (present(el)) add(el, `control: ${kind} ${nameOf(el)}`);
      }
      return request.paths
        ? [...items].map(([item, el]) => ({ item, path: cssPath(el) }))
        : [...items.keys()];
    }
    case 'script-only-text':
      // Each live status marked data-script-only that holds words as the page stands: read without
      // JavaScript, the server's own words, which the mark may not excuse. A mark on any other
      // element is ignored, here as in the inventory.
      return [...doc.querySelectorAll('[data-script-only]')]
        .filter(liveStatus)
        .map((el) => ({
          path: cssPath(el),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        }))
        .filter(({ text: words }) => words !== '');
    case 'structure': {
      const skip = doc.querySelector<HTMLAnchorElement>('a[href^="#"]');
      const target = skip ? doc.getElementById(decodeURIComponent(skip.hash.slice(1))) : null;
      return {
        mains: doc.querySelectorAll('main, [role=main]').length,
        h1s: [...doc.querySelectorAll('h1')].filter(present).length,
        skip: skip ? cssPath(skip) : null,
        skipTarget: target ? cssPath(target) : null,
        fragments: [...doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
          .filter((a) => a.hash.length > 1 && present(a))
          .map((a) => ({
            path: cssPath(a),
            href: a.getAttribute('href')!,
            found: Boolean(doc.getElementById(decodeURIComponent(a.hash.slice(1)))),
          })),
      };
    }
    case 'reflow': {
      const width = doc.documentElement.clientWidth;
      const problems: { rule: string; path: string; detail: string }[] = [];
      const scrollWidth = doc.scrollingElement?.scrollWidth ?? 0;
      if (scrollWidth > width + 1) {
        problems.push({
          rule: 'overflow',
          path: 'html',
          detail: `the page scrolls sideways: ${scrollWidth}px of content in ${width}px`,
        });
      }
      // A leaf inside a visually hidden box (an sr-only heading's span, say) shows nothing to
      // reflow, so no clip of it counts.
      const leaves = [...doc.body.querySelectorAll('*')].filter(
        (el) =>
          (el.matches('a, button, input, select, textarea, img') ||
            [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) &&
          shown(el) &&
          !inVisuallyHidden(el),
      );
      for (const el of leaves) {
        // Inside a declared scroll region a leaf may sit past the viewport:
        // the region scrolls it, and the region itself is judged instead.
        let region: Element | null = null;
        for (let up = el.parentElement; up && up !== doc.body; up = up.parentElement) {
          if (declaredScroller(up)) region = up;
        }
        const r = (region ?? el).getBoundingClientRect();
        if (r.right > width + 1 || r.left < -1) {
          problems.push({
            rule: 'outside',
            path: cssPath(region ?? el),
            detail: `${Math.round(r.left)}px to ${Math.round(r.right)}px, in a ${width}px viewport`,
          });
          continue;
        }
        if (region) continue;
        const style = getComputedStyle(el);
        if (
          /hidden|clip/.test(`${style.overflowX} ${style.overflowY}`) &&
          (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) &&
          text(el)
        ) {
          problems.push({
            rule: 'clipped',
            path: cssPath(el),
            detail: `its own box clips it: ${el.scrollWidth}x${el.scrollHeight} of content in ${el.clientWidth}x${el.clientHeight}`,
          });
          continue;
        }
        // A scroller hides the text a leaf lays out, which can run past the
        // leaf's own box, as a nowrap line does: its extent is the box and
        // the text together.
        const range = doc.createRange();
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect();
        const extent =
          t.width > 0 || t.height > 0
            ? {
                left: Math.min(r.left, t.left),
                right: Math.max(r.right, t.right),
                top: Math.min(r.top, t.top),
                bottom: Math.max(r.bottom, t.bottom),
              }
            : r;
        for (let up = el.parentElement; up && up !== doc.body; up = up.parentElement) {
          const s = getComputedStyle(up);
          const overflow = `${s.overflowX} ${s.overflowY}`;
          if (!/hidden|clip|auto|scroll/.test(overflow)) continue;
          const b = up.getBoundingClientRect();
          const e = /auto|scroll/.test(overflow) ? extent : r;
          if (
            e.left < b.left - 1 ||
            e.right > b.right + 1 ||
            e.top < b.top - 1 ||
            e.bottom > b.bottom + 1
          ) {
            problems.push({
              rule: 'clipped',
              path: cssPath(el),
              detail: /auto|scroll/.test(overflow)
                ? `${cssPath(up)} scrolls it out of view, and no keyboard can reach a named region there`
                : `${cssPath(up)} clips it, with overflow ${overflow}`,
            });
          }
          break;
        }
      }
      return problems;
    }
    case 'transparency': {
      // What a backdrop filter blurs, on any element or an open dialog's
      // ::backdrop, and the boxes of #19's Surface, Dialog, and Navigation,
      // inside their corner radius and border, which the caller tests for
      // see-through pixels by changing what's under them.
      const filters: { path: string; detail: string }[] = [];
      const filterOf = (style: CSSStyleDeclaration) =>
        style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
      const blurs = (filter: string) =>
        Boolean(filter) && filter !== 'none' && !/^(?:blur\(0(?:px)?\)\s*)+$/.test(filter);
      for (const el of doc.querySelectorAll('*')) {
        const filter = filterOf(getComputedStyle(el));
        if (blurs(filter) && shown(el))
          filters.push({ path: cssPath(el), detail: `backdrop-filter: ${filter}` });
      }
      for (const dialog of doc.querySelectorAll('dialog')) {
        if (!dialog.matches(':modal')) continue;
        const filter = filterOf(getComputedStyle(dialog, '::backdrop'));
        if (blurs(filter))
          filters.push({
            path: `${cssPath(dialog)}::backdrop`,
            detail: `backdrop-filter: ${filter}`,
          });
      }
      const surfaces = [
        ...doc.querySelectorAll(
          '[data-ui-slot=surface], [data-ui-slot=dialog], [data-ui-slot=navigation], dialog[open], [role=dialog]',
        ),
      ]
        // Only a part with a fill of its own: one with none isn't a material, translucent or not.
        .filter((el) => {
          const s = getComputedStyle(el);
          return shown(el) && (s.backgroundImage !== 'none' || alphaOf(s.backgroundColor) > 0);
        })
        .map((el) => {
          const s = getComputedStyle(el);
          const radius = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(
            (corner) => Number.parseFloat(s.getPropertyValue(`border-${corner}-radius`)) || 0,
          );
          const border = ['top', 'right', 'bottom', 'left'].map(
            (side) => Number.parseFloat(s.getPropertyValue(`border-${side}-width`)) || 0,
          );
          return { path: cssPath(el), inset: Math.max(...radius) + Math.max(...border) };
        });
      return { filters, surfaces };
    }
    case 'box': {
      const el = find(request.path);
      return el ? boxOf(el) : null;
    }
    case 'stop': {
      const el = find(request.path);
      if (!el) return null;
      const fragments = fragmentsOf(el);
      let holder = el.parentElement;
      while (holder && getComputedStyle(holder).display === 'contents')
        holder = holder.parentElement;
      const holderBox = holder ? boxOf(holder) : null;
      const inViewport = (b: Box) =>
        b.x + b.width > 0 && b.y + b.height > 0 && b.x < innerWidth && b.y < innerHeight;
      const own = getComputedStyle(el);
      const held = holder ? getComputedStyle(holder) : null;
      // Skipped by an ancestor's content-visibility: hidden, or auto and off-screen.
      let skipped = false;
      for (let up = el.parentElement; up && !skipped; up = up.parentElement)
        skipped = getComputedStyle(up).contentVisibility === 'hidden';
      const check = (el as HTMLElement).checkVisibility?.bind(el as HTMLElement);
      if (!skipped && check && check() && !check({ contentVisibilityAuto: true })) skipped = true;
      return {
        box: boxOf(el),
        ...(fragments.length > 1 ? { fragments } : {}),
        shown: shown(el),
        holderShown: !holder || (shown(holder) && inViewport(holderBox!)),
        // Rendered, as display: none isn't, 1px or less both ways, and clipped: not a box
        // collapsed one way, such as a max-height: 0 dropdown.
        holderHidden: Boolean(
          holderBox &&
          held &&
          holder!.getClientRects().length > 0 &&
          held.visibility === 'visible' &&
          holderBox.width <= 1 &&
          holderBox.height <= 1 &&
          (/inset\(50%\)/.test(held.clipPath) ||
            /^rect\(/.test(held.clip) ||
            /hidden|clip/.test(`${held.overflowX} ${held.overflowY}`)),
        ),
        holderBox,
        ownVisible: own.visibility === 'visible' && Number(own.opacity) > 0 && !skipped,
        focused: doc.activeElement === el,
      } satisfies Stop;
    }
    case 'named': {
      const wanted = request.name.trim().toLowerCase();
      const el = [...doc.querySelectorAll(FOCUSABLE)].find(
        (each) => nameOf(each).toLowerCase() === wanted && shown(each),
      );
      return el
        ? {
            path: cssPath(el),
            tag: el.localName,
            expanded: el.getAttribute('aria-expanded'),
            pressed: el.getAttribute('aria-pressed'),
          }
        : null;
    }
  }
}

const SOURCE = probe.toString();

/** Runs `request` in `page`. */
export function inPage<T>(page: Page, request: ProbeRequest): Promise<T> {
  // A comma expression: tsx's __name, which the source may call, defined first.
  return page.evaluate(
    `(globalThis.__name ??= (f) => f, (${SOURCE})(${JSON.stringify(request)}))`,
  ) as Promise<T>;
}
