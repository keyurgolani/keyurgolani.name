// Flux's stylesheet as rules, for the static tests: each style rule with the at-rules it sits in
// (outermost first), its selector on one line and its body, comments left out.

export interface Rule {
  /** The at-rule preludes the rule sits in, outermost first, such as `@media (max-width: 39.99rem)`. */
  readonly at: readonly string[];
  readonly selector: string;
  readonly body: string;
}

/** Every style rule in `css`, in order. */
export function rulesOf(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const at: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '{') {
      const prelude = text.slice(start, index).trim().replace(/\s+/g, ' ');
      if (prelude.startsWith('@')) {
        at.push(prelude);
        start = index + 1;
        continue;
      }
      let depth = 1;
      let end = index + 1;
      for (; end < text.length && depth > 0; end++) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}') depth--;
      }
      out.push({ at: [...at], selector: prelude, body: text.slice(index + 1, end - 1) });
      index = end - 1;
      start = end;
    } else if (char === '}') {
      at.pop();
      start = index + 1;
    } else if (char === ';') {
      start = index + 1;
    }
  }
  return out;
}

/** The value `body` gives `property`, or undefined. */
export function valueOf(body: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);?`).exec(body);
  return match?.[1]?.trim();
}

/** Whether the rule sits in the phone dock's media query (under 40rem). */
export const onPhones = (rule: Rule) =>
  rule.at.some((each) => /\(max-width: 39\.99rem\)/.test(each));

/** Whether the rule sits in no media or supports query. */
export const everywhere = (rule: Rule) => rule.at.every((each) => !/^@(media|supports)/.test(each));
