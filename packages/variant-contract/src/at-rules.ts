// The at-rules a variant's stylesheet may use (K-5 round 7, R6-H1): a
// condition on the page, a layer, or keyframes, which style nothing past the
// rules inside them, which the scope rule reads. Any other at-rule is
// refused, in the variant audit (audit.css-at-rule) and in the source
// audit (`at-rule`) alike: @scope sets a scope root of its own, which
// `@scope (:not(&))` or `(& ~ *)` sets to the whole page; @font-face,
// @property, @counter-style, @page, @font-feature-values,
// @font-palette-values, and @starting-style reach past the composition or
// past its tokens; and an at-rule the list doesn't know is refused for that
// alone. @view-transition is the host's (K-4 (a), ./transitions): it writes
// the rule for a variant whose manifest opts in, so a variant never does.
//
// @supports may test a selector, `selector(X)` or `not selector(X)`, where X
// is one compound of pseudo-classes and pseudo-elements alone, such as
// `:popover-open` or `::details-content`: no combinator, `&`, type,
// attribute, class, or id, no argument of any kind (so no :has(), :is(),
// :where(), or :not()), and no comment or escape.

/** The at-rules a variant's stylesheet may use, with their `@`. */
export const VARIANT_AT_RULES: readonly string[] = [
  '@media',
  '@supports',
  '@layer',
  '@container',
  '@keyframes',
  '@import',
];

/** One compound of pseudo-classes and pseudo-elements, vendor-prefixed ones too, and nothing else. */
const PSEUDO_COMPOUND = /^\s*(?:::?-?[a-z][a-z0-9-]*)+\s*$/i;

/**
 * Why a variant's stylesheet may not use this at-rule, or undefined when it may. `name` is
 * the at-rule's name with its `@`, any case; `prelude` what follows it, up to its `{` or `;`,
 * as written.
 */
export function variantAtRuleProblem(name: string, prelude: string): string | undefined {
  const at = name.toLowerCase();
  if (at === '@view-transition') {
    return `uses ${name}, which the host writes for a variant whose manifest sets transitions.crossDocument to true, and a variant's stylesheet never does.`;
  }
  if (!VARIANT_AT_RULES.includes(at)) {
    return `uses ${name}, an at-rule a variant's stylesheet doesn't: only ${VARIANT_AT_RULES.join(', ')}.`;
  }
  if (at === '@supports') {
    for (const argument of selectorArguments(prelude)) {
      if (!PSEUDO_COMPOUND.test(argument)) {
        return `tests selector(${argument}) in @supports, where only one compound of pseudo-classes and pseudo-elements goes, such as selector(:popover-open).`;
      }
    }
  }
  return undefined;
}

/** The argument of every selector() in a @supports prelude, strings skipped and brackets matched. */
function selectorArguments(prelude: string): string[] {
  const found: string[] = [];
  const opener = /(?<![\w-])selector\s*\(/gi;
  for (let match = opener.exec(prelude); match; match = opener.exec(prelude)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = prelude.length;
    for (let index = open; index < prelude.length; index++) {
      const char = prelude[index]!;
      if (char === '"' || char === "'") {
        index++;
        while (index < prelude.length && prelude[index] !== char) {
          index += prelude[index] === '\\' ? 2 : 1;
        }
      } else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) {
        close = index;
        break;
      }
    }
    found.push(prelude.slice(open + 1, close));
    opener.lastIndex = Math.max(opener.lastIndex, close);
  }
  return found;
}
