import {
  createExtensionRegistry,
  type ContentExtension,
  type ExtensionRegistry,
} from './extensions';
import { parseExtensionKind } from './ids';
import { isPlainObject } from './json';
import { looseDateOrder } from './kinds/common';
import type {
  ChronologyEntry,
  Contact,
  Evidence,
  MediaAsset,
  MediaKind,
  Practice,
  PracticePart,
  Work,
} from './kinds/records';
import type { FocalPoint, Link, Placement } from './kinds/common';
import type { Section } from './kinds';
import {
  normalizeMediaBase,
  parseMediaDocument,
  renditionUrl,
  type MediaDocument,
  type MediaRecord,
} from './media';
import type { Identity, Portfolio, PortfolioMeta } from './portfolio';
import type { Site } from './site';
import { parseSnapshot, type GitHubData, type GitHubSnapshot } from './snapshots';

// What visitors may see of a publication unit (#10, item 5): the published
// view. Variants, the render input, JSON-LD, the feed, and the Open Graph
// image read only this view. Pure and browser-safe: no fs, no network, no
// clock. Everything in it is plain JSON.
//
// Hidden means gone: a record stays only when something visible reaches it.
// The roots are the visible sections, the curation lists, and the identity
// and meta. A kept work reaches its evidence and its media; nothing else
// reaches further, and every reference left in the view resolves.

/** A portfolio and site document that both parsed. */
export interface ParsedPair {
  readonly portfolio: Portfolio;
  readonly site: Site;
}

declare const PUBLIC: unique symbol;

/**
 * A document as visitors may see it. Only resolvePortfolioView() makes one,
 * so a renderer that takes it can't be handed a parsed document directly.
 * The brand is a type alone; nothing at run time carries it.
 */
export type Public<T> = T & { readonly [PUBLIC]: true };

/** Why a derived value isn't ready. */
export const UNAVAILABLE_REASONS = [
  'processing',
  'failed',
  'unreachable',
  'never-refreshed',
  'purged',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/**
 * A value derived from outside the documents: ready with the time it was
 * derived, or unavailable with why and since when (null when it never was).
 * A renderer tells this apart from a field that isn't authored, which is
 * simply left out.
 */
export type Derived<T> =
  | { readonly state: 'ready'; readonly value: T; readonly derivedAt: string }
  | {
      readonly state: 'unavailable';
      readonly reason: UnavailableReason;
      readonly since: string | null;
    };

/** One file a renderer may link: a resized image, or an audio, video, or PDF file. */
export interface ViewRendition {
  /** Built from the media base: `<mediaBase>/<assetId>/<sha256>/<name>.<ext>`. */
  readonly url: string;
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
}

/** What the media document derived for an asset, with rendition URLs built. */
export interface ViewMediaValue {
  readonly sha256: string;
  readonly mime: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly aspectRatio?: number;
  readonly dominantColor?: string;
  readonly renditions: readonly ViewRendition[];
}

/**
 * A public media asset a kept record uses: its authored fields, never its
 * source (originals are never served), and its derived record.
 */
export interface ViewMediaAsset {
  readonly id: string;
  readonly kind: MediaKind;
  readonly alt?: string;
  readonly credit?: string;
  readonly focalPoint?: FocalPoint;
  readonly decorative?: boolean;
  readonly derived: Derived<ViewMediaValue>;
}

/** What a section's derived data holds: GitHub's snapshot in slice 1. */
export type SectionDerived = Derived<GitHubData>;

/**
 * The portfolio a renderer takes. Every list is present, possibly empty, and
 * holds only what visitors may see, in authored order. References resolve:
 * a section's items, the curation lists, a work's evidence, and every
 * placement name a record or asset the view holds.
 */
export interface ViewPortfolio {
  readonly schemaVersion: Portfolio['schemaVersion'];
  readonly locale: string;
  readonly direction: Portfolio['direction'];
  readonly identity: Identity;
  readonly links: readonly Link[];
  readonly meta?: PortfolioMeta;
  /** Only the parts a visible practice section shows. */
  readonly practice?: Practice;
  readonly signature?: string;
  readonly featured: readonly string[];
  readonly proof: readonly string[];
  readonly archive: readonly string[];
  readonly works: readonly Work[];
  readonly evidence: readonly Evidence[];
  readonly chronology: readonly ChronologyEntry[];
  /** Only when a visible contact section places it. */
  readonly contact?: Contact;
  /**
   * The visible sections in reading order, each with something to show. A
   * chronology section without authored `items` lists every public entry,
   * newest first.
   */
  readonly sections: readonly Section[];
  readonly extensions?: Portfolio['extensions'];
}

/** The portfolio a renderer takes. */
export type PublicPortfolio = Public<ViewPortfolio>;

/** The published view. */
export interface PublicView {
  readonly portfolio: PublicPortfolio;
  readonly site: Public<Site>;
  /** Every public asset the view's records use, by asset id. */
  readonly media: Readonly<Record<string, ViewMediaAsset>>;
  /** Derived data by section id: each GitHub section's snapshot. */
  readonly derived: Readonly<Record<string, SectionDerived>>;
}

/**
 * The unit's derived inputs, as the store and the catalog readers hold them:
 * the media document and the snapshots by kind, both as plain JSON. The view
 * checks them itself; a known kind that doesn't check counts as missing.
 */
export interface UnitInput {
  readonly media?: unknown;
  readonly snapshots?: Readonly<Record<string, unknown>>;
}

export interface ViewOptions {
  /** Where renditions are served: `/media`, or `/preview-assets/<grant>` in #7's preview. */
  readonly mediaBase: string;
  /** The content extensions this build registers. Data from any other is dropped. */
  readonly extensions?: readonly ContentExtension[];
}

/** The records the view keeps, by id, and the parts of the practice and the contact record. */
export interface ReachedRecords {
  readonly sections: readonly Section[];
  readonly works: ReadonlySet<string>;
  readonly evidence: ReadonlySet<string>;
  readonly chronology: ReadonlySet<string>;
  readonly media: ReadonlySet<string>;
  readonly practice: ReadonlySet<PracticePart>;
  readonly contact: boolean;
}

/**
 * Builds the published view of a pair and its unit's derived inputs: drops
 * site-hidden sections, unregistered extension data, private records, and
 * every record and asset nothing visible reaches; resolves references; and
 * wraps each derived value. The pair is left as it was.
 */
export function resolvePortfolioView(
  pair: ParsedPair,
  unit: UnitInput,
  options: ViewOptions,
): PublicView {
  const base = normalizeMediaBase(options.mediaBase);
  const registry = createExtensionRegistry(options.extensions ?? []);
  const reached = reachRecords(pair, registry);
  const { portfolio } = pair;
  const keep = <T extends { readonly id: string }>(
    records: readonly T[] | undefined,
    ids: ReadonlySet<string>,
  ) => (records ?? []).filter(({ id }) => ids.has(id));
  const placement = (value: Placement | undefined) =>
    value !== undefined && reached.media.has(value.asset) ? value : undefined;
  const placements = (values: readonly Placement[] | undefined) => {
    const kept = (values ?? []).filter(({ asset }) => reached.media.has(asset));
    return kept.length > 0 ? kept : undefined;
  };
  const refs = (values: readonly string[] | undefined, ids: ReadonlySet<string>) => {
    const kept = (values ?? []).filter((id) => ids.has(id));
    return kept.length > 0 ? kept : undefined;
  };

  const works = keep(portfolio.works, reached.works).map((work) =>
    compact({
      ...work,
      cover: placement(work.cover),
      media: placements(work.media),
      evidence: refs(work.evidence, reached.evidence),
    }),
  );
  const evidence = keep(portfolio.evidence, reached.evidence).map((record) =>
    record.source
      ? compact({
          ...record,
          source: compact({ ...record.source, avatar: placement(record.source.avatar) }),
        })
      : record,
  );
  const chronology = keep(portfolio.chronology, reached.chronology).map((entry) =>
    compact({
      ...entry,
      logo: placement(entry.logo),
      branchesFrom:
        entry.branchesFrom !== undefined && reached.chronology.has(entry.branchesFrom)
          ? entry.branchesFrom
          : undefined,
      mergesInto:
        entry.mergesInto !== undefined && reached.chronology.has(entry.mergesInto)
          ? entry.mergesInto
          : undefined,
      works: refs(entry.works, reached.works),
    }),
  );
  const practice = portfolio.practice
    ? compact({
        thesis: reached.practice.has('thesis') ? portfolio.practice.thesis : undefined,
        skills: reached.practice.has('skills') ? portfolio.practice.skills : undefined,
        tools: reached.practice.has('tools') ? portfolio.practice.tools : undefined,
        services: reached.practice.has('services') ? portfolio.practice.services : undefined,
        extensions: portfolio.practice.extensions,
      })
    : undefined;
  const identity = compact({ ...portfolio.identity, avatar: placement(portfolio.identity.avatar) });
  const meta = portfolio.meta
    ? compact({ ...portfolio.meta, ogImage: placement(portfolio.meta.ogImage) })
    : undefined;
  const hasPractice =
    practice !== undefined && Object.keys(practice).some((key) => key !== 'extensions');

  const view: ViewPortfolio = compact({
    schemaVersion: portfolio.schemaVersion,
    locale: portfolio.locale,
    direction: portfolio.direction,
    identity,
    links: portfolio.links ?? [],
    meta,
    practice: hasPractice ? practice : undefined,
    signature:
      portfolio.signature !== undefined && reached.works.has(portfolio.signature)
        ? portfolio.signature
        : undefined,
    featured: (portfolio.featured ?? []).filter((id) => reached.works.has(id)),
    proof: (portfolio.proof ?? []).filter((id) => reached.evidence.has(id)),
    archive: (portfolio.archive ?? []).filter((id) => reached.works.has(id)),
    works,
    evidence,
    chronology,
    contact: reached.contact ? portfolio.contact : undefined,
    sections: reached.sections,
    extensions: portfolio.extensions,
  });

  return {
    portfolio: withoutUnregistered(view, registry) as PublicPortfolio,
    site: withoutUnregistered(pair.site, registry) as Public<Site>,
    media: viewMedia(portfolio.media ?? [], reached.media, unit.media, base, registry),
    derived: viewDerived(reached.sections, unit.snapshots),
  };
}

/** Whether a record is public: one left without `visibility` is. */
export function isPublic(record: { readonly visibility?: string }): boolean {
  return record.visibility !== 'private';
}

/**
 * The sections and records the view keeps (the reachability rule): the
 * visible sections' items, the curation lists, and the identity and meta are
 * the roots, and a kept work reaches its evidence and media. The validator
 * checks `#` anchors against the same records.
 */
export function reachRecords(pair: ParsedPair, registry: ExtensionRegistry): ReachedRecords {
  const { portfolio, site } = pair;
  const publicIds = <T extends { readonly id: string; readonly visibility?: string }>(
    records: readonly T[] | undefined,
  ) => new Map((records ?? []).filter(isPublic).map((record) => [record.id, record]));
  const works = publicIds(portfolio.works);
  const evidence = publicIds(portfolio.evidence);
  const chronology = publicIds(portfolio.chronology);
  const media = publicIds(portfolio.media);

  const keptWorks = new Set<string>();
  const keptEvidence = new Set<string>();
  const keptChronology = new Set<string>();
  const keptMedia = new Set<string>();
  const parts = new Set<PracticePart>();
  let contact = false;
  const useMedia = (value: Placement | undefined) => {
    if (value !== undefined && media.has(value.asset)) keptMedia.add(value.asset);
  };

  const visible = (portfolio.sections ?? []).filter((section) => {
    if (site.sections?.[section.id]?.hidden === true) return false;
    const extension = parseExtensionKind(section.kind);
    return !extension || registry.extension(extension.namespace) !== undefined;
  });

  const sections: Section[] = [];
  for (const section of visible) {
    switch (section.kind) {
      case 'works': {
        const items = section.items.filter((id) => works.has(id));
        items.forEach((id) => keptWorks.add(id));
        if (items.length > 0) sections.push({ ...section, items });
        break;
      }
      case 'evidence': {
        const items = section.items.filter((id) => evidence.has(id));
        items.forEach((id) => keptEvidence.add(id));
        if (items.length > 0) sections.push({ ...section, items });
        break;
      }
      case 'chronology': {
        const items = section.items
          ? section.items.filter((id) => chronology.has(id))
          : newestFirst([...chronology.values()]).map(({ id }) => id);
        items.forEach((id) => keptChronology.add(id));
        if (items.length > 0) sections.push({ ...section, items });
        break;
      }
      case 'practice': {
        if (portfolio.practice?.[section.part] === undefined) break;
        parts.add(section.part);
        sections.push(section);
        break;
      }
      case 'contact': {
        if (portfolio.contact === undefined) break;
        contact = true;
        sections.push(section);
        break;
      }
      case 'custom': {
        const items = section.items?.map((item) =>
          compact({
            ...item,
            media: nonEmpty(item.media?.filter(({ asset }) => media.has(asset))),
            evidence: nonEmpty(item.evidence?.filter((id) => evidence.has(id))),
          }),
        );
        for (const item of items ?? []) {
          item.media?.forEach(useMedia);
          item.evidence?.forEach((id) => keptEvidence.add(id));
        }
        sections.push(compact({ ...section, items: nonEmpty(items) }));
        break;
      }
      default:
        sections.push(section);
    }
  }

  for (const id of [
    portfolio.signature,
    ...(portfolio.featured ?? []),
    ...(portfolio.archive ?? []),
  ]) {
    if (id !== undefined && works.has(id)) keptWorks.add(id);
  }
  for (const id of portfolio.proof ?? []) if (evidence.has(id)) keptEvidence.add(id);
  useMedia(portfolio.identity.avatar);
  useMedia(portfolio.meta?.ogImage);

  // A kept work reaches its evidence and its media; kept evidence and
  // chronology entries reach the media they show.
  for (const id of keptWorks) {
    const work = works.get(id)!;
    for (const ref of work.evidence ?? []) if (evidence.has(ref)) keptEvidence.add(ref);
    useMedia(work.cover);
    work.media?.forEach(useMedia);
  }
  for (const id of keptEvidence) useMedia(evidence.get(id)!.source?.avatar);
  for (const id of keptChronology) useMedia(chronology.get(id)!.logo);

  return {
    sections,
    works: keptWorks,
    evidence: keptEvidence,
    chronology: keptChronology,
    media: keptMedia,
    practice: parts,
    contact,
  };
}

/** Chronology entries newest first: by start, then end, then authored order. */
export function newestFirst<T extends Pick<ChronologyEntry, 'period'>>(entries: readonly T[]): T[] {
  const order = (date: string | undefined) =>
    date === undefined
      ? Number.NEGATIVE_INFINITY
      : (looseDateOrder(date) ?? Number.NEGATIVE_INFINITY);
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        order(b.entry.period.start) - order(a.entry.period.start) ||
        order(b.entry.period.end ?? b.entry.period.start) -
          order(a.entry.period.end ?? a.entry.period.start) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

function viewMedia(
  assets: readonly MediaAsset[],
  kept: ReadonlySet<string>,
  raw: unknown,
  base: string,
  registry: ExtensionRegistry,
): Record<string, ViewMediaAsset> {
  const parsed = raw === undefined ? undefined : parseMediaDocument(raw);
  const document: MediaDocument | undefined = parsed?.ok ? parsed.value : undefined;
  const records = new Map((document?.assets ?? []).map((record) => [record.assetId, record]));
  const out: Record<string, ViewMediaAsset> = {};
  for (const asset of assets) {
    if (!kept.has(asset.id)) continue;
    const record = records.get(asset.id);
    const derived: Derived<ViewMediaValue> = record
      ? { state: 'ready', value: mediaValue(record, base), derivedAt: record.derivedAt }
      : parsed && !parsed.ok
        ? { state: 'unavailable', reason: 'failed', since: null }
        : { state: 'unavailable', reason: 'processing', since: null };
    const entry: ViewMediaAsset = compact({
      id: asset.id,
      kind: asset.kind,
      alt: asset.alt,
      credit: asset.credit,
      focalPoint: asset.focalPoint
        ? (withoutUnregistered(asset.focalPoint, registry) as FocalPoint)
        : undefined,
      decorative: asset.decorative,
      derived,
    });
    Object.defineProperty(out, asset.id, {
      value: entry,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function mediaValue(record: MediaRecord, base: string): ViewMediaValue {
  return compact({
    sha256: record.sha256,
    mime: record.mime,
    bytes: record.bytes,
    width: record.width,
    height: record.height,
    aspectRatio: record.aspectRatio,
    dominantColor: record.dominantColor,
    renditions: record.renditions.map((rendition) =>
      compact({
        url: `${base}/${record.assetId}/${record.sha256}/${rendition.name}.${rendition.ext}`,
        name: rendition.name,
        mime: rendition.mime,
        bytes: rendition.bytes,
        width: rendition.width,
        height: rendition.height,
      }),
    ),
  });
}

function viewDerived(
  sections: readonly Section[],
  raw: Readonly<Record<string, unknown>> | undefined,
): Record<string, SectionDerived> {
  const github = isPlainObject(raw) && Object.hasOwn(raw, 'github') ? raw.github : undefined;
  const parsed = github === undefined ? undefined : parseSnapshot('github', github);
  const snapshot = parsed?.ok ? (parsed.value as GitHubSnapshot) : undefined;
  const records = new Map((snapshot?.records ?? []).map((record) => [record.sectionId, record]));
  const out: Record<string, SectionDerived> = {};
  for (const section of sections) {
    if (section.kind !== 'github') continue;
    const record = records.get(section.id);
    const value: SectionDerived = record
      ? {
          state: 'ready',
          value: { ...record.data, fetchedAt: record.fetchedAt },
          derivedAt: record.fetchedAt,
        }
      : parsed && !parsed.ok
        ? { state: 'unavailable', reason: 'failed', since: null }
        : { state: 'unavailable', reason: 'never-refreshed', since: null };
    Object.defineProperty(out, section.id, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** The list, or undefined when it's empty or missing. */
function nonEmpty<T>(values: readonly T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? [...values] : undefined;
}

/** A copy without the keys whose value is undefined, so the view is plain JSON that round-trips. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

/**
 * A copy without the `extensions` entries no registered extension owns. It
 * never looks inside extension data or `variantControls.<id>.values`, which
 * hold whatever keys their owners chose.
 */
function withoutUnregistered<T>(value: T, registry: ExtensionRegistry): T {
  const walk = (node: unknown, path: readonly (string | number)[]): unknown => {
    if (Array.isArray(node)) return node.map((child, index) => walk(child, [...path, index]));
    if (!isPlainObject(node)) return node;
    const extensionSection = typeof node.kind === 'string' && parseExtensionKind(node.kind);
    const control = path.length === 2 && path[0] === 'variantControls';
    const entries: Array<[string, unknown]> = [];
    for (const [key, child] of Object.entries(node)) {
      if (key === 'extensions' && isPlainObject(child)) {
        const kept = Object.entries(child).filter(([namespace]) => registry.extension(namespace));
        if (kept.length > 0) entries.push([key, Object.fromEntries(kept)]);
      } else if ((extensionSection && key === 'data') || (control && key === 'values')) {
        entries.push([key, child]);
      } else {
        entries.push([key, walk(child, [...path, key])]);
      }
    }
    // fromEntries, so an own __proto__ key stays a key.
    return Object.fromEntries(entries);
  };
  return walk(value, []) as T;
}

/** The kinds of media a placement in each place may hold. */
export const PLACEMENT_KINDS: Readonly<Record<string, readonly MediaKind[]>> = {
  avatar: ['image'],
  ogImage: ['image'],
  cover: ['image'],
  logo: ['image'],
};

export { renditionUrl };
