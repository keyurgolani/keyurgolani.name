import { createExtensionRegistry } from './extensions';
import { RESERVED_SECTION_IDS, parseExtensionKind } from './ids';
import { isPlainObject } from './json';
import type { Placement } from './kinds/common';
import type { Section } from './kinds';
import type { MediaKind } from './kinds/records';
import type { Portfolio } from './portfolio';
import { redactedPointer } from './secrets';
import type { Context, DiagnosticCode } from './diagnostics';
import { isPublic, reachRecords, type ParsedPair, type ReachedRecords } from './view';

// The checks across a pair that parsed (#4, items 13 to 15, for version 3,
// #10 items 1, 3, and 4): site references, references between records and
// to media, the curation lists, slugs, anchors, metric claims, alt text, and
// link origins. Each reports by pointer; messages never repeat a value from
// the documents, apart from ids, which are id-shaped.

export type PairReport = (
  document: 'portfolio' | 'site',
  code: DiagnosticCode,
  path: readonly (string | number)[],
  message: string,
) => void;

type Path = readonly (string | number)[];
type Target = 'work' | 'evidence' | 'chronology' | 'media';

const TARGET_NAMES: Readonly<Record<Target, string>> = {
  work: 'work',
  evidence: 'evidence',
  chronology: 'chronology entry',
  media: 'media asset',
};

export function checkPair(
  pair: ParsedPair,
  ctx: Context,
  notChecked: string[],
  report: PairReport,
): void {
  const { portfolio, site } = pair;
  const registry = createExtensionRegistry(ctx.extensions ?? []);
  const sections = portfolio.sections ?? [];
  const sectionIds = new Set(sections.map(({ id }) => id));
  for (const id of Object.keys(site.sections ?? {})) {
    if (!sectionIds.has(id)) {
      report(
        'site',
        'ref.missing',
        ['sections', id],
        `${redactedPointer(['sections', id])} names no section in the portfolio.`,
      );
    }
  }

  const reached = reachRecords(pair, registry);
  if (reached.sections.length === 0) {
    report('portfolio', 'content.empty', ['sections'], 'The portfolio has no visible section.');
  }

  // A section is visible unless the site hides it or no registered extension renders it.
  const visible = sections.map((section) => {
    if (site.sections?.[section.id]?.hidden === true) return false;
    const extension = parseExtensionKind(section.kind);
    return !extension || registry.extension(extension.namespace) !== undefined;
  });
  const shown = new Set(reached.sections.map(({ id }) => id));
  sections.forEach((section, index) => {
    if (visible[index] && !shown.has(section.id)) {
      report(
        'portfolio',
        'section.empty',
        ['sections', index],
        `${redactedPointer(['sections', index])} has nothing visitors may see, so it leaves the page and the navigation.`,
      );
    }
  });

  checkReferences(portfolio, visible, report);
  checkCuration(portfolio, report);
  checkSlugs(portfolio, report);

  const links = publicUrls(portfolio, visible, reached);
  const targets = new Set([
    ...RESERVED_SECTION_IDS,
    ...shown,
    ...reached.works,
    ...reached.evidence,
    ...reached.chronology,
  ]);
  for (const { path, url } of links) {
    const fragment = /^\/?#(.+)$/.exec(url)?.[1];
    if (fragment !== undefined && !targets.has(fragment)) {
      report(
        'portfolio',
        'anchor.broken',
        path,
        `${redactedPointer(path)} links to no visible section or record.`,
      );
    }
  }

  checkMetrics(portfolio, reached, report);
  checkAltText(portfolio, visible, reached, report);

  const origin = canonicalHost(ctx.canonicalOrigin);
  if (origin === undefined) {
    notChecked.push('origin.sample', 'origin.stale');
    return;
  }
  for (const { path, url } of links) {
    const host = httpHost(url);
    const sample = host !== undefined ? isSampleHost(host) : mailDomains(url).some(isSampleHost);
    if (!isSampleHost(origin) && sample) {
      report(
        'portfolio',
        'origin.sample',
        path,
        `${redactedPointer(path)} links to a sample address.`,
      );
    } else if (host !== undefined && isStaleHost(host, origin)) {
      report(
        'portfolio',
        'origin.stale',
        path,
        `${redactedPointer(path)} links to a host that differs from the configured origin's only in its last label.`,
      );
    }
  }
}

/** One reference in the document: where it is, what it names, and what it must name. */
interface Reference {
  readonly path: Path;
  readonly id: string;
  readonly target: Target;
  /** For a placement, the media kinds the place takes. */
  readonly kinds?: readonly MediaKind[];
  /** Whether visitors see the referrer, so a private target drops out of view. */
  readonly public: boolean;
}

const IMAGE: readonly MediaKind[] = ['image'];

/** Every reference to a record or a media asset, in document order. */
export function references(portfolio: Portfolio, visible: readonly boolean[]): Reference[] {
  const found: Reference[] = [];
  const add = (
    path: Path,
    id: string | undefined,
    target: Target,
    shown: boolean,
    kinds?: readonly MediaKind[],
  ) => {
    if (id !== undefined)
      found.push({ path, id, target, public: shown, ...(kinds ? { kinds } : {}) });
  };
  const place = (
    path: Path,
    placement: Placement | undefined,
    shown: boolean,
    kinds?: readonly MediaKind[],
  ) => {
    if (placement) add([...path, 'asset'], placement.asset, 'media', shown, kinds);
  };
  const places = (path: Path, placements: readonly Placement[] | undefined, shown: boolean) =>
    placements?.forEach((placement, index) => place([...path, index], placement, shown));
  const ids = (path: Path, values: readonly string[] | undefined, target: Target, shown: boolean) =>
    values?.forEach((id, index) => add([...path, index], id, target, shown));

  place(['identity', 'avatar'], portfolio.identity.avatar, true, IMAGE);
  place(['meta', 'ogImage'], portfolio.meta?.ogImage, true, IMAGE);
  add(['signature'], portfolio.signature, 'work', true);
  ids(['featured'], portfolio.featured, 'work', true);
  ids(['proof'], portfolio.proof, 'evidence', true);
  ids(['archive'], portfolio.archive, 'work', true);
  portfolio.works?.forEach((work, index) => {
    const at = ['works', index];
    const shown = isPublic(work);
    place([...at, 'cover'], work.cover, shown, IMAGE);
    places([...at, 'media'], work.media, shown);
    ids([...at, 'evidence'], work.evidence, 'evidence', shown);
  });
  portfolio.evidence?.forEach((evidence, index) => {
    place(
      ['evidence', index, 'source', 'avatar'],
      evidence.source?.avatar,
      isPublic(evidence),
      IMAGE,
    );
  });
  portfolio.chronology?.forEach((entry, index) => {
    const at = ['chronology', index];
    const shown = isPublic(entry);
    place([...at, 'logo'], entry.logo, shown, IMAGE);
    add([...at, 'branchesFrom'], entry.branchesFrom, 'chronology', shown);
    add([...at, 'mergesInto'], entry.mergesInto, 'chronology', shown);
    ids([...at, 'works'], entry.works, 'work', shown);
  });
  (portfolio.sections ?? []).forEach((section, index) => {
    const at = ['sections', index];
    const shown = visible[index] === true;
    switch (section.kind) {
      case 'works':
        ids([...at, 'items'], section.items, 'work', shown);
        break;
      case 'evidence':
        ids([...at, 'items'], section.items, 'evidence', shown);
        break;
      case 'chronology':
        ids([...at, 'items'], section.items, 'chronology', shown);
        break;
      case 'custom':
        section.items?.forEach((item, position) => {
          places([...at, 'items', position, 'media'], item.media, shown);
          ids([...at, 'items', position, 'evidence'], item.evidence, 'evidence', shown);
        });
        break;
      default:
        break;
    }
  });
  return found;
}

/** What each id in the document names, and whether it's public, and for media its kind. */
function targetsOf(portfolio: Portfolio) {
  const targets = new Map<
    string,
    { target: Target | 'section'; public: boolean; kind?: MediaKind }
  >();
  for (const section of portfolio.sections ?? []) {
    if (!targets.has(section.id)) targets.set(section.id, { target: 'section', public: true });
  }
  const lists = [
    ['work', portfolio.works],
    ['evidence', portfolio.evidence],
    ['chronology', portfolio.chronology],
  ] as const;
  for (const [target, records] of lists) {
    for (const record of records ?? []) {
      if (!targets.has(record.id)) targets.set(record.id, { target, public: isPublic(record) });
    }
  }
  for (const asset of portfolio.media ?? []) {
    if (!targets.has(asset.id)) {
      targets.set(asset.id, { target: 'media', public: isPublic(asset), kind: asset.kind });
    }
  }
  return targets;
}

function checkReferences(portfolio: Portfolio, visible: readonly boolean[], report: PairReport) {
  const targets = targetsOf(portfolio);
  for (const reference of references(portfolio, visible)) {
    const pointer = redactedPointer(reference.path);
    const found = targets.get(reference.id);
    const wanted = TARGET_NAMES[reference.target];
    if (found === undefined) {
      report(
        'portfolio',
        'ref.unresolved',
        reference.path,
        `${pointer} names no ${wanted} in the portfolio.`,
      );
    } else if (found.target !== reference.target) {
      const what = found.target === 'section' ? 'a section' : `a ${TARGET_NAMES[found.target]}`;
      report('portfolio', 'ref.type', reference.path, `${pointer} names ${what}, not a ${wanted}.`);
    } else if (
      reference.kinds &&
      found.kind !== undefined &&
      !reference.kinds.includes(found.kind)
    ) {
      report(
        'portfolio',
        'ref.type',
        reference.path,
        `${pointer} names a media asset of kind ${found.kind}; this place shows ${reference.kinds.join(' or ')}.`,
      );
    } else if (reference.public && !found.public) {
      report(
        'portfolio',
        'ref.private',
        reference.path,
        `${pointer} names a private ${wanted}, so it drops out of what visitors see.`,
      );
    }
  }
}

/** The signature isn't featured, featured and archive share no work, and no list repeats one. */
function checkCuration(portfolio: Portfolio, report: PairReport) {
  const featured = new Set<string>();
  const repeats = (list: 'featured' | 'proof' | 'archive', what: string) => {
    const seen = new Set<string>();
    portfolio[list]?.forEach((id, index) => {
      if (seen.has(id)) {
        report(
          'portfolio',
          'curation.overlap',
          [list, index],
          `/${list}/${index} repeats an earlier ${what} in the list.`,
        );
      }
      seen.add(id);
    });
  };
  repeats('featured', 'work');
  repeats('proof', 'piece of evidence');
  repeats('archive', 'work');
  portfolio.featured?.forEach((id, index) => {
    featured.add(id);
    if (id === portfolio.signature) {
      report(
        'portfolio',
        'curation.overlap',
        ['featured', index],
        `/featured/${index} is the signature work. The signature leads on its own; featured lists the works after it.`,
      );
    }
  });
  portfolio.archive?.forEach((id, index) => {
    if (featured.has(id) || id === portfolio.signature) {
      report(
        'portfolio',
        'curation.overlap',
        ['archive', index],
        `/archive/${index} is also the signature or a featured work. A work is featured or archived, not both.`,
      );
    }
  });
}

/** Slugs are unique among routed works: public works with a case study. */
function checkSlugs(portfolio: Portfolio, report: PairReport) {
  const first = new Map<string, number>();
  portfolio.works?.forEach((work, index) => {
    if (!isPublic(work) || work.caseStudy === undefined || work.slug === undefined) return;
    const earlier = first.get(work.slug);
    if (earlier === undefined) {
      first.set(work.slug, index);
      return;
    }
    report(
      'portfolio',
      'slug.duplicate',
      ['works', index, 'slug'],
      `/works/${index}/slug is the slug of /works/${earlier} too. Each case study has a route of its own.`,
    );
  });
}

/**
 * Every url and *Url value visitors can reach: in visible sections, kept
 * records, the identity, links, meta, and the parts of practice and contact
 * a visible section shows. Never inside extension data, which only its
 * extension understands, and never a media source, which isn't a link.
 */
function publicUrls(portfolio: Portfolio, visible: readonly boolean[], reached: ReachedRecords) {
  const found: Array<{ path: (string | number)[]; url: string }> = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
      return;
    }
    if (!isPlainObject(node)) return;
    const extensionSection = typeof node.kind === 'string' && parseExtensionKind(node.kind);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'extensions' || (extensionSection && key === 'data')) continue;
      if (typeof child === 'string' && (key === 'url' || key.endsWith('Url'))) {
        found.push({ path: [...path, key], url: child });
      } else {
        walk(child, [...path, key]);
      }
    }
  };
  walk(portfolio.identity, ['identity']);
  walk(portfolio.links, ['links']);
  walk(portfolio.meta, ['meta']);
  for (const part of reached.practice) walk(portfolio.practice?.[part], ['practice', part]);
  if (reached.contact) walk(portfolio.contact, ['contact']);
  const lists = [
    ['works', portfolio.works, reached.works],
    ['evidence', portfolio.evidence, reached.evidence],
    ['chronology', portfolio.chronology, reached.chronology],
  ] as const;
  for (const [list, records, kept] of lists) {
    records?.forEach((record, index) => {
      if (kept.has(record.id)) walk(record, [list, index]);
    });
  }
  (portfolio.sections ?? []).forEach((section: Section, index) => {
    if (visible[index]) walk(section, ['sections', index]);
  });
  return found;
}

/**
 * Each image placement visitors see that's neither decorative nor given alt
 * text, by the placement or by its asset. Renderers never make alt text up,
 * from a title or a caption, so such an image has none.
 */
function checkAltText(
  portfolio: Portfolio,
  visible: readonly boolean[],
  reached: ReachedRecords,
  report: PairReport,
) {
  const assets = new Map((portfolio.media ?? []).map((asset) => [asset.id, asset]));
  const shownRecords = new Set([...reached.works, ...reached.evidence, ...reached.chronology]);
  for (const reference of references(portfolio, visible)) {
    if (reference.target !== 'media' || !reference.public) continue;
    const owner = ownerOf(portfolio, reference.path);
    if (owner !== undefined && !shownRecords.has(owner)) continue;
    const asset = assets.get(reference.id);
    if (!asset || !reached.media.has(asset.id) || asset.kind !== 'image') continue;
    const placement = placementAt(portfolio, reference.path.slice(0, -1));
    const decorative = placement?.decorative ?? asset.decorative ?? false;
    const alt = placement?.alt ?? asset.alt;
    if (!decorative && alt === undefined) {
      const path = reference.path.slice(0, -1);
      report(
        'portfolio',
        'image.alt-missing',
        path,
        `${redactedPointer(path)} shows an image with no alt text, so a visitor who can't see it can't tell what it shows.`,
      );
    }
  }
}

/** The id of the record a path is inside, when it's in one of the record lists. */
function ownerOf(portfolio: Portfolio, path: Path): string | undefined {
  const [list, index] = path;
  if (list !== 'works' && list !== 'evidence' && list !== 'chronology') return undefined;
  return portfolio[list]?.[Number(index)]?.id;
}

function placementAt(portfolio: Portfolio, path: Path): Placement | undefined {
  let node: unknown = portfolio;
  for (const segment of path) {
    if (!isPlainObject(node) && !Array.isArray(node)) return undefined;
    node = (node as Record<string | number, unknown>)[segment];
  }
  return isPlainObject(node) ? (node as Placement) : undefined;
}

/**
 * Metric claims (#10 slice 3 item 4, first sentence): evidence metrics with
 * one key are one claim. Different values conflict, in the document as a
 * whole; the same value visitors see twice is a duplicate.
 */
function checkMetrics(portfolio: Portfolio, reached: ReachedRecords, report: PairReport) {
  interface Stated {
    readonly path: (string | number)[];
    readonly value: number;
    readonly shown: boolean;
  }
  const byKey = new Map<string, Stated[]>();
  portfolio.evidence?.forEach((evidence, index) => {
    const metric = evidence.metric;
    if (metric?.key === undefined || metric.value === undefined) return;
    const stated: Stated = {
      path: ['evidence', index, 'metric', 'value'],
      value: metric.value,
      shown: reached.evidence.has(evidence.id),
    };
    byKey.set(metric.key, [...(byKey.get(metric.key) ?? []), stated]);
  });
  const between = (a: Stated, b: Stated) =>
    `${redactedPointer(a.path)} and ${redactedPointer(b.path)}`;
  for (const stated of byKey.values()) {
    const [first] = stated;
    const groups = new Map<number, Stated[]>();
    for (const one of stated) groups.set(one.value, [...(groups.get(one.value) ?? []), one]);
    for (const [value, group] of groups) {
      if (value !== first!.value) {
        for (const later of group) {
          report(
            'portfolio',
            'metric.conflict',
            later.path,
            `${between(later, first!)} give one metric different values.`,
          );
        }
      }
      const shown = group.filter((one) => one.shown);
      const [earliest] = shown;
      for (const later of shown.slice(1)) {
        report(
          'portfolio',
          'metric.duplicate',
          later.path,
          `${between(later, earliest!)} show one metric with the same value.`,
        );
      }
    }
  }
}

function canonicalHost(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function httpHost(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The domain of each address a mailto: URL names, lowercased. */
function mailDomains(url: string): string[] {
  if (!/^mailto:/i.test(url)) return [];
  let to = url.slice('mailto:'.length).split('?')[0]!;
  try {
    to = decodeURIComponent(to);
  } catch {
    // Kept as written: a stray % only makes the address unreadable.
  }
  return to
    .split(',')
    .map((address) =>
      address
        .slice(address.lastIndexOf('@') + 1)
        .trim()
        .toLowerCase(),
    )
    .filter((domain) => domain !== '');
}

/** The reserved names sample content uses: example.com, .net, .org, *.example, *.test, *.invalid, and localhost. */
function isSampleHost(host: string): boolean {
  const name = host.replace(/\.$/, '');
  return (
    /(^|\.)example\.(?:com|net|org)$/.test(name) ||
    /(^|\.)(?:example|test|invalid|localhost)$/.test(name)
  );
}

/** keyurgolani.com on keyurgolani.name: every label the same but the last, ignoring www. */
function isStaleHost(host: string, origin: string): boolean {
  const labels = (name: string) => name.replace(/^www\./, '').split('.');
  const [a, b] = [labels(host), labels(origin)];
  if (a.length < 2 || a.length !== b.length) return false;
  const last = a.length - 1;
  return a[last] !== b[last] && a.slice(0, last).every((label, index) => label === b[index]);
}
