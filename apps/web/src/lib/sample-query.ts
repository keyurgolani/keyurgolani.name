import { APPEARANCE_AXES, QUERY_KEYS, type AppearanceRegistry } from '@portfolio/appearance';
import type { Site } from '@portfolio/schema';
import { APPEARANCE_REGISTRY } from './appearance-registry';
import { documentAppearance } from './document-appearance';
import { sampleVariant, type RegisteredIds } from './sample';

// /sample's query under demo (#9): the five #19 selection keys, `variant`,
// `language`, `scheme`, `type`, and `mode`, and `motion=reduce`, Demo
// Studio's reduced-motion preview. Each value is checked against what this
// build registers: `variant` as sampleVariant() reads it, the other four as
// resolveAppearance() would apply them to the sample site, scheme and mode
// as a pair. A value that doesn't count falls back on its own axis to the
// sample's, and drops from the canonical query, in this key order. A page
// asked for with any other query answers a 307 to the same path with the
// canonical one, built on PORTFOLIO_ORIGIN, so nothing a request sent that
// the registry didn't accept reaches a page, and identical selections share
// one URL.

/** The keys the canonical query holds, in its order. */
export const SAMPLE_QUERY_KEYS = [...APPEARANCE_AXES.map((axis) => QUERY_KEYS[axis]), 'motion'];

/** /sample's request, read through the registry. */
export interface SampleQuery {
  /** The registered variant `variant` names, or undefined for the sample site's own. */
  readonly selected?: string;
  /** Each key whose value counts, in SAMPLE_QUERY_KEYS order: what links and redirects keep. */
  readonly query: Readonly<Record<string, string>>;
  /** `motion=reduce` came: the page renders with motion reduced, as a reduced preview does. */
  readonly reduceMotion: boolean;
}

export interface SampleQueryOptions {
  readonly registered?: RegisteredIds;
  readonly registry?: AppearanceRegistry;
}

/** What `sent` selects on /sample for the sample site `site`. */
export function sampleQuery(
  sent: URLSearchParams,
  site: Pick<Site, 'appearance' | 'visitorControls' | 'motionPolicy'>,
  { registered, registry = APPEARANCE_REGISTRY }: SampleQueryOptions = {},
): SampleQuery {
  const selected = sampleVariant(sent, registered);
  // The four pack and mode keys alone: the variant is the segment's, read above.
  const packs = new URLSearchParams();
  for (const axis of APPEARANCE_AXES) {
    if (axis === 'variant') continue;
    for (const value of sent.getAll(QUERY_KEYS[axis])) packs.append(QUERY_KEYS[axis], value);
  }
  const resolved = documentAppearance({
    site,
    variant: selected ?? site.appearance.variant,
    profile: 'demo',
    query: packs,
    registry,
  });
  const query: Record<string, string> = {};
  for (const axis of APPEARANCE_AXES) {
    if (axis === 'variant') {
      if (selected !== undefined) query[QUERY_KEYS.variant] = selected;
    } else if (resolved.visitorAxes.includes(axis)) {
      query[QUERY_KEYS[axis]] = resolved.requested[axis];
    }
  }
  const motion = sent.getAll('motion');
  const reduceMotion = motion.length === 1 && motion[0] === 'reduce';
  if (reduceMotion) query.motion = 'reduce';
  return { ...(selected === undefined ? {} : { selected }), query, reduceMotion };
}

/** Whether `sent` is already `canonical`'s query, key for key and in its order. */
export function isCanonical(sent: URLSearchParams, canonical: SampleQuery): boolean {
  return sent.toString() === new URLSearchParams(canonical.query).toString();
}

/**
 * Where the canonical redirect goes: `pathname` on `origin`, the
 * deployment's own, with the canonical query. The path is set on that URL,
 * never resolved against it, and each segment is percent-encoded, so no
 * segment, `//`, a scheme, a backslash, or `@` included, moves it to another
 * host. A dot segment would still collapse, as it does in any URL, so the
 * page answers a path with one as missing before it asks for this.
 */
export function canonicalLocation(
  origin: string,
  segments: readonly string[],
  canonical: SampleQuery,
): string {
  const url = new URL(origin);
  url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  url.search = new URLSearchParams(canonical.query).toString();
  url.hash = '';
  return url.href;
}

/** Whether `segment` is one a URL collapses: `.` or `..`, however its dots are spelled. */
export function isDotSegment(segment: string): boolean {
  return /^(?:\.|%2e){1,2}$/i.test(segment);
}
