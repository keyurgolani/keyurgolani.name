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
  readonly hit: string;
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
  | { readonly kind: 'inventory' }
  | { readonly kind: 'structure' }
  | { readonly kind: 'reflow' }
  | { readonly kind: 'transparency' }
  | { readonly kind: 'box'; readonly path: string }
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
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
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
  const tabbable = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (h.tabIndex < 0 || h.hasAttribute('disabled') || h.closest('[inert]')) return false;
    if (el.closest('details:not([open])') && el.localName !== 'summary') return false;
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
      const cx = Math.min(Math.max(box.x + box.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(box.y + box.height / 2, 0), vh - 1);
      const hit = doc.elementFromPoint(cx, cy);
      const label = hit?.closest('label') as HTMLLabelElement | null;
      return {
        none: false,
        path: cssPath(el),
        tag: el.localName,
        box,
        shown: shown(el),
        inView: box.x + box.width > 0 && box.y + box.height > 0 && box.x < vw && box.y < vh,
        hitsItself: Boolean(hit && (hit === el || el.contains(hit) || label?.control === el)),
        hit: hit ? cssPath(hit) : '',
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
      const selectors = new Set<string>();
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
            if (subject) selectors.add(subject);
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
      const targets = new Set<Element>();
      for (const selector of selectors) {
        try {
          for (const el of doc.querySelectorAll(selector)) if (shown(el)) targets.add(el);
        } catch {
          // A selector the engine keeps but querySelectorAll refuses, such as a pseudo-element.
        }
      }
      return [...targets].slice(0, request.limit).map(cssPath);
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
      // links with their targets, images by alt, and controls by name.
      const items = new Set<string>();
      for (const el of doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
        if (present(el)) items.add(`heading: ${text(el)}`);
      }
      for (const el of doc.body.querySelectorAll(
        'p, li, dd, dt, td, th, figcaption, blockquote, time, pre',
      )) {
        const value = text(el);
        if (value && present(el) && !el.querySelector('p, li, dd, dt, td, th, blockquote, pre')) {
          items.add(`text: ${value}`);
        }
      }
      for (const el of doc.body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (present(el)) items.add(`link: ${el.getAttribute('href')} ${nameOf(el)}`);
      }
      for (const el of doc.body.querySelectorAll('img[alt]')) {
        if (el.getAttribute('alt')!.trim() && present(el))
          items.add(`image: ${el.getAttribute('alt')!.trim()}`);
      }
      for (const el of doc.body.querySelectorAll(
        'button, input:not([type=hidden]), select, textarea',
      )) {
        // A button by its type: one that submits a form is an action without
        // JavaScript; one that doesn't is an enhancement.
        const kind =
          el.localName === 'button' ? `button:${(el as HTMLButtonElement).type}` : el.localName;
        if (present(el)) items.add(`control: ${kind} ${nameOf(el)}`);
      }
      return [...items];
    }
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
      const leaves = [...doc.body.querySelectorAll('*')].filter(
        (el) =>
          (el.matches('a, button, input, select, textarea, img') ||
            [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) &&
          shown(el),
      );
      for (const el of leaves.slice(0, 3000)) {
        const r = el.getBoundingClientRect();
        if (r.right > width + 1 || r.left < -1) {
          problems.push({
            rule: 'outside',
            path: cssPath(el),
            detail: `${Math.round(r.left)}px to ${Math.round(r.right)}px, in a ${width}px viewport`,
          });
          continue;
        }
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
        for (let up = el.parentElement; up && up !== doc.body; up = up.parentElement) {
          const s = getComputedStyle(up);
          const overflow = `${s.overflowX} ${s.overflowY}`;
          if (!/hidden|clip|auto|scroll/.test(overflow)) continue;
          // A declared scroll region: it scrolls, a keyboard can reach it, and it has a name.
          if (
            /auto|scroll/.test(overflow) &&
            ((up as HTMLElement).tabIndex >= 0 || up.querySelector(FOCUSABLE)) &&
            nameOf(up)
          )
            break;
          if (/auto|scroll/.test(overflow)) continue;
          const b = up.getBoundingClientRect();
          if (
            r.left < b.left - 1 ||
            r.right > b.right + 1 ||
            r.top < b.top - 1 ||
            r.bottom > b.bottom + 1
          ) {
            problems.push({
              rule: 'clipped',
              path: cssPath(el),
              detail: `${cssPath(up)} clips it, with overflow ${overflow}`,
            });
          }
          break;
        }
      }
      return problems;
    }
    case 'transparency': {
      const problems: { rule: string; path: string; detail: string }[] = [];
      for (const el of doc.querySelectorAll('*')) {
        const style = getComputedStyle(el);
        const filter = style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter');
        // blur(0px), what reduced transparency sets the blur token to, filters nothing.
        if (
          filter &&
          filter !== 'none' &&
          !/^(?:blur\(0(?:px)?\)\s*)+$/.test(filter) &&
          shown(el)
        ) {
          problems.push({
            rule: 'backdrop-filter',
            path: cssPath(el),
            detail: `backdrop-filter: ${filter}`,
          });
        }
        if (
          !el.matches(
            '[data-ui-slot=surface], [data-ui-slot=dialog], [data-ui-slot=navigation], dialog, [role=dialog]',
          )
        )
          continue;
        const alpha = /rgba?\([^)]*[,/]\s*([\d.]+%?)\s*\)/.exec(style.backgroundColor)?.[1];
        const value =
          alpha === undefined
            ? 1
            : alpha.endsWith('%')
              ? Number.parseFloat(alpha) / 100
              : Number(alpha);
        if (value > 0 && value < 1 && shown(el)) {
          problems.push({
            rule: 'opaque',
            path: cssPath(el),
            detail: `background-color ${style.backgroundColor} lets what's behind it through`,
          });
        }
      }
      return problems;
    }
    case 'box': {
      const el = find(request.path);
      return el ? boxOf(el) : null;
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
