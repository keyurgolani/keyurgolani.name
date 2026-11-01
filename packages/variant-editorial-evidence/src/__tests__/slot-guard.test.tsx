import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CURATED } from '../__fixtures__/shapes';
import { PACKAGE_DIR, pairOf, render } from './harness';

// The slot guard (EE-LANG, code review M3 and r2 L-1): EE renders some parts as the shared
// primitives (Surface, Action, Disclosure), and the language styles those; EE's stylesheet may lay
// them out and never paint them. Which elements are the primitives' comes from EE's own rendered
// markup, not a hand list: every class on an element carrying data-ui-slot, and, for one with no
// class of its own, its tag under each classed ancestor. A rule fails when its subject is one of
// them, or [data-ui-slot] itself, through a class, a compound, :is() or :where() (a state after
// them too), a descendant or child, CSS nesting, or ::before and ::after (which paint over the
// part whatever they set), and it sets anything but layout. `display: contents` or `none` isn't
// layout on a slot: it drops the box and its paint, so only EE's named unboxings pass (P3 L-3).

/** What the rendered markup says the primitives' elements are. */
interface SlotElements {
  /** Classes on an element that carries data-ui-slot. */
  readonly classes: ReadonlySet<string>;
  /** `ancestor class|tag` for a slot element with no class: its tag under each classed ancestor. */
  readonly pairs: ReadonlySet<string>;
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Walks server-rendered markup and collects the primitives' elements in it. */
export function slotElements(html: string): SlotElements {
  const classes = new Set<string>();
  const pairs = new Set<string>();
  const stack: { tag: string; classes: string[] }[] = [];
  for (const [, close, tag, attributes] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const name = tag!.toLowerCase();
    if (close) {
      const at = stack.map((each) => each.tag).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const own = (/\sclass="([^"]*)"/.exec(attributes!)?.[1] ?? '').split(/\s+/).filter(Boolean);
    if (/\sdata-ui-slot="/.test(attributes!)) {
      if (own.length > 0) for (const each of own) classes.add(each);
      else
        for (const ancestor of stack)
          for (const each of ancestor.classes) pairs.add(`${each}|${name}`);
    }
    if (!VOID.has(name) && !attributes!.trimEnd().endsWith('/'))
      stack.push({ tag: name, classes: own });
  }
  return { classes, pairs };
}

/** `text`'s top-level parts split at `separator`, outside parentheses, brackets and strings. */
function split(text: string, separator: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, i + 1);
      current += text.slice(i, end < 0 ? text.length : end + 1);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (depth === 0 && separator(char)) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const selectorList = (text: string) => split(text, (char) => char === ',');
/** A complex selector's compounds, in order, its combinators dropped. */
const compounds = (selector: string) =>
  split(selector, (char) => /[\s>+~]/.test(char)).filter((part) => !/^[>+~]$/.test(part));

/** `compound` with every functional pseudo-class's arguments taken out, and those it held. */
function pseudoFunctions(compound: string): {
  bare: string;
  functions: { name: string; args: string }[];
} {
  const functions: { name: string; args: string }[] = [];
  let bare = '';
  for (let i = 0; i < compound.length; i++) {
    const open = /^:([\w-]+)\(/.exec(compound.slice(i));
    if (!open) {
      bare += compound[i];
      continue;
    }
    let depth = 0;
    let end = i + open[0].length - 1;
    for (; end < compound.length; end++) {
      if (compound[end] === '(') depth++;
      if (compound[end] === ')' && --depth === 0) break;
    }
    functions.push({ name: open[1]!.toLowerCase(), args: compound.slice(i + open[0].length, end) });
    i = end;
  }
  return { bare, functions };
}

/**
 * Whether a complex selector's subject is a primitive's element, and whether it reaches it
 * through ::before or ::after. `context` is what comes before it, for a classless part's ancestor.
 */
function subjectOf(
  selector: string,
  slots: SlotElements,
  context = '',
): { slot: boolean; generated: boolean } {
  const parts = compounds(selector);
  const subject = parts.at(-1) ?? '';
  const before = `${context} ${parts.slice(0, -1).join(' ')}`;
  const { bare, functions } = pseudoFunctions(subject);
  const generated = /::(?:before|after)\b|:(?:before|after)\b/i.test(bare);
  let slot = false;
  // :is(), :where() and :matches() hold alternatives for the subject itself; :not() and :has() don't.
  for (const each of functions) {
    if (!['is', 'where', 'matches', '-webkit-any'].includes(each.name)) continue;
    for (const alternative of selectorList(each.args)) {
      if (subjectOf(alternative, slots, before).slot) slot = true;
    }
  }
  const excluded = functions.some(
    (each) => each.name === 'not' && /\[data-ui-slot/.test(each.args),
  );
  if (/\[data-ui-slot/.test(bare)) slot = true;
  for (const [, name] of bare.matchAll(/\.([\w-]+)/g)) if (slots.classes.has(name!)) slot = true;
  const tag = /^([a-z][\w-]*)/i.exec(bare)?.[1]?.toLowerCase();
  if (tag && !excluded) {
    for (const [, name] of before.matchAll(/\.([\w-]+)/g)) {
      if (slots.pairs.has(`${name}|${tag}`)) slot = true;
    }
  }
  return { slot, generated };
}

const LAYOUT =
  /^(?:display|position|inset(?:-[\w-]+)?|grid(?:-[\w-]+)?|flex(?:-[\w-]+)?|order|(?:align|justify|place)-[\w-]+|(?:row-|column-)?gap|padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|(?:min-|max-)?(?:inline|block)-size|z-index|content-visibility)$/;

/** One declaration: its rule's full selectors, the at-rules it sits in, and what it sets. */
interface Declaration {
  readonly selectors: string[];
  /** Its enclosing at-rules' preludes, outermost first, whitespace collapsed, joined by ` / `. */
  readonly at: string;
  readonly property: string;
  readonly value: string;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Every declaration with the full selectors of its rule, CSS nesting resolved, keyframes skipped. */
function declarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Declaration[] = [];
  const stack: { selectors: string[] | null; skip: boolean; at: string[] }[] = [
    { selectors: null, skip: false, at: [] },
  ];
  let buffer = '';
  const declare = () => {
    const frame = stack.at(-1)!;
    const colon = buffer.indexOf(':');
    const property = buffer.slice(0, colon).trim().toLowerCase();
    if (frame.selectors && !frame.skip && property && colon >= 0) {
      out.push({
        selectors: frame.selectors,
        at: frame.at.join(' / '),
        property,
        value: collapse(buffer.slice(colon + 1)),
      });
    }
    buffer = '';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, i + 1);
      buffer += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const parent = stack.at(-1)!;
      if (prelude.startsWith('@')) {
        stack.push({
          selectors: parent.selectors,
          skip: parent.skip || /^@(?:-\w+-)?keyframes\b/i.test(prelude),
          at: [...parent.at, collapse(prelude)],
        });
      } else {
        const own = selectorList(prelude);
        const selectors = parent.selectors
          ? parent.selectors.flatMap((outer) =>
              own.map((inner) =>
                inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`,
              ),
            )
          : own;
        stack.push({ selectors, skip: parent.skip, at: parent.at });
      }
    } else if (char === ';') declare();
    else if (char === '}') {
      if (buffer.trim()) declare();
      buffer = '';
      if (stack.length > 1) stack.pop();
    } else buffer += char;
  }
  return out;
}

/**
 * `display: contents` or `none` lays nothing out: it takes the slot's box away, and the language's
 * frame, radius, shadow and material with it (EE-LANG P3, L-3). So on a slot it counts as paint,
 * except for the unboxings EE means, each named here with its selector, its at-rules and why.
 */
const UNBOX = /^(?:contents|none)\b/i;
const V = "[data-variant='editorial-evidence']";
const SANCTIONED_UNBOXINGS: readonly { selector: string; at: string; value: string }[] = [
  // In the notes column the fact sheet is ruled, not carded (N-1): the list takes the tone.
  { selector: `${V} .ee-case__facts`, at: '@media (width >= 48rem)', value: 'contents' },
  // Beside the head column the contents is always open: its column is the index, EE's own.
  {
    selector: `${V} .ee-contents__details > summary`,
    at: '@media (width >= 81.25rem) / @supports selector(::details-content)',
    value: 'none',
  },
  {
    selector: `${V} .ee-contents :is(.ee-contents__details, .ee-contents__details > div)`,
    at: '@media (width >= 81.25rem) / @supports selector(::details-content)',
    value: 'contents',
  },
  {
    selector: `${V} .ee-contents__details::details-content`,
    at: '@media (width >= 81.25rem) / @supports selector(::details-content)',
    value: 'contents',
  },
  // In print it's open too, the summary with nothing to press.
  { selector: `${V} .ee-contents__details > summary`, at: '@media print', value: 'none' },
  // The summary's own marker, which the browser draws and the language never styles.
  {
    selector: `${V} .ee-contents__details > summary::-webkit-details-marker`,
    at: '',
    value: 'none',
  },
];

const sanctioned = (selector: string, at: string, value: string) =>
  SANCTIONED_UNBOXINGS.some(
    (each) =>
      collapse(selector) === each.selector && at === each.at && value.startsWith(each.value),
  );

/** Each rule that paints a primitive's element: `selector { property }`. */
export function slotPaint(css: string, slots: SlotElements): string[] {
  const found = new Set<string>();
  for (const { selectors, at, property, value } of declarations(css)) {
    for (const selector of selectors) {
      const { slot, generated } = subjectOf(selector, slots);
      if (!slot) continue;
      const unboxes =
        property === 'display' && UNBOX.test(value) && !sanctioned(selector, at, value);
      if (generated || unboxes || !LAYOUT.test(property)) {
        found.add(
          `${selector} { ${property}${unboxes ? `: ${value}` : ''} }${at ? ` in ${at}` : ''}`,
        );
      }
    }
  }
  return [...found];
}

/** EE's pages as the fixtures render them: home, a case, and a featured plate with a picture. */
function rendered(): string {
  const covered = structuredClone(CURATED) as typeof CURATED & {
    works: { id: string; cover?: { asset: string } }[];
  };
  covered.works.find((work) => work.id === 'atlas')!.cover = { asset: 'ledger-entry' };
  return [
    render(pairOf(CURATED)),
    render(pairOf(covered)),
    render(pairOf(CURATED), { route: { route: 'work', slug: 'ledger' } }),
  ].join('\n');
}

const css = () => readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');

test('the rendered pages name the primitives EE renders: its mats, its fact sheet, its two disclosures and its action', () => {
  const slots = slotElements(rendered());
  for (const name of [
    'ee-lead__frame',
    'ee-plate__mat',
    'ee-case__plate',
    'ee-case__facts',
    'ee-contents__details',
    'ee-archive',
  ]) {
    assert.ok(slots.classes.has(name), name);
  }
  for (const pair of [
    'ee-contents__details|summary',
    'ee-contents__details|div',
    'ee-archive|summary',
    'ee-archive|div',
    'ee-lead__go|a',
  ]) {
    assert.ok(slots.pairs.has(pair), pair);
  }
});

test("EE lays the primitives' elements out and never paints them: no colour, border, radius, shadow, type, material or generated content on a slot", () => {
  assert.deepEqual(slotPaint(css(), slotElements(rendered())), []);
});

test('the slot guard refuses paint on a slot in every form a selector can reach it by', () => {
  const slots = slotElements(rendered());
  const v = "[data-variant='editorial-evidence']";
  const planted = [
    `${v} .ee-plate__mat { border-radius: 0 }`,
    `${v} :where(.ee-plate__mat) { border-radius: 0 }`,
    `${v} :is(.ee-plate__mat, .ee-case__plate):hover { border-color: red }`,
    `${v} :is(.ee-lead:has(.x) .ee-lead__frame) { background: none }`,
    `${v} .ee-plate__mat { & { border: 0 } }`,
    `${v} .ee-contents__details { & > summary { color: red } }`,
    `${v} .ee-plate__mat.x { box-shadow: none }`,
    `${v} .ee-plate__mat[data-emphasis] { box-shadow: none }`,
    `${v} .ee-contents__details summary { color: red }`,
    `${v} .ee-contents__details > summary { color: red }`,
    `${v} [data-ui-slot='surface'] { border: 0 }`,
    `${v} .ee-lead__frame::before { content: '' }`,
    `${v} .ee-lead__frame::after { inset: 0 }`,
    `${v} .ee-archive { border-block: 0 }`,
    `${v} .ee-archive > div { padding-block: 0; color: red }`,
    `${v} .ee-lead__go a { font-size: 1rem }`,
    `@media (width < 1px) { ${v} .ee-case__facts { background: none } }`,
  ];
  for (const rule of planted) assert.equal(slotPaint(rule, slots).length, 1, rule);
  // Layout on a slot passes, and so does paint beside one or on a non-slot link.
  for (const rule of [
    `${v} .ee-plate__mat { grid-column: 1 / -1; padding: 0 }`,
    `${v} .ee-lead__frame .pf-media-box { background: none }`,
    `${v} .ee-contents__details > summary::-webkit-details-marker { display: none }`,
    `${v} :where(a:not([data-ui-slot])) { color: red }`,
    `${v} .ee-lead__go { font-size: 1rem }`,
    `@keyframes x { from { color: red } }`,
  ]) {
    assert.deepEqual(slotPaint(rule, slots), [], rule);
  }
});

test("the slot guard refuses display: contents or none on a slot, outside EE's named unboxings (L-3)", () => {
  const slots = slotElements(rendered());
  // Each takes a slot's box away, the language's frame, radius, shadow and material with it.
  for (const rule of [
    `${V} .ee-plate__mat { display: contents }`,
    `${V} .ee-lead__frame { display: none }`,
    `${V} .ee-archive { display: contents }`,
    `${V} .ee-archive > div { display: contents }`,
    `${V} :is(.ee-case__plate, .x) { display: contents }`,
    `${V} .ee-case__plate { & { display: none !important } }`,
    // A named unboxing, at another width or under another selector, is still refused.
    `${V} .ee-case__facts { display: contents }`,
    `@media (width >= 30rem) { ${V} .ee-case__facts { display: contents } }`,
    `@media (width >= 48rem) { ${V} .ee-main .ee-case__facts { display: contents } }`,
    `@media (width >= 48rem) { ${V} .ee-case__facts { display: none } }`,
  ]) {
    assert.deepEqual(
      slotPaint(rule, slots).map((each) => / \{ display: (?:contents|none)/.test(each)),
      [true],
      rule,
    );
  }
  // The named ones pass where they are named, and other displays on a slot are layout.
  for (const rule of [
    `@media (width >= 48rem) { ${V} .ee-case__facts { display: contents } }`,
    `@media print { ${V} .ee-contents__details > summary { display: none } }`,
    `${V} .ee-plate__mat { display: grid }`,
    `${V} .ee-archive > div { display: flex }`,
    `${V} .ee-lead__frame .pf-media-box { display: none }`,
  ]) {
    assert.deepEqual(slotPaint(rule, slots), [], rule);
  }
});
