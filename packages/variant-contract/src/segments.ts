// Route segment grammar (#5, Slice 1, item 3), shared by the manifest check
// and the route helpers.

/**
 * First path segments the host and later issues own. A variant's path view
 * under home can't start with one. #6, #7, #10, and #22 extend the list.
 */
export const RESERVED_SEGMENTS: readonly string[] = [
  'studio',
  'api',
  '_next',
  'sample',
  'reference',
  'preview',
  'work',
  'robots.txt',
  'sitemap.xml',
  'feed.xml',
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  'favicon.ico',
  'manifest.webmanifest',
];

/** A literal path segment: lowercase words joined by hyphens. */
export const LITERAL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A placeholder, such as `{chapter}`. */
const PARAM = /^\{([a-z][a-zA-Z0-9]{0,31})\}$/;
/** What a placeholder matches in a path or fragment: one segment of the same grammar as a literal. */
export const PARAM_VALUE = LITERAL_SEGMENT;

export type PatternPart = { readonly literal: string } | { readonly param: string };

/**
 * A path view's segment, such as `chapters/{chapter}`, as parts, or a reason
 * it isn't one. The first part is a literal, so a view never captures every
 * path, and each placeholder appears once.
 */
export function parsePathPattern(
  segment: string,
): { readonly parts: readonly PatternPart[] } | { readonly problem: string } {
  const pieces = segment.split('/');
  const parts: PatternPart[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const param = PARAM.exec(piece);
    if (param) {
      if (seen.has(param[1]!)) return { problem: `repeats the placeholder {${param[1]}}.` };
      seen.add(param[1]!);
      parts.push({ param: param[1]! });
    } else if (LITERAL_SEGMENT.test(piece)) {
      parts.push({ literal: piece });
    } else {
      return {
        problem:
          'must be segments joined by /, each lowercase words joined by hyphens or a {placeholder}, such as chapters/{chapter}.',
      };
    }
  }
  if (!('literal' in parts[0]!)) {
    return { problem: 'must start with a literal segment, such as chapters, not a placeholder.' };
  }
  return { parts };
}

/**
 * A fragment view's segment, such as `chapter-{chapter}`, as parts, or a
 * reason it isn't one. It starts with a letter, so it's a valid element id.
 */
export function parseFragmentPattern(
  segment: string,
): { readonly parts: readonly PatternPart[] } | { readonly problem: string } {
  const parts: PatternPart[] = [];
  const seen = new Set<string>();
  const pattern = /\{([a-z][a-zA-Z0-9]{0,31})\}|([a-z0-9-]+)/gy;
  let consumed = 0;
  for (const match of segment.matchAll(pattern)) {
    consumed += match[0].length;
    if (match[1]) {
      if (seen.has(match[1])) return { problem: `repeats the placeholder {${match[1]}}.` };
      seen.add(match[1]);
      parts.push({ param: match[1] });
    } else {
      parts.push({ literal: match[2]! });
    }
  }
  const first = parts[0];
  if (
    consumed !== segment.length ||
    !first ||
    !('literal' in first) ||
    !/^[a-z]/.test(first.literal)
  ) {
    return {
      problem:
        'must start with a letter, then lowercase letters, digits, hyphens, and {placeholders}, such as chapter-{chapter}.',
    };
  }
  return { parts };
}
