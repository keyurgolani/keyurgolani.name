// The stylesheet half of the variant source audit (#5, Slice 3, item 5): a
// variant's CSS stays inside its own [data-variant] scope, nested rules and
// sibling combinators included, names its keyframes after its id, loads
// nothing from another host or another package, and leaves color, type,
// radius, and shadow to #19's appearance tokens. A variant that declares rtl
// uses logical properties, shorthands included.
//
// K-5: a color-mix() of roles, currentColor, and transparent is a token where a
// color goes, and a mask on a ::before or ::after may name black, white, and
// transparent, which a mask reads for their alpha alone. A radius or a shadow
// reads tokens alone, as the appearance source audit holds it, and a radius
// may read --layout-round where the stylesheet declares it 50%. A variant
// declares no custom property in the platform's namespaces (--color-, --ui-,
// --type-, --space-, --motion-, --rhythm-) but those ../tokens allows, and a
// token reader takes only a token ../tokens lists, never a name a variant
// could declare its way into. A -webkit- or other vendor prefix doesn't
// hide a property, and a named color is a color in any image value too. A
// clip-path's or a shape-outside's `round` is a radius, held as one.
//
// K-5 rounds 3 to 5: the audit judges the tokens PostCSS reads (./css), on a
// strict grammar that fails closed, since this is the one gate a third-party
// variant's stylesheet meets:
// - a stylesheet PostCSS can't parse is refused (audit.css-syntax);
// - no backslash anywhere, in a name, a selector, a value, or a string
//   (audit.css-escape). A first-party package's `content` string alone may
//   hold a printable `\<hex>` escape, as `'\201C'`; the package's scope
//   decides first party, never the stylesheet;
// - a string only in content, font-feature-settings, font-variation-settings,
//   a quoted url() or @import, and grid-template-areas, grid-template, and
//   grid, whose strings name areas alone (audit.css-string);
// - a url() or an @import only as a quoted path inside the package, with no
//   scheme, `//`, `%`, or var() (audit.css-remote-url, audit.css-remote-import);
// - no !important (audit.css-important);
// - a duration, vendor-prefixed too, reads a motion token or a motion slot
//   or is 0, scales a token by a factor in (0, 4], and an infinite loop's
//   reads the ambient slot; a slot holds a value in its band (MOTION_BANDS);
// - a font family is a --type-*-font-family token or a generic family;
// - attr() reads only a plain attribute, in content;
// - a system color only under @media (forced-colors: active), and
//   hue-rotate(), sepia(), saturate(), and invert() read tokens alone.
//
// K-5 round 6: a third party's selector or at-rule prelude holds no comment
// (audit.css-syntax), and the scope is read on the selector with its comments
// out, as a browser reads it, for every package: a comment holding a quote or
// a bracket hides no comma or combinator. Every complex selector starts with
// the scope's compound, and the first combinator after it is a descendant or
// `>`: `~`, `+`, or `||` there reaches the scope's siblings, and so does a
// :has(), :is(), :where(), or :not() on the scope's compound whose argument
// starts with `~` or `+`. Past the scope, inside it, siblings are the
// variant's own.
//
// K-5 round 7 (R6-H1): a variant's stylesheet uses @media, @supports, @layer,
// @container, @keyframes, and @import alone (../at-rules), and a @supports
// selector() tests one compound of pseudo-classes and pseudo-elements; any
// other at-rule, @scope, @font-face, and @property among them, is
// audit.css-at-rule, for every package.
//
// K-4 (a): a variant whose manifest opts in to cross-document view
// transitions may target its own names, the manifest's transitions.names,
// with ::view-transition-group(), -image-pair(), -old(), and -new(), on the
// document's root, which the pseudo-elements hang from: bare, after :root
// or html, or after the scope's compound, optionally then :only-child, and
// nothing else. It may give an element one of those names with
// view-transition-name. Any other view-transition pseudo-element, target,
// or name, any view-transition-class, and all of them in a variant that
// doesn't opt in, are audit.css-view-transition. @view-transition stays
// audit.css-at-rule: the host writes it (../transitions). So are the host's
// reduced-motion fades, `_portfolio-vt-*`: a variant's keyframes can't take
// the name, and an animation that names them is audit.css-keyframes.

import { variantAtRuleProblem } from '../at-rules';
import { HOST_KEYFRAMES_PREFIX, TRANSITION_PSEUDO_ELEMENTS } from '../transitions';
import { shapeRadii } from '../shapes';
import { motionSlotValue, MOTION_SLOT } from '../motion-bands';
import { stripCssComments } from '../css-text';
import { isPlatformToken, isReservedProperty } from '../tokens';
import { cssTokens, parseCssText, splitSelectors, type CssNode, type Position } from './css';

/** The codes this module reports, which audit.ts describes. */
export type CssCode =
  | 'audit.css-unscoped'
  | 'audit.css-remote-import'
  | 'audit.css-remote-url'
  | 'audit.css-bare-import'
  | 'audit.css-keyframes'
  | 'audit.css-physical'
  | 'audit.css-appearance'
  | 'audit.css-escape'
  | 'audit.css-syntax'
  | 'audit.css-important'
  | 'audit.css-string'
  | 'audit.css-at-rule'
  | 'audit.css-view-transition';

export type CssReport = (code: CssCode, at: Position, message: string) => void;

export interface StylesheetTarget {
  /** The variant's id, the scope every selector starts with. */
  readonly id: string;
  /** Whether it declares rtl, which brings the physical-CSS rule. */
  readonly rtl: boolean;
  /**
   * Whether the package is the platform's own, by its scope (`@portfolio/`), as the registry
   * names it: its `content` strings may hold printable escapes. Never read from the stylesheet.
   */
  readonly firstParty?: boolean;
  /**
   * The manifest's transitions.names when it opts in to cross-document view
   * transitions (K-4 (a)), or null or left out when it doesn't, which
   * refuses every view-transition pseudo-element and name.
   */
  readonly transitions?: readonly string[] | null;
}

/** At-rules whose blocks hold descriptors, which say what a font or a page is, not how anything looks. */
const DESCRIPTOR_BLOCKS = new Set([
  '@font-face',
  '@page',
  '@property',
  '@counter-style',
  '@font-palette-values',
]);
const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes$/i;

/** Where each declaration sits, which decides the rules it gets. */
type Context = 'rules' | 'keyframes' | 'descriptors';

/** Every finding in one of a variant's stylesheets. */
export function auditStylesheet(text: string, target: StylesheetTarget, report: CssReport): void {
  const scope = scopePattern(target.id);
  const firstParty = target.firstParty === true;
  const { nodes, problems } = parseCssText(text);
  reportSyntax(problems, report);
  checkEscapes(text, nodes, firstParty, report);
  const layout = layoutDeclarations(nodes);
  const walk = (
    nodes: readonly CssNode[],
    parents: readonly string[] | null,
    context: Context,
    forced = false,
  ) => {
    const loop = loops(nodes);
    for (const node of nodes) {
      if (node.type === 'at-rule') {
        const prelude = node.rawPrelude ?? node.prelude;
        if (!firstParty && hasComment(prelude)) {
          report(
            'audit.css-syntax',
            node.at,
            `has a comment in the prelude of ${node.name}${prelude.trimEnd()}, which a variant's stylesheet doesn't write.`,
          );
        }
        const atRule = variantAtRuleProblem(node.name, prelude);
        if (atRule) report('audit.css-at-rule', node.at, atRule);
        if (node.name !== '@import' && hasString(node.prelude)) {
          report(
            'audit.css-string',
            node.at,
            `has a string in ${node.name} ${node.prelude}, where only @import may name one.`,
          );
        }
        if (node.name === '@import') {
          checkImport(node.prelude, node.at, report);
          continue;
        }
        if (KEYFRAMES.test(node.name)) {
          const name = unquote(node.prelude.trim());
          if (name.startsWith(HOST_KEYFRAMES_PREFIX)) {
            report(
              'audit.css-keyframes',
              node.at,
              `names keyframes ${name}, in the host's own ${HOST_KEYFRAMES_PREFIX} namespace, which it writes for reduced-motion view transitions.`,
            );
          } else if (name !== target.id && !name.startsWith(`${target.id}-`)) {
            report(
              'audit.css-keyframes',
              node.at,
              `names keyframes ${name}, which doesn't start with ${target.id}-.`,
            );
          }
          walk(node.children ?? [], null, 'keyframes');
          continue;
        }
        walk(
          node.children ?? [],
          parents,
          DESCRIPTOR_BLOCKS.has(node.name) ? 'descriptors' : context,
          forced || forcedColors(node),
        );
      } else if (node.type === 'rule') {
        const written = node.rawSelector ?? node.selector;
        if (!firstParty && hasComment(written)) {
          report(
            'audit.css-syntax',
            node.at,
            `has a comment in the selector ${written.trim()}, which a variant's stylesheet doesn't write.`,
          );
        }
        if (context === 'keyframes') {
          walk(node.children, null, 'keyframes');
          continue;
        }
        // The scope is read on the selector as a browser reads it: comments out, a space each.
        const list = stripCssComments(written);
        const selectors = parents === null ? splitSelectors(list) : nest(parents, list);
        let scoped = true;
        for (const selector of selectors) {
          if (VIEW_TRANSITION_PSEUDO.test(selector)) {
            const problem = viewTransitionProblem(selector, scope, target);
            if (problem) {
              scoped = false;
              report('audit.css-view-transition', node.at, problem);
            }
            continue;
          }
          const problem = scopeProblem(selector, scope, target.id);
          if (problem) {
            scoped = false;
            report('audit.css-unscoped', node.at, problem);
          }
        }
        // A rule already out of scope is reported once, not again for each rule nested in it.
        walk(node.children, scoped ? selectors : null, context, forced);
      } else {
        // A keyframe may set a name too: view-transition-name animates discretely.
        const named = context === 'descriptors' ? undefined : transitionNameProblem(node, target);
        if (named) report('audit.css-view-transition', node.at, named);
        const borrowed = hostKeyframesProblem(node);
        if (borrowed) report('audit.css-keyframes', node.at, borrowed);
        checkDeclaration(node, target, context, report, parents, layout, { forced, loop });
      }
    }
  };
  walk(nodes, null, 'rules');
}

/** The host's keyframes, `_portfolio-vt-*`, as a word in a value. */
const HOST_KEYFRAMES_WORD = new RegExp(`(?<![\\w-])${HOST_KEYFRAMES_PREFIX}[\\w-]*`, 'i');

/** Why an animation names the host's own keyframes (K-4 (a)), which are its reduced-motion fades. */
function hostKeyframesProblem(node: Extract<CssNode, { type: 'declaration' }>): string | undefined {
  const property = node.property.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '');
  if (property !== 'animation' && property !== 'animation-name') return undefined;
  const name = HOST_KEYFRAMES_WORD.exec(node.value)?.[0];
  return name
    ? `animates with ${name}, the host's own keyframes for reduced-motion view transitions, which a variant doesn't run.`
    : undefined;
}

/** A selector that reaches a view-transition pseudo-element, of any kind. */
const VIEW_TRANSITION_PSEUDO = /::view-transition/i;

/**
 * A view-transition pseudo-element rule a variant may write: the root's,
 * bare, after :root or html, or after the scope's compound, one of the
 * pseudo-elements a name targets, its argument, and :only-child at most.
 */
const VIEW_TRANSITION_RULE = new RegExp(
  `^(?<root>:root|html)?::(?<pseudo>${TRANSITION_PSEUDO_ELEMENTS.join('|')})\\(\\s*(?<name>[^()]*?)\\s*\\)(?::only-child)?$`,
  'i',
);

/**
 * What's wrong with a selector that reaches a view-transition pseudo-element, its comments
 * out, or undefined when the variant may write it (K-4 (a)).
 */
function viewTransitionProblem(
  selector: string,
  scope: RegExp,
  target: StylesheetTarget,
): string | undefined {
  const names = target.transitions ?? null;
  if (names === null) {
    return `has the selector ${selector}, a view-transition pseudo-element, and the manifest doesn't opt in to view transitions: set transitions.crossDocument to true and list the names in transitions.names.`;
  }
  const trimmed = selector.trim();
  const scoped = scope.exec(trimmed);
  const match = VIEW_TRANSITION_RULE.exec(scoped ? trimmed.slice(scoped[0].length) : trimmed);
  if (!match || (scoped && match.groups!.root)) {
    return `has the selector ${selector}, which a view-transition rule isn't: write ::view-transition-group(), -image-pair(), -old(), or -new() of one of your names, bare, after :root or html, or after [data-variant="${target.id}"], with :only-child at most after it.`;
  }
  const name = match.groups!.name!;
  if (!names.includes(name)) {
    return `has the selector ${selector}, whose ${name || 'empty argument'} isn't one of the manifest's transitions.names${names.length > 0 ? `: ${names.join(', ')}` : ', which is empty'}. A variant targets its own names alone, never *, root, or a class.`;
  }
  return undefined;
}

/**
 * Why a declaration names a view transition it may not (K-4 (a)): a view-transition-name
 * other than none or one of the manifest's names, or one in a variant that doesn't opt in,
 * and any view-transition-class but none.
 */
function transitionNameProblem(
  node: Extract<CssNode, { type: 'declaration' }>,
  target: StylesheetTarget,
): string | undefined {
  // A vendor prefix doesn't hide the property, as anywhere else in the audit.
  const property = node.property.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '');
  if (property !== 'view-transition-name' && property !== 'view-transition-class') return undefined;
  const value = node.value.trim();
  if (value.toLowerCase() === 'none') return undefined;
  if (property === 'view-transition-class') {
    return `sets view-transition-class: ${value}, and a variant's transitions target its names alone.`;
  }
  const names = target.transitions ?? null;
  if (names === null) {
    return `sets view-transition-name: ${value}, and the manifest doesn't opt in to view transitions: set transitions.crossDocument to true and list the name in transitions.names.`;
  }
  if (!names.includes(value)) {
    return `sets view-transition-name: ${value}, which isn't none or one of the manifest's transitions.names${names.length > 0 ? `: ${names.join(', ')}` : ', which is empty'}.`;
  }
  return undefined;
}

/** Whether an at-rule is `@media (forced-colors: active)`, under which a system color is the page's own. */
function forcedColors(node: Extract<CssNode, { type: 'at-rule' }>): boolean {
  return (
    node.name === '@media' &&
    /\(\s*forced-colors\s*:\s*active\s*\)/i.test(node.prelude) &&
    !/\bnot\b/i.test(node.prelude)
  );
}

/** Whether a rule's declarations run an infinite animation: the `infinite` keyword, or an iteration count of it. */
function loops(nodes: readonly CssNode[]): boolean {
  return nodes.some(
    (node) =>
      node.type === 'declaration' &&
      /^(?:-(?:webkit|moz|ms|o)-)?animation(?:-iteration-count)?$/.test(node.property) &&
      /(?<![\w-])infinite(?![\w-])/i.test(node.value),
  );
}

/** Whether `text` holds a comment, as PostCSS's tokenizer reads it. */
function hasComment(text: string): boolean {
  return cssTokens(text).some((token) => token.type === 'comment');
}

/** Whether `text` holds a quoted string, as PostCSS's tokenizer reads it. */
function hasString(text: string): boolean {
  return cssTokens(text).some((token) => token.type === 'string');
}

/**
 * Every backslash in the stylesheet, outside its comments (K-5 round 5), once a line. A
 * first-party package's `content` string alone may hold `\` and 1 to 6 hex digits, and one
 * space, naming a printable character.
 */
function checkEscapes(
  text: string,
  nodes: readonly CssNode[],
  firstParty: boolean,
  report: CssReport,
): void {
  const content: { start: number; end: number }[] = [];
  const collect = (list: readonly CssNode[]) => {
    for (const node of list) {
      if (node.type === 'declaration') {
        if (node.property === 'content' && node.start !== undefined && node.end !== undefined)
          content.push({ start: node.start, end: node.end });
      } else collect(node.children ?? []);
    }
  };
  if (firstParty) collect(nodes);
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === '\n') starts.push(index + 1);
  const reported = new Set<number>();
  for (const token of cssTokens(text)) {
    if (token.type === 'comment' || !token.text.includes('\\') || token.start === undefined)
      continue;
    const at = token.start;
    if (
      token.type === 'string' &&
      content.some(({ start, end }) => start <= at && at < end) &&
      printableEscapes(token.text.slice(1, -1))
    )
      continue;
    const line = starts.findLastIndex((start) => start <= at) + 1;
    if (reported.has(line)) continue;
    reported.add(line);
    report(
      'audit.css-escape',
      { line, column: at - starts[line - 1]! + 1 },
      firstParty
        ? `writes ${token.text}, a backslash outside a content string's printable \\<hex> escape.`
        : `writes ${token.text} with a backslash, which a variant's stylesheet holds nowhere.`,
    );
  }
}

/** Code points a content escape may not name: quotes, the backslash, brackets, `;`, `<`, `>`. */
const ESCAPE_REFUSED = new Set([0x22, 0x27, 0x5c, 0x7b, 0x7d, 0x28, 0x29, 0x3b, 0x3c, 0x3e]);

/** Whether every backslash in a string's text is `\<1 to 6 hex>` and one optional space, naming a printable character. */
function printableEscapes(text: string): boolean {
  for (let index = text.indexOf('\\'); index !== -1; index = text.indexOf('\\', index + 1)) {
    const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(index + 1, index + 7));
    if (!hex) return false;
    const point = Number.parseInt(hex[0], 16);
    if (
      point < 0x20 ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point > 0x10ffff ||
      ESCAPE_REFUSED.has(point) ||
      point === 0x061c ||
      point === 0x200e ||
      point === 0x200f ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069)
    )
      return false;
  }
  return true;
}

/** The appearance findings alone, for a stylesheet such as the kit's, which has no scope of its own. */
export function auditAppearance(text: string, report: CssReport): void {
  const { nodes: parsed, problems } = parseCssText(text);
  reportSyntax(problems, report);
  // The kit is first party: its content strings may hold printable escapes.
  checkEscapes(text, parsed, true, report);
  const layout = layoutDeclarations(parsed);
  const walk = (nodes: readonly CssNode[], context: Context, forced = false) => {
    for (const node of nodes) {
      if (node.type === 'at-rule') {
        walk(
          node.children ?? [],
          DESCRIPTOR_BLOCKS.has(node.name) ? 'descriptors' : context,
          forced || forcedColors(node),
        );
      } else if (node.type === 'rule') {
        walk(node.children, context, forced);
      } else if (context !== 'descriptors') {
        const problem = appearanceProblem(node.property, node.value, {
          layout,
          forcedColors: forced,
        });
        if (problem) report('audit.css-appearance', node.at, problem);
      }
    }
  };
  walk(parsed, 'rules');
}

/** Each place the text can't be read to the end: a browser reads past it, and so would the audit. */
function reportSyntax(problems: readonly { at: Position; message: string }[], report: CssReport) {
  for (const { at, message } of problems) {
    report(
      'audit.css-syntax',
      at,
      `${message}, which a browser reads past, so the audit can't read what follows.`,
    );
  }
}

function scopePattern(id: string): RegExp {
  const name = escape(id);
  return new RegExp(`^\\[\\s*data-variant\\s*=\\s*(?:"${name}"|'${name}'|${name})\\s*\\]`);
}

/**
 * What's wrong with where a selector, its comments out, reaches, or undefined when it's inside
 * the scope: it starts with the scope's compound, the first combinator after that compound is a
 * descendant or `>`, and no :has(), :is(), :where(), or :not() on the compound starts its
 * argument with `~` or `+`.
 */
function scopeProblem(selector: string, scope: RegExp, id: string): string | undefined {
  const match = scope.exec(selector);
  if (!match) return `has the selector ${selector}, which isn't under [data-variant="${id}"].`;
  const end = endOfCompound(selector, match[0].length);
  const rest = selector.slice(end).trimStart();
  if (rest.startsWith('+') || rest.startsWith('~') || rest.startsWith('|')) {
    return `has the selector ${selector}, which reaches past [data-variant="${id}"] to its siblings.`;
  }
  if (siblingArgument(selector.slice(0, end))) {
    return `has the selector ${selector}, whose [data-variant="${id}"] reads its siblings through a :has(), :is(), :where(), or :not() starting with ~ or +.`;
  }
  return undefined;
}

const SELECTOR_ARGUMENT = /:(?:has|is|where|not)\($/i;

/** Whether a compound holds a :has(), :is(), :where(), or :not(), at any depth, whose argument has a selector starting with `~` or `+`. */
function siblingArgument(compound: string): boolean {
  for (let index = 0; index < compound.length; index++) {
    const char = compound[index]!;
    if (char === '"' || char === "'") {
      index = stringEnd(compound, index);
    } else if (char === '(' && SELECTOR_ARGUMENT.test(compound.slice(0, index + 1))) {
      const close = closingParen(compound, index);
      const argument = splitSelectors(compound.slice(index + 1, close));
      if (argument.some((part) => part.startsWith('~') || part.startsWith('+'))) return true;
    }
  }
  return false;
}

/** Where the bracket opened at `open` closes, strings skipped, or the end of the text. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'") index = stringEnd(text, index);
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return index;
  }
  return text.length;
}

/** The index of the quote closing the string opened at `open`, a backslash's next character skipped. */
function stringEnd(text: string, open: number): number {
  const quote = text[open];
  let index = open + 1;
  while (index < text.length && text[index] !== quote) index += text[index] === '\\' ? 2 : 1;
  return Math.min(index, text.length);
}

/** Where the compound selector running from `index` ends: at whitespace or a combinator. */
function endOfCompound(selector: string, index: number): number {
  let depth = 0;
  for (; index < selector.length; index++) {
    const char = selector[index]!;
    if (char === '"' || char === "'") {
      index = stringEnd(selector, index);
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /[\s>+~,|]/.test(char)) {
      return index;
    }
  }
  return index;
}

/** A nested rule's selectors, written out against each of its parents', as the browser reads them. */
function nest(parents: readonly string[], selector: string): string[] {
  const nested: string[] = [];
  for (const child of splitSelectors(selector)) {
    for (const parent of parents) {
      nested.push(child.includes('&') ? child.split('&').join(parent) : `${parent} ${child}`);
    }
  }
  return nested;
}

function checkImport(prelude: string, at: Position, report: CssReport) {
  const target = importTarget(prelude);
  if (target === undefined || !localPath(target)) {
    report(
      'audit.css-remote-import',
      at,
      `imports ${prelude.trim()}, which isn't a quoted path inside the package.`,
    );
  } else if (!target.startsWith('./') && !target.startsWith('../')) {
    report(
      'audit.css-bare-import',
      at,
      `imports ${target}, a stylesheet from outside the package.`,
    );
  }
}

/** The quoted path an @import names, as a string or a quoted url(), or undefined for any other form. */
function importTarget(prelude: string): string | undefined {
  const tokens = cssTokens(prelude).filter(({ type }) => type !== 'space' && type !== 'comment');
  const [first, second, third, fourth] = tokens;
  if (first?.type === 'string') return first.text.slice(1, -1);
  if (
    first?.type === 'word' &&
    /^url$/i.test(first.text) &&
    second?.type === '(' &&
    third?.type === 'string' &&
    fourth?.type === ')'
  )
    return third.text.slice(1, -1);
  return undefined;
}

/** A path inside the package: relative, plain characters, and no scheme, `//`, or `%`. */
const LOCAL_PATH = /^(?:\.\/|\.\.\/)?[A-Za-z0-9._/-]+$/;

function localPath(target: string): boolean {
  return LOCAL_PATH.test(target) && !target.includes('//');
}

function checkDeclaration(
  node: Extract<CssNode, { type: 'declaration' }>,
  target: StylesheetTarget,
  context: Context,
  report: CssReport,
  selectors: readonly string[] | null,
  layout: ReadonlyMap<string, readonly string[]>,
  rule: { readonly forced: boolean; readonly loop: boolean } = { forced: false, loop: false },
) {
  const { property, value } = node;
  if (context !== 'descriptors' && (node.important || IMPORTANT.test(value))) {
    report(
      'audit.css-important',
      node.at,
      `marks ${property} !important, which wins over the accessibility layer's focus ring and contrast rules.`,
    );
  }
  if (context !== 'descriptors' && property.startsWith('--') && isReservedProperty(property)) {
    report(
      'audit.css-appearance',
      node.at,
      `declares ${property}, in a namespace the platform's tokens own, which a composition reads and never sets.`,
    );
  }
  if (target.rtl) {
    const physical = physicalProperty(property, value);
    if (physical) {
      report(
        'audit.css-physical',
        node.at,
        `uses ${physical}, which doesn't flip for right-to-left text.`,
      );
    }
  }
  for (const url of urlProblems(value)) {
    report(
      'audit.css-remote-url',
      node.at,
      `loads ${url}, which isn't a quoted path inside the package.`,
    );
  }
  if (context === 'descriptors') return;
  const string = stringProblem(property, value);
  if (string) report('audit.css-string', node.at, string);
  const pseudoElement =
    selectors !== null &&
    selectors.length > 0 &&
    selectors.every((selector) => /::(?:before|after)$/i.test(selector.trim()));
  const problem =
    appearanceProblem(property, value, { pseudoElement, layout, forcedColors: rule.forced }) ??
    timingProblem(property, value, rule.loop) ??
    slotProblem(property, value) ??
    attrProblem(property, value);
  if (problem) report('audit.css-appearance', node.at, problem);
}

/** The properties whose values may hold a string, and the grid properties whose strings name areas. */
const STRING_PROPERTIES = new Set(['content', 'font-feature-settings', 'font-variation-settings']);
const GRID_STRING_PROPERTIES = new Set(['grid-template-areas', 'grid-template', 'grid']);
const AREA_NAMES = /^[A-Za-z0-9_ .-]*$/;

/** The value's tokens, spaces and comments aside. */
function valueTokens(value: string) {
  return cssTokens(value).filter(({ type }) => type !== 'space' && type !== 'comment');
}

/**
 * Why a value holds a string it may not (K-5 round 5): strings go in content, the two
 * font-settings properties, a quoted url(), and a grid's area names alone.
 */
function stringProblem(property: string, value: string): string | undefined {
  const name = property.startsWith('--')
    ? property
    : property.replace(/^-(?:webkit|moz|ms|o)-/, '');
  const tokens = valueTokens(value);
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'string') continue;
    // A quoted url()'s path: urlProblems() reads it.
    if (tokens[index - 1]?.type === '(' && /^url$/i.test(tokens[index - 2]?.text ?? '')) continue;
    if (STRING_PROPERTIES.has(name)) continue;
    if (GRID_STRING_PROPERTIES.has(name)) {
      if (AREA_NAMES.test(token.text.slice(1, -1))) continue;
      return `holds the grid string ${token.text}, which may name areas alone: letters, digits, _, -, ., and spaces.`;
    }
    return `holds the string ${token.text} in ${property}: only content, font-feature-settings, font-variation-settings, a quoted url(), and a grid's areas hold strings.`;
  }
  return undefined;
}

/**
 * Each url() and src() in a value that isn't a quoted path inside the package (K-5 round 5):
 * an unquoted url(), a scheme, `//`, `%`, or var(), and an image-set() that reads var().
 */
function urlProblems(value: string): string[] {
  const found: string[] = [];
  const tokens = valueTokens(value);
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'brackets' && /^url$/i.test(tokens[index - 1]?.text ?? '')) {
      found.push(`url${token.text}`);
      continue;
    }
    if (token.type !== 'word') continue;
    if (/^src$/i.test(token.text) && /^(?:\(|brackets)$/.test(tokens[index + 1]?.type ?? '')) {
      found.push('src()');
    } else if (/^url$/i.test(token.text) && tokens[index + 1]?.type === '(') {
      const path = tokens[index + 2];
      if (path?.type !== 'string' || tokens[index + 3]?.type !== ')') found.push('url(…)');
      else if (!localPath(path.text.slice(1, -1))) found.push(`url(${path.text})`);
    } else if (/^(?:-webkit-)?image-set$/i.test(token.text) && /var\(/i.test(value)) {
      found.push(`${token.text}() with var()`);
    }
  }
  return found;
}

/** An !important at a value's end. */
const IMPORTANT = /!\s*important\s*$/i;
const TIMING = /^(?:transition|animation)(?:-duration|-delay)?$/;
/** A time literal, its number captured. */
const TIME = /(?<![\w.-])((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)m?s(?![\w-])/gi;

/** Whether a duration may read `name`: the platform's motion tokens, or one of the four motion slots. */
function motionToken(name: string): boolean {
  return (
    ((name.startsWith('--ui-motion-') || name.startsWith('--motion-')) && isPlatformToken(name)) ||
    MOTION_SLOT.test(name)
  );
}

/** The motion tokens that are easings, not durations. */
const EASINGS = new Set(['--motion-curve', '--ui-motion-easing', '--layout-motion-curve']);
/** The ambient slot an infinite loop's cycle reads. */
const AMBIENT = new Set(['--motion-ambient', '--layout-motion-ambient']);
/** The largest factor a calc() may scale a motion token by, as the type lint holds a size. */
const MAX_FACTOR = 4;

/**
 * Why a duration or a delay is the composition's own (K-5 rounds 3 to 5), as the source
 * audit's timing rule holds it, vendor-prefixed forms included: every var() a motion token,
 * no time but 0 outside one, in a fallback either, a calc() that scales a token by a factor in
 * (0, 4], and an infinite loop's duration on the ambient slot, never a scaled UI token.
 */
function timingProblem(property: string, value: string, infinite: boolean): string | undefined {
  const name = property.replace(/^-(?:webkit|moz|ms|o)-/, '');
  if (!TIMING.test(name)) return undefined;
  const stray = varNames(value).find((each) => !motionToken(each));
  if (stray) return `reads ${stray} for ${property}, which isn't a motion token.`;
  for (const match of value.replace(/var\(\s*--[\w-]+/gi, 'var(').matchAll(TIME)) {
    if (Number(match[1]) !== 0) return `sets ${property} to ${match[0]}, a duration of its own.`;
  }
  for (const body of calcBodies(value)) {
    const outside = body.replace(/var\([^)]*\)/gi, ' ');
    for (const match of outside.matchAll(
      /([*/])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))|([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\*/g,
    )) {
      const number = Number(match[2] ?? match[3]);
      const factor = match[1] === '/' ? 1 / number : number;
      if (!(factor > 0 && factor <= MAX_FACTOR))
        return `scales a motion token by ${match[0].replace(/\s+/g, ' ').trim()} in ${property}: a factor runs from 0 to ${MAX_FACTOR}.`;
    }
  }
  if (infinite && /^animation(?:-duration)?$/.test(name)) {
    const duration = varNames(value).find((each) => !EASINGS.has(each) && !AMBIENT.has(each));
    if (duration)
      return `runs an infinite loop on ${duration} in ${property}: a loop's cycle reads the ambient slot, var(--motion-ambient).`;
  }
  return undefined;
}

/** Each calc() body in `value`, nested ones counted in their outer. */
function calcBodies(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(/(?<![\w-])calc\(/gi)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    for (; index < value.length && depth > 0; index++) {
      if (value[index] === '(') depth++;
      else if (value[index] === ')') depth--;
    }
    found.push(value.slice(start, index - 1));
  }
  return found;
}

/** Why a --layout-motion-* declaration is out of contract: a slot that isn't one of the four, or a value outside its band. */
function slotProblem(property: string, value: string): string | undefined {
  if (!property.startsWith('--layout-motion-')) return undefined;
  if (!MOTION_SLOT.test(property))
    return `declares ${property}, which isn't a motion slot: --layout-motion-feedback, -scene, -ambient, or -curve.`;
  return motionSlotValue(property, value)
    ? undefined
    : `sets ${property}: ${value}, outside the slot's band.`;
}

/**
 * Why a value reads attr(), or undefined when it's a plain attr(<name>) in content (K-5
 * round 3, R3-M4): a typed attr() reads a color, a length, or a time from the markup.
 */
function attrProblem(property: string, value: string): string | undefined {
  const calls = [...value.matchAll(/(?<![\w-])attr\(/gi)].length;
  if (calls === 0) return undefined;
  const plain = [...value.matchAll(/(?<![\w-])attr\(\s*[a-z_][\w-]*\s*\)/gi)].length;
  if (property === 'content' && plain === calls) return undefined;
  return `reads attr() in ${property}: ${value.trim()}. Only content may, and only as attr(<name>).`;
}

// Physical properties, for a variant that declares rtl.

const PHYSICAL_PROPERTY =
  /^(?:left|right|(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)|border-(?:left|right)(?:-(?:width|style|color))?|border-(?:top|bottom)-(?:left|right)-radius)$/;
/** Shorthands whose four values run top, right, bottom, left. */
const BOX_SHORTHANDS = new Set([
  'margin',
  'padding',
  'inset',
  'scroll-margin',
  'scroll-padding',
  'border-width',
  'border-style',
  'border-color',
]);

/** The physical part of a declaration, or undefined when it's logical. */
function physicalProperty(property: string, value: string): string | undefined {
  if (PHYSICAL_PROPERTY.test(property)) return property;
  if (
    ['text-align', 'float', 'clear'].includes(property) &&
    /^(?:left|right)\b/i.test(value.trim())
  ) {
    return `${property}: ${value.trim()}`;
  }
  if (BOX_SHORTHANDS.has(property)) {
    const values = splitValues(value);
    if (values.length === 4 && values[1] !== values[3]) return `${property}: ${value.trim()}`;
  }
  if (property === 'border-radius') {
    for (const radii of value.split('/')) {
      const [topLeft, topRight = topLeft, bottomRight = topLeft, bottomLeft = topRight] =
        splitValues(radii);
      if (topLeft !== topRight || bottomLeft !== bottomRight) {
        return `${property}: ${value.trim()}`;
      }
    }
  }
  return undefined;
}

/** A value's space-separated parts, keeping functions such as calc() whole. */
function splitValues(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Appearance: #19's tokens own color, type, radius, and shadow.

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONTS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar',
]);
/** The generic font families, which name no font of the composition's own. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);
/** The words a font shorthand may hold beside its tokens: styles, weights, stretches, and sizes. */
const FONT_WORDS = new Set([
  'normal',
  'italic',
  'oblique',
  'small-caps',
  'bold',
  'bolder',
  'lighter',
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'larger',
  'smaller',
]);
/** A type token a font may read: one the platform defines in --type-*. */
const typeToken = (name: string) => name.startsWith('--type-') && isPlatformToken(name);

/**
 * Why a font-family is the composition's own: each family a --type-*-font-family token
 * with no fallback, or a generic family.
 */
function fontFamilyProblem(property: string, value: string): string | undefined {
  for (const family of splitSelectors(value)) {
    const token = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(family)?.[1];
    if (token !== undefined && token.endsWith('-font-family') && typeToken(token)) continue;
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    const name = /^var\(\s*(--[\w-]+)/i.exec(family)?.[1];
    if (name !== undefined && !typeToken(name)) {
      return `reads ${name} for ${property}, which isn't a platform token.`;
    }
    return `sets ${property}: ${value}.`;
  }
  return undefined;
}

/**
 * Why a font shorthand is the composition's own: every var() a --type-* token, and nothing
 * else but numbers, lengths, `/`, the shorthand's own keywords, and generic families.
 */
function fontProblem(property: string, value: string): string | undefined {
  if (SYSTEM_FONTS.has(value.toLowerCase())) return undefined;
  const stray = varNames(value).find((name) => !typeToken(name));
  if (stray) return `reads ${stray} for ${property}, which isn't a platform token.`;
  if (/["']/.test(value)) return `sets ${property}: ${value}.`;
  const words = withoutVars(value)
    .split(/[\s,/]+/)
    .filter((word) => word !== '');
  const own = words.find(
    (word) =>
      !/^(?:[+-]?(?:\d|\.\d)|[*+/-]$)/.test(word) &&
      !/^(?:calc|min|max|clamp)\(/i.test(word) &&
      word !== ')' &&
      !FONT_WORDS.has(word.toLowerCase()) &&
      !GENERIC_FAMILIES.has(word.toLowerCase()),
  );
  return own === undefined ? undefined : `sets ${property}: ${value}.`;
}

const RADIUS = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
/** What a radius may hold beside its tokens: no corner, or the `/` between its two radii. */
const RADIUS_KEYWORDS = /^(?:0(?:px|rem|em|%)?|\/)$/i;
const COLOR_FUNCTION =
  /(?:^|[^a-z-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\(/i;
const HEX = /(?:^|[^&\w-])(#[0-9a-f]{3,8})\b/i;
/** Properties whose values a color name can stand in, where a word is a color. */
const COLOR_PROPERTY =
  /^(?:--.*|color|background(?:-color|-image)?|(?:[a-z]+-)*image(?:-source)?|border-image(?:-source)?|list-style(?:-image)?|mask(?:-image|-border(?:-source)?)?|shape-outside|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|text-emphasis(?:-color)?|column-rule(?:-color)?|scrollbar-color|flood-color|lighting-color|stop-color|filter|(?:-webkit-)?text-(?:fill|stroke)(?:-color)?|-webkit-tap-highlight-color)$/;
/** CSS's named colors, which are raw colors too. System colors such as Canvas aren't: they follow the visitor's settings. */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/**
 * Why a declaration sets appearance itself, or undefined when it's composition or a token.
 * A composition designs its own elements from the tokens (docs/variants.md, Styling
 * conventions): a radius, border, or shadow that reads `var(--ui-*)`, type from
 * `var(--type-*)`, and role surfaces, including a `color-mix()` of two role tokens. A value
 * that reads a token passes, unless it also writes a raw color of its own outside its `var()`s,
 * as a `color-mix()` with a literal does.
 */
export function appearanceProblem(
  property: string,
  value: string,
  where: AppearanceContext = {},
): string | undefined {
  const trimmed = value.trim();
  if (CSS_WIDE.has(trimmed.toLowerCase())) return undefined;
  // A vendor prefix doesn't hide a property: -webkit-box-shadow is a shadow, and
  // -webkit-border-radius a radius.
  const name = property.startsWith('--')
    ? property
    : property
        .toLowerCase()
        .replace(/^-(?:webkit|moz|ms|o)-(?=(?:border|box|text|mask|clip|shape)\b)/, '');
  // A radius or a shadow reads the design language's tokens and nothing else (K-5 review H2),
  // as the appearance source audit holds it: every var() a --ui-radius-* or a --ui-* token, or
  // a --layout-* the file declares that passes in turn (a radius may read --layout-round where
  // the file declares it 50%), and nothing beside them but 0 or none. No length, unit, or
  // color of its own, in a color-mix() or out of one.
  if (RADIUS.test(name)) {
    return geometryTokens(trimmed, '--ui-radius-', RADIUS_KEYWORDS, where, true)
      ? undefined
      : `sets ${property}: ${trimmed}.`;
  }
  if (name === 'box-shadow' || name === 'text-shadow') {
    return geometryTokens(trimmed, '--ui-', /^none$/i, where, false)
      ? undefined
      : `sets ${property}: ${trimmed}.`;
  }
  // A basic shape's `round` is a corner, held as a radius is (K-5 review L1).
  if (
    (name === 'clip-path' || name === 'shape-outside') &&
    shapeRadii(trimmed).some(
      (radius) => !geometryTokens(radius, '--ui-radius-', RADIUS_KEYWORDS, where, true),
    )
  ) {
    return `sets ${property}: ${trimmed}, a corner of its own.`;
  }
  // A font reads the type tokens alone (K-5 round 3, R3-M2).
  if (name === 'font-family') return fontFamilyProblem(property, trimmed);
  if (name === 'font') return fontProblem(property, trimmed);
  // A filter that recolors reads tokens alone, as a color does (K-5 round 5, R4-L1).
  if (name === 'filter' || name === 'backdrop-filter') {
    const recolor = colorFilter(trimmed);
    if (recolor) return `sets ${property} to ${recolor}, a recolor of its own.`;
  }
  // A system color is the page's own only under forced colors (K-5 round 5, R4-L1).
  if (!where.forcedColors && COLOR_PROPERTY.test(name)) {
    const system = systemColor(trimmed);
    if (system) return `names the system color ${system} outside @media (forced-colors: active).`;
  }
  // For color alone, a color-mix() of tokens, currentColor, and transparent is a token (K-5).
  let colors = tokenMixes(trimmed);
  // A mask on a ::before or ::after reads its colors for their alpha alone (K-5).
  if (where.pseudoElement && /^mask(?:-image)?$/.test(name)) {
    colors = colors.replace(MASK_COLORS, ' ').trim();
  }
  if (/\bvar\(\s*--/.test(colors)) {
    // color-mix() and light-dark() of tokens are tokens: only a literal inside one is raw.
    const own = withoutVars(colors).replace(/\b(?:color-mix|light-dark)\(/gi, ' (');
    if (/(?:^|[^a-z-])drop-shadow\(/i.test(own)) return `sets a drop shadow: ${trimmed}.`;
    const color = rawColor(name, own);
    if (color !== undefined) return `sets ${property} to ${color}, a raw color beside its tokens.`;
    // Where a color goes, a var() reads a platform token or a --layout-* of the file's own,
    // never a name a composition made up (or declared in a namespace it doesn't own).
    if (COLOR_PROPERTY.test(name) && !name.startsWith('--')) {
      const stray = varNames(trimmed).find(
        (each) => !isPlatformToken(each) && !each.startsWith('--layout-'),
      );
      if (stray) return `reads ${stray} for ${property}, which isn't a platform token.`;
    }
    return undefined;
  }
  if (property === 'font-family') return `sets font-family: ${trimmed}.`;
  if (property === 'font' && !SYSTEM_FONTS.has(trimmed.toLowerCase())) {
    return `sets font: ${trimmed}.`;
  }
  if (/(?:^|[^a-z-])drop-shadow\(/i.test(trimmed)) return `sets a drop shadow: ${trimmed}.`;
  const color = rawColor(name, colors);
  return color === undefined ? undefined : `sets ${property} to ${color}, a raw color.`;
}

/** Each name a var() in `value` reads, fallbacks' too. */
function varNames(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)/gi)].map((match) => match[1]!);
}

/** What a declaration's appearance check knows beyond it. */
export interface AppearanceContext {
  /** Whether every selector of its rule styles a ::before or an ::after. */
  readonly pseudoElement?: boolean;
  /** Each --layout-* property the stylesheet declares, with every value it gives it. */
  readonly layout?: ReadonlyMap<string, readonly string[]>;
  /** Whether it sits under @media (forced-colors: active), where a system color is the page's. */
  readonly forcedColors?: boolean;
}

/** The CSS Color 4 system colors, the deprecated ones among them, lowercased. */
const SYSTEM_COLORS = new Set(
  (
    'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext ' +
    'field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem ' +
    'selecteditemtext visitedtext activeborder activecaption appworkspace background ' +
    'buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext ' +
    'infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight ' +
    'threedlightshadow threedshadow window windowframe windowtext'
  ).split(' '),
);

/** The first system color a value names, outside its var() names and strings, or undefined. */
function systemColor(value: string): string | undefined {
  const words = value
    .replace(/var\(\s*--[\w-]+/gi, 'var(')
    .replace(/(['"])(?:(?!\1).)*\1/g, ' ')
    .split(/[^A-Za-z-]+/);
  return words.find((word) => SYSTEM_COLORS.has(word.toLowerCase()));
}

/** The filters that recolor: they shift, add, or flip hue. grayscale() and the rest don't. */
const RECOLOR_FILTERS = /(?<![\w-])(hue-rotate|sepia|saturate|invert)\(/gi;

/** The first recoloring filter whose argument isn't a platform --ui-* token alone, or undefined. */
function colorFilter(value: string): string | undefined {
  for (const match of value.matchAll(RECOLOR_FILTERS)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    for (; index < value.length && depth > 0; index++) {
      if (value[index] === '(') depth++;
      else if (value[index] === ')') depth--;
    }
    const argument = value.slice(start, index - 1).trim();
    const token = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(argument)?.[1];
    if (!(token?.startsWith('--ui-') && isPlatformToken(token))) return `${match[1]}(${argument})`;
  }
  return undefined;
}

/** Each --layout-* property `nodes` declare, anywhere, with every value. */
function layoutDeclarations(nodes: readonly CssNode[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (list: readonly CssNode[]) => {
    for (const node of list) {
      if (node.type === 'declaration') {
        if (node.property.startsWith('--layout-'))
          found.set(node.property, [...(found.get(node.property) ?? []), node.value.trim()]);
      } else walk(node.children ?? []);
    }
  };
  walk(nodes);
  return found;
}

/**
 * Whether `value` reads only geometry tokens: each var() names a property
 * with `prefix`, --layout-round for a radius where the file gives it 50%
 * alone, or a --layout-* the file declares whose every value passes in
 * turn, its fallback passing too; and nothing else is left but `keywords`
 * and commas.
 */
function geometryTokens(
  value: string,
  prefix: string,
  keywords: RegExp,
  where: AppearanceContext,
  radius: boolean,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  let ok = true;
  let rest = '';
  for (let i = 0; i < value.length; i++) {
    if (!/^var\(/i.test(value.slice(i, i + 4))) {
      rest += value[i];
      continue;
    }
    let depth = 0;
    let j = i;
    let comma = -1;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ',' && depth === 1 && comma === -1) comma = j;
      else if (value[j] === ')' && --depth === 0) break;
    }
    const name = value.slice(i + 4, comma === -1 ? j : comma).trim();
    const fallback = comma === -1 ? null : value.slice(comma + 1, j);
    const values = where.layout?.get(name);
    const named =
      (name.startsWith(prefix) && isPlatformToken(name)) ||
      (radius &&
        name === '--layout-round' &&
        values !== undefined &&
        values.length > 0 &&
        values.every((own) => own === '50%')) ||
      (name.startsWith('--layout-') &&
        name !== '--layout-round' &&
        !seen.has(name) &&
        values !== undefined &&
        values.length > 0 &&
        values.every((own) =>
          geometryTokens(own, prefix, keywords, where, radius, new Set([...seen, name])),
        ));
    if (!named) ok = false;
    if (fallback !== null && !geometryTokens(fallback, prefix, keywords, where, radius, seen))
      ok = false;
    rest += ' ';
    i = j;
  }
  return (
    ok &&
    rest
      .split(/[\s,]+/)
      .filter((word) => word !== '')
      .every((word) => keywords.test(word))
  );
}

/** The colors a mask may name (K-5). */
const MASK_COLORS = /(?<![\w&#-])(?:black|white|transparent|#000(?:000)?|#fff(?:fff)?)(?![\w-])/gi;

/**
 * `value` with each color-mix() of nothing but tokens, currentColor, and
 * transparent, and their percentages, read as the token it is (K-5).
 */
function tokenMixes(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const opener = /^color-mix\(/i.exec(value.slice(i, i + 10));
    if (!opener || (i > 0 && /[\w-]/.test(value[i - 1]!))) {
      out += value[i];
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')' && --depth === 0) break;
    }
    const inner = value.slice(i + opener[0].length, j);
    const rest = withoutVars(inner)
      .replace(/^\s*in\s+[a-z-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?\s*,/i, ' ')
      .replace(/(?<![\w-])(?:currentcolor|transparent)(?![\w-])/gi, ' ')
      .replace(/(?<![\w.-])(?:\d+(?:\.\d*)?|\.\d+)%/g, ' ')
      .replace(/,/g, ' ');
    if (rest.trim() === '') {
      out += 'var(--color-mix)';
      i = j;
    } else out += value[i];
  }
  return out;
}

/**
 * `value` with each `var(--name)` blanked out, and each fallback kept: `var(--a, #f00)`
 * leaves its `#f00`, which is a literal all the same, and `var(--a, var(--b))` leaves
 * nothing, since its fallback is a token too.
 */
function withoutVars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (/^var\(/i.test(value.slice(i, i + 4))) {
      let depth = 0;
      let j = i;
      let comma = -1;
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++;
        else if (value[j] === ',' && depth === 1 && comma === -1) comma = j;
        else if (value[j] === ')' && --depth === 0) break;
      }
      out += comma === -1 ? ' ' : ` ${withoutVars(value.slice(comma + 1, j))} `;
      i = j;
    } else out += value[i];
  }
  return out;
}

/** The first raw color in a value, outside its strings and url()s. */
function rawColor(property: string, value: string): string | undefined {
  const bare = value.replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, ' ').replace(/url\([^)]*\)/gi, ' ');
  const hex = HEX.exec(bare);
  if (hex) return hex[1];
  const fn = COLOR_FUNCTION.exec(bare);
  if (fn) return `${fn[1]}()`;
  if (!COLOR_PROPERTY.test(property)) return undefined;
  for (const word of bare.toLowerCase().split(/[^a-z]+/)) {
    if (NAMED_COLORS.has(word)) return word;
  }
  return undefined;
}

function unquote(text: string): string {
  return /^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
