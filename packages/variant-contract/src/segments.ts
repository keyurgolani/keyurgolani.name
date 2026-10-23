// Route segment grammar (#5, Slice 1, item 3), shared by the manifest check,
// the route helpers, and the host's route table. It imports only the
// schema's id rules, so the host's proxy.ts reads it through the
// ./segments subpath without zod or the schemas (Slice 4).

import { SECTION_ID_MAX_LENGTH } from '@portfolio/schema/ids';

/**
 * First path segments the host and later issues own. A variant's path view
 * under home can't start with one. #6, #7, #10, and #22 extend the list.
 * `admin` and `variants` are #1's retired routes, which answer 404 in every
 * profile, so a view there could never be reached. `assets` is where the
 * Compose files mount an owner's assets into public/, whose files win over
 * any view. `_fixtures` is #19's test fixture pages, which only a build made
 * with APPEARANCE_FIXTURES=1 serves. `preview` and `preview-assets` are #7's
 * preview documents and the media they load. `_portfolio` is where the host
 * serves the files registry generation compiles: #19's packs, and #6's
 * variant stylesheets and the images they name. `_experience` holds #6's
 * experience segments, one route per variant, which only the host's own
 * rewrite reaches.
 */
export const RESERVED_SEGMENTS: readonly string[] = [
  'studio',
  'api',
  '_next',
  '_fixtures',
  '_portfolio',
  '_experience',
  'sample',
  'reference',
  'preview',
  'preview-assets',
  'work',
  'admin',
  'variants',
  'assets',
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

/**
 * Next's image metadata routes with the suffix Next adds inside a route
 * group, six characters hashed from the group, such as the site's
 * `opengraph-image-12o0cb`.
 */
const GROUPED_METADATA_IMAGE = /^(?:opengraph-image|twitter-image|icon|apple-icon)-[a-z0-9]{6}$/;

/**
 * Whether a path view under home can't start with `segment`: one of
 * RESERVED_SEGMENTS, or an image metadata route with a route group's suffix.
 */
export function isReservedSegment(segment: string): boolean {
  return RESERVED_SEGMENTS.includes(segment) || GROUPED_METADATA_IMAGE.test(segment);
}

/** A literal path segment: lowercase words joined by hyphens. */
export const LITERAL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A placeholder, such as `{chapter}`. */
const PARAM = /^\{([a-z][a-zA-Z0-9]{0,31})\}$/;
/**
 * The longest value a placeholder or a work slug takes: a content id's (#4),
 * so a parameter can name any section or work, and a longer one is no view.
 */
export const PARAM_VALUE_MAX_LENGTH = SECTION_ID_MAX_LENGTH;

/**
 * Whether `value` fills a placeholder in a path or fragment, or names a
 * work: one segment of the same grammar as a literal, at most
 * PARAM_VALUE_MAX_LENGTH characters.
 */
export function isParamValue(value: string): boolean {
  return value.length <= PARAM_VALUE_MAX_LENGTH && LITERAL_SEGMENT.test(value);
}

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

/** What path matching reads from a view declaration. */
export interface ViewPattern {
  readonly type: 'path' | 'fragment';
  readonly under: 'home' | 'work';
  readonly segment: string;
}

/**
 * The placeholder values when `segments`, the path below `under`, is the
 * path view `view`, or null. Each literal matches itself and each
 * placeholder one value isParamValue() takes. The contract's dispatch and
 * the host's route table both match through it, so they agree on every
 * path.
 */
export function matchPathView(
  view: ViewPattern,
  under: 'home' | 'work',
  segments: readonly string[],
): Record<string, string> | null {
  if (view.type !== 'path' || view.under !== under) return null;
  const pattern = parsePathPattern(view.segment);
  if ('problem' in pattern || pattern.parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of pattern.parts.entries()) {
    const value = segments[index]!;
    if ('literal' in part) {
      if (part.literal !== value) return null;
    } else if (isParamValue(value)) {
      params[part.param] = value;
    } else {
      return null;
    }
  }
  return params;
}

/**
 * The addresses a view answers, as a key: two views with one key match the
 * same paths or fragments, since a placeholder matches any segment, whatever
 * it's named. Undefined for a segment that doesn't parse.
 */
export function viewShape(view: {
  readonly under: string;
  readonly type: 'path' | 'fragment';
  readonly segment: string;
}): string | undefined {
  const parsed =
    view.type === 'path' ? parsePathPattern(view.segment) : parseFragmentPattern(view.segment);
  if ('problem' in parsed) return undefined;
  return [
    view.under,
    view.type,
    ...parsed.parts.map((part) => ('literal' in part ? part.literal : '{}')),
  ].join('/');
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
