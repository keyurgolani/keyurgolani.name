// The type lint (T1 and T3 of the redesign's typography rules): a composition sets its text from the
// shared type steps, `var(--type-step-*)`, or a role's own size,
// `var(--type-<role>-font-size)`, never a size of its own. It reports and
// never fails a check, like the space lint: the compositions move onto the
// steps with their redesigns, and type-lint.test.ts lists what's left as a
// todo until then.
//
// A composition may have at most one size of its own, on one selector, in
// one container unit, named in TYPE_SIZE_EXCEPTIONS (T3). Two have one:
// Horizontal Cinema's prologue title card fills its measure, and Raw
// Grid's poster name fills its field, so each one's selector may set
// `font-size` in `cqi`. Nothing else may.
//
// K-5: a `calc()` multiple of a step or a role's size, such as
// `calc(var(--type-step-5) * 1.6)` or `calc(2 * var(--type-body-font-size))`,
// is the scale's too, and so is a --layout-* property the stylesheet
// declares as one of these.

import { TYPOGRAPHY_ROLES } from '../roles';

/** A font-size a composition sets itself: where, under which selector, and the value. */
export interface TypeSizeLiteral {
  readonly line: number;
  readonly selector: string;
  readonly value: string;
}

/** The one size a composition may set itself, by composition: its selector and its unit. */
export const TYPE_SIZE_EXCEPTIONS: Readonly<
  Record<string, { readonly selector: string; readonly unit: string; readonly why: string }>
> = {
  'horizontal-cinema': {
    selector: "[data-variant='horizontal-cinema'] .hc-card__name",
    unit: 'cqi',
    why: "The prologue title card sets the name to fill the card's measure on one line (T3's one exception), so its size follows the card, not the type scale.",
  },
  'raw-grid': {
    selector: "[data-variant='raw-grid'] .rg-name",
    unit: 'cqi',
    why: "§5.3: the name fills its field on one line, min(step-7, 58cqi / (chars × 0.84)), so its size follows the field, not the scale. The same fit, capped at their own step, sizes the big link, the next work's title and the card and album titles by their longest word, so no word breaks.",
  },
};

const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', '1em', '100%']);
const LENGTH =
  '(?:^|[^\\w-])(-?\\d*\\.?\\d+(?:px|rem|em|ex|ch|vw|vh|vi|vb|vmin|vmax|cqi|cqb|cqw|cqh|cqmin|cqmax|pt|pc|cm|mm|in|%))(?![\\w-])';
const lengthsIn = (value: string) =>
  [...value.matchAll(new RegExp(LENGTH, 'gi'))].map((match) => match[1]!);
const SIZE_KEYWORD =
  /\b(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)\b/i;

/**
 * Each `font-size` in `css` that isn't the scale's: anything but one bare
 * `var(--type-*)` or a keyword that keeps the inherited size (fromTheScale).
 * `composition` names the stylesheet's composition, whose one exception, if it has one,
 * passes.
 */
export function typeSizeLiterals(css: string, composition?: string): TypeSizeLiteral[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const exception = composition ? TYPE_SIZE_EXCEPTIONS[composition] : undefined;
  const found: TypeSizeLiteral[] = [];
  const layout = layoutDeclarations(text);
  const preludes: string[] = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let depth = 0;
  const flush = (end: number, closer: string) => {
    const raw = text.slice(start, end);
    const body = raw.trim();
    const lead = raw.length - raw.trimStart().length;
    const bodyLine = startLine + (raw.slice(0, lead).match(/\n/g)?.length ?? 0);
    if (closer === '{') preludes.push(body);
    else if (body !== '' && !body.startsWith('@')) {
      const colon = body.indexOf(':');
      if (colon > 0 && body.slice(0, colon).trim().toLowerCase() === 'font-size') {
        const value = body
          .slice(colon + 1)
          .replace(/!important\s*$/i, '')
          .trim();
        const selector = [...preludes].reverse().find((prelude) => !prelude.startsWith('@')) ?? '';
        if (!fromTheScale(value, layout) && !isException(selector, value, exception)) {
          found.push({ line: bodyLine, selector: selector.replace(/\s+/g, ' '), value });
        }
      }
    }
    start = end + 1;
    startLine = line;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\n') line++;
    if (char === '"' || char === "'") {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
    } else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === '{' || char === ';' || char === '}')) {
      if (char === '}') {
        flush(i, ';');
        preludes.pop();
      } else flush(i, char);
    }
  }
  return found;
}

/** Each --layout-* property `css` declares, by name, with every value it gives it. */
function layoutDeclarations(css: string): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const match of css.matchAll(/(?<![\w-])(--layout-[\w-]+)\s*:\s*([^;{}]+)/g)) {
    found.set(match[1]!, [...(found.get(match[1]!) ?? []), match[2]!.trim()]);
  }
  return found;
}

/** A positive unitless factor. */
const FACTOR = '(\\d+(?:\\.\\d*)?|\\.\\d+)';
/** The largest factor a calc() multiple may scale a size by: Swiss's poster takes 1.6, Shell's line 2. */
const MAX_FACTOR = 4;
/**
 * A size a calc() multiple may scale: a step, or a role's own size, and no other --type-* token.
 * The roles come from TYPOGRAPHY_ROLES, so a hyphenated one, body-compact, is a role too.
 */
const SCALABLE = new RegExp(
  `^var\\(\\s*--type-(?:step-[a-z0-9-]+|(?:${TYPOGRAPHY_ROLES.join('|')})-font-size)\\s*\\)$`,
);

/**
 * Whether a font-size value is the type scale's: a keyword that keeps the size it
 * inherits, one `var(--type-*)` with no fallback, a --layout-* property `layout`
 * declares as one of these, or (K-5) a `calc()` that multiplies a step or a role's
 * size, `--type-step-*` or `--type-<role>-font-size`, or a --layout-* declared as one,
 * by a literal factor over 0 and up to 4. A step with a literal fallback, a measure or
 * a spacing token scaled, or any other arithmetic, is a size of the composition's own.
 */
function fromTheScale(
  value: string,
  layout: ReadonlyMap<string, readonly string[]> = new Map(),
  seen: ReadonlySet<string> = new Set(),
): boolean {
  const lower = value.toLowerCase().trim();
  if (KEYWORDS.has(lower)) return true;
  if (/^var\(\s*--type-[a-z0-9-]+\s*\)$/.test(lower)) return true;
  const reference = /^var\(\s*(--layout-[a-z0-9-]+)\s*\)$/.exec(lower);
  if (reference) {
    const name = reference[1]!;
    const values = layout.get(name);
    const next = new Set([...seen, name]);
    return (
      !seen.has(name) &&
      values !== undefined &&
      values.every((own) => !KEYWORDS.has(own.toLowerCase()) && fromTheScale(own, layout, next))
    );
  }
  const product = new RegExp(
    `^calc\\(\\s*(?:(var\\([^()]*\\))\\s*\\*\\s*${FACTOR}|${FACTOR}\\s*\\*\\s*(var\\([^()]*\\)))\\s*\\)$`,
  ).exec(lower);
  if (!product) return false;
  const scaled = (product[1] ?? product[4])!;
  const factor = Number(product[2] ?? product[3]);
  return factor > 0 && factor <= MAX_FACTOR && scalable(scaled, layout, seen);
}

/** Whether `value` is a step or a role's size, or a --layout-* the stylesheet declares as one. */
function scalable(
  value: string,
  layout: ReadonlyMap<string, readonly string[]>,
  seen: ReadonlySet<string>,
): boolean {
  if (SCALABLE.test(value)) return true;
  const reference = /^var\(\s*(--layout-[a-z0-9-]+)\s*\)$/.exec(value);
  if (!reference || seen.has(reference[1]!)) return false;
  const values = layout.get(reference[1]!);
  const next = new Set([...seen, reference[1]!]);
  return (
    values !== undefined &&
    values.length > 0 &&
    values.every((own) => scalable(own.toLowerCase().trim(), layout, next))
  );
}

function isException(
  selector: string,
  value: string,
  exception: (typeof TYPE_SIZE_EXCEPTIONS)[string] | undefined,
): boolean {
  if (!exception || selector.replace(/\s+/g, ' ') !== exception.selector) return false;
  const lengths = lengthsIn(value);
  return (
    lengths.length > 0 &&
    lengths.every((length) => length.toLowerCase().endsWith(exception.unit)) &&
    !SIZE_KEYWORD.test(value)
  );
}
