// What a composition's own navigation, case-study page, and footer read
// (stream E, compositions own their components): the page's outline, built
// from the render input alone, with no markup. A composition renders any
// pattern from it: a sticky table of contents, an orbital navigator, a scene
// scrubber, a bento index, a grouped menu. pageOutline() lists a section
// exactly when renderSection() renders it (sectionRenders()), so a link from
// it always lands; every href is a real link that works with no JavaScript,
// and every anchor is the DOM id the section's frame carries, stable from
// render to render for a scroll spy. Nothing here reads the clock, the
// network, or randomness.

import type { CaseStudy, Link, Section, Work } from '@portfolio/schema';
import type { RouteTarget, VariantRenderInput } from '@portfolio/variant-contract';
import { routeHref } from '@portfolio/variant-contract/runtime';
import type { PlacedImage } from './media';
import { hrefFor, present } from './primitives';
import { CASE_STUDY_FIELDS, type CaseStudyField } from './case-study-fields';
import { anchorOf, frameAttributes, sectionRenders } from './render-section';
import type { SectionComposition } from './types';
import {
  chronologyOf,
  evidenceOf,
  isRoutedWork,
  placedImage,
  routedWork,
  worksOf,
  type RoutedWork,
} from './view';

/**
 * A family of section kinds, for a navigation that groups its links. The
 * content model has no authored section groups, so this comes from the kind
 * alone: every core kind's family is in KIND_FAMILIES, and every extension
 * kind is `other`.
 */
export type OutlineFamily =
  'opening' | 'work' | 'proof' | 'history' | 'practice' | 'personal' | 'connect' | 'other';

/** Each core kind's family. */
export const KIND_FAMILIES: Readonly<Record<Section['kind'] & string, OutlineFamily>> = {
  hero: 'opening',
  lede: 'opening',
  works: 'work',
  evidence: 'proof',
  github: 'proof',
  chronology: 'history',
  practice: 'practice',
  focus: 'practice',
  now: 'personal',
  quote: 'personal',
  'fun-facts': 'personal',
  contact: 'connect',
  cta: 'connect',
  custom: 'other',
};

/** The first item a section lists, by what the owner called it. */
export interface OutlineItem {
  readonly title: string;
  /** Its language, when it isn't the section's. */
  readonly lang?: string;
}

/** One section the page renders, in reading order. */
export interface OutlineSection {
  /** The content id. */
  readonly id: string;
  /**
   * Its frame's DOM id: the render's id prefix, then the anchor the
   * composition's anchorOf() gives it, its content id by default. None when
   * the composition says the section takes no anchor.
   */
  readonly anchor?: string;
  /** A real link to it from the current route: `#<anchor>` on home, home's path and the fragment anywhere else. None without an anchor. */
  readonly href?: string;
  readonly kind: string;
  readonly family: OutlineFamily;
  readonly title?: string;
  readonly subtitle?: string;
  readonly lang?: string;
  /** Set when the section's language runs the other way from the portfolio, as its frame's `dir` is. */
  readonly dir?: 'ltr' | 'rtl';
  /** The items it shows: works, evidence, entries, items, groups, or links. 0 for a kind with none. */
  readonly count: number;
  readonly firstItem?: OutlineItem;
  /** The first image among its items: a work's cover or first image, or a custom item's first image. */
  readonly leadImage?: PlacedImage;
  /**
   * A works section's mediums: each distinct `medium` among the works it
   * shows, in the order they first appear, with how many of them have it.
   * None on any other kind.
   */
  readonly media?: readonly OutlineMedium[];
  /**
   * An evidence section's types: each distinct `type` among the entries it
   * shows, such as `publication` or `metric`, in the order they first
   * appear, with how many entries have it. None on any other kind.
   */
  readonly types?: readonly OutlineEvidenceType[];
  /** A practice section's part: `thesis`, `skills`, `tools`, or `services`. None on any other kind. */
  readonly part?: string;
}

/** One evidence type an evidence section shows, and how many of its entries have it. */
export interface OutlineEvidenceType {
  /** One of EVIDENCE_TYPES, such as `publication`. */
  readonly type: string;
  readonly count: number;
}

/** One medium a works section shows, and how many of its works have it. */
export interface OutlineMedium {
  /** A core medium from WORK_MEDIA, such as `writing`, or an extension's `<package>/<name>`. */
  readonly medium: string;
  readonly count: number;
}

/** A work with its own page. */
export interface OutlineWork {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly lang?: string;
  readonly href: string;
  /** Whether it's the work the current route shows. */
  readonly current: boolean;
  readonly cover?: PlacedImage;
}

export interface PageOutline {
  readonly route: RouteTarget;
  /** The portfolio's display name, the identity's, as footerOutline() gives it. */
  readonly name: string;
  /** The portfolio's locale, which a section's `lang` differs from when it's in another language. */
  readonly locale: string;
  /** Home's path, with the render's query. */
  readonly home: string;
  /** Every section the page renders, in reading order. */
  readonly sections: readonly OutlineSection[];
  /** Every work with its own page, in the order works pageOutline() describes. */
  readonly works: readonly OutlineWork[];
}

type Item = { title?: string; lang?: string; image?: PlacedImage; medium?: string; type?: string };

/** What a section lists, in its order, as the outline names them. */
function itemsOf(section: Section, input: VariantRenderInput): { count: number; items: Item[] } {
  const listed = (items: Item[]) => ({ count: items.length, items });
  switch (section.kind) {
    case 'works':
      return listed(
        worksOf(section, input).map((work) => ({
          title: work.title,
          lang: work.lang,
          image: placedImage(work.cover ?? work.media?.[0], input),
          medium: work.medium,
        })),
      );
    case 'evidence':
      return listed(
        evidenceOf(section, input).map((entry) => ({
          title: present(entry.title) ? entry.title : entry.source?.name,
          lang: entry.lang,
          type: entry.type,
        })),
      );
    case 'chronology':
      return listed(
        chronologyOf(section, input).map((entry) => ({ title: entry.title, lang: entry.lang })),
      );
    case 'custom':
      return listed(
        (section.items ?? []).map((item) => ({
          title: item.title,
          image: placedImage(item.media?.[0], input),
        })),
      );
    case 'focus':
    case 'fun-facts':
      return listed(section.items.map((title) => ({ title })));
    case 'practice': {
      const practice = input.portfolio.practice;
      if (section.part === 'thesis') return listed([]);
      const groups = practice?.[section.part] ?? [];
      return listed(
        groups.map((group) => ({
          title: present(group.name)
            ? group.name
            : typeof group.items[0] === 'string'
              ? group.items[0]
              : group.items[0]?.name,
        })),
      );
    }
    case 'contact':
      return listed(contactLinks(input).map((link) => ({ title: linkText(link) })));
    default:
      return listed([]);
  }
}

const linkText = (link: Link) => [link.label, link.platform].find(present) ?? link.url;

/**
 * The ways to get in touch a contact section lists, as its shared renderer
 * does: the identity's email, unless a link already points at it, then the
 * contact record's links, else the portfolio's.
 */
function contactLinks(input: VariantRenderInput): readonly Link[] {
  const { identity, links: portfolioLinks, contact } = input.portfolio;
  const links = contact?.links?.length ? contact.links : portfolioLinks;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email !== undefined ? `mailto:${email}` : undefined;
  return mailto !== undefined &&
    !links.some((link) => link.url.toLowerCase() === mailto.toLowerCase())
    ? [{ platform: 'email', url: mailto, label: email }, ...links]
    : links;
}

/** Where `anchor` is from the current route. */
function anchorHref(input: VariantRenderInput, anchor: string): string {
  return input.route.route === 'home'
    ? `#${anchor}`
    : `${routeHref(input, { route: 'home' })}#${anchor}`;
}

/** The section's entry. */
function outlineSection(
  section: Section,
  input: VariantRenderInput,
  composition: Anchoring | undefined,
): OutlineSection {
  // The frame's own attributes, so the outline's anchor, lang, and dir are the frame's.
  const frame = frameAttributes(section, input, false, anchorOf(section, composition));
  const anchor = frame.id;
  const { count, items } = itemsOf(section, input);
  const first = items.find((item) => present(item.title));
  const image = items.find((item) => item.image !== undefined)?.image;
  const media = section.kind === 'works' ? mediaOf(items) : undefined;
  const types = section.kind === 'evidence' ? typesOf(items) : undefined;
  const part = section.kind === 'practice' ? section.part : undefined;
  const title = 'title' in section && present(section.title) ? section.title : undefined;
  const subtitle =
    'subtitle' in section && present(section.subtitle) ? section.subtitle : undefined;
  return {
    id: section.id,
    ...(anchor !== undefined ? { anchor, href: anchorHref(input, anchor) } : {}),
    kind: section.kind,
    family: KIND_FAMILIES[section.kind as keyof typeof KIND_FAMILIES] ?? 'other',
    ...(title !== undefined ? { title } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(frame.lang !== undefined ? { lang: frame.lang } : {}),
    ...(frame.dir !== undefined ? { dir: frame.dir } : {}),
    count,
    ...(first
      ? { firstItem: { title: first.title!, ...(first.lang ? { lang: first.lang } : {}) } }
      : {}),
    ...(image ? { leadImage: image } : {}),
    ...(media ? { media } : {}),
    ...(types ? { types } : {}),
    ...(part !== undefined ? { part } : {}),
  };
}

/** Each distinct value of `key` among `items`, in first-seen order, with how many items have it. */
function tally(items: readonly Item[], key: 'medium' | 'type'): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = item[key];
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts];
}

/** The distinct mediums among a works section's items, in first-seen order, each with its count. */
function mediaOf(items: readonly Item[]): readonly OutlineMedium[] {
  return tally(items, 'medium').map(([medium, count]) => ({ medium, count }));
}

/** The distinct types among an evidence section's entries, in first-seen order, each with its count. */
function typesOf(items: readonly Item[]): readonly OutlineEvidenceType[] {
  return tally(items, 'type').map(([type, count]) => ({ type, count }));
}

/**
 * Every work with its own page, in the order the page lists them: through
 * the rendered works sections in reading order, then any routed work no
 * rendered section lists, in the portfolio's record order. Previous and
 * next on a case study follow this order.
 */
function routedWorks(input: VariantRenderInput): readonly RoutedWork[] {
  const seen = new Set<string>();
  const order: RoutedWork[] = [];
  const add = (work: Work) => {
    if (!isRoutedWork(work) || seen.has(work.id)) return;
    seen.add(work.id);
    order.push(work);
  };
  for (const section of input.portfolio.sections) {
    if (section.kind === 'works' && sectionRenders(section, input)) {
      for (const work of worksOf(section, input)) add(work);
    }
  }
  for (const work of input.portfolio.works) add(work);
  return order;
}

function outlineWork(work: RoutedWork, input: VariantRenderInput): OutlineWork {
  const current = input.route.route !== 'home' && input.route.slug === work.slug;
  const cover = placedImage(work.cover, input);
  return {
    id: work.id,
    slug: work.slug,
    title: work.title,
    ...(work.lang !== undefined ? { lang: work.lang } : {}),
    href: routeHref(input, { route: 'work', slug: work.slug }),
    current,
    ...(cover ? { cover } : {}),
  };
}

/** What the outline reads of a composition: how its frames take their anchors. */
type Anchoring = Pick<SectionComposition, 'anchorOf'>;

/**
 * The page's outline: what any navigation the composition draws reads. Pass
 * the composition's SectionComposition when it sets anchorOf(), so each
 * anchor is the one its frame carries.
 */
export function pageOutline(input: VariantRenderInput, composition?: Anchoring): PageOutline {
  return {
    route: input.route,
    name: input.portfolio.identity.name,
    locale: input.portfolio.locale,
    home: routeHref(input, { route: 'home' }),
    sections: input.portfolio.sections
      .filter((section) => sectionRenders(section, input))
      .map((section) => outlineSection(section, input, composition)),
    works: routedWorks(input).map((work) => outlineWork(work, input)),
  };
}

export { CASE_STUDY_FIELDS, type CaseStudyField };

/**
 * One part of a case study the work has. It names the part by its key and gives no
 * heading: each composition labels its stops in its own words, so no two case studies
 * print the same fixed heads in the same order.
 */
export interface CaseStudyPart {
  readonly key: CaseStudyField;
  /**
   * A DOM id for the part, for a composition that heads it: the render's id
   * prefix, the work's id, two hyphens, and the key. Two hyphens: no content
   * id has them, so none can take this one.
   */
  readonly anchor: string;
  readonly href: string;
  /** Decisions and cited evidence count their items; every other part is 1. */
  readonly count: number;
}

/** A work related to the one the page shows, and why. */
export interface RelatedWork extends OutlineWork {
  /** The tags and tools the two share, in the shown work's order. */
  readonly shared: readonly string[];
  readonly sameMedium: boolean;
}

/** What a work's own page reads. */
export interface CaseStudyOutline {
  readonly work: RoutedWork;
  readonly home: string;
  /** The parts the work's case study has, in order. */
  readonly parts: readonly CaseStudyPart[];
  readonly previous?: OutlineWork;
  readonly next?: OutlineWork;
  /**
   * Other works with their own page that share a tag or a tool with this
   * one, most shared first, then those of the same medium, each group in
   * the works' order. The composition shows as many as it wants.
   */
  readonly related: readonly RelatedWork[];
  /** Every work with its own page, as pageOutline() lists them. */
  readonly works: readonly OutlineWork[];
}

function hasPart(study: CaseStudy, key: CaseStudyField, cited: number): number {
  if (key === 'decisions') return study.decisions?.length ?? 0;
  if (key === 'evidence') return present(study.evidence) || cited > 0 ? Math.max(cited, 1) : 0;
  return present(study[key]) ? 1 : 0;
}

/**
 * The outline of the case-study page the input renders, or null on any
 * route that isn't a work's own page.
 */
export function caseStudyOutline(input: VariantRenderInput): CaseStudyOutline | null {
  const work = routedWork(input);
  if (!work) return null;
  const cited = work.evidence?.filter((id) =>
    input.portfolio.evidence.some((e) => e.id === id),
  ).length;
  const parts: CaseStudyPart[] = CASE_STUDY_FIELDS.flatMap(([key]) => {
    const count = hasPart(work.caseStudy, key, cited ?? 0);
    if (count === 0) return [];
    const anchor = `${input.ids.prefix}${work.id}--${key}`;
    return [{ key, anchor, href: `#${anchor}`, count }];
  });
  const works = routedWorks(input);
  const index = works.findIndex((each) => each.id === work.id);
  const terms = [...(work.tags ?? []), ...(work.tools ?? [])];
  const related = works
    .filter((each) => each.id !== work.id)
    .map((each, order) => {
      const theirs = new Set([...(each.tags ?? []), ...(each.tools ?? [])]);
      const shared = [...new Set(terms.filter((term) => theirs.has(term)))];
      return { each, order, shared, sameMedium: each.medium === work.medium };
    })
    .filter(({ shared, sameMedium }) => shared.length > 0 || sameMedium)
    .sort((a, b) => b.shared.length - a.shared.length || a.order - b.order)
    .map(({ each, shared, sameMedium }) => ({ ...outlineWork(each, input), shared, sameMedium }));
  const previous = index > 0 ? works[index - 1] : undefined;
  const next = index >= 0 && index < works.length - 1 ? works[index + 1] : undefined;
  return {
    work,
    home: routeHref(input, { route: 'home' }),
    parts,
    ...(previous ? { previous: outlineWork(previous, input) } : {}),
    ...(next ? { next: outlineWork(next, input) } : {}),
    related,
    works: works.map((each) => outlineWork(each, input)),
  };
}

/** A link a footer shows. */
export interface FooterLink {
  /** Its label, else its platform, else its URL, as the shared renderers write it. */
  readonly text: string;
  readonly href: string;
  readonly platform?: string;
}

/**
 * What a footer reads. The call to action's actions keep their own labels,
 * the email stays as the address, and each link list leaves out any target
 * the call to action or the email reaches, and its own repeats ("Download
 * CV" stands for the CV, so a "Resume" link to the same file isn't listed
 * again). `links` and `contact.links` are alternatives, as the shared
 * contact renderer shows one or the other, so they may share a target: a
 * footer that shows both dedupes them itself, with sameTarget().
 */
export interface FooterOutline {
  readonly name: string;
  readonly tagline?: string;
  /**
   * A mailto link, when the identity has an email, with the address as its
   * text, even when a call to action's action already mails it: a footer
   * shows the address once as text beside that action.
   */
  readonly email?: FooterLink;
  /** The portfolio's own links: its social profiles and sites, in order, none the cta or email reaches. */
  readonly links: readonly FooterLink[];
  /** The contact record's message and links, when there's one, none the cta or email reaches. */
  readonly contact?: { readonly message?: string; readonly links: readonly FooterLink[] };
  /** A real link to the contact section, when one renders. */
  readonly contactHref?: string;
  /**
   * The call to action a closing block merges with the contact: the cta
   * section just before or just after the contact section in the page's
   * order, or with no contact section, the page's last cta. None when no
   * such section renders.
   */
  readonly cta?: FooterCta;
  /** For a colophon: the portfolio's title and description, and its language and direction. */
  readonly colophon: {
    readonly title?: string;
    readonly description?: string;
    readonly locale: string;
    readonly direction: 'ltr' | 'rtl';
  };
  /** The render's day, `env.now`, and its UTC year, for a copyright line. The view has no publish time yet. */
  readonly renderedOn: string;
  readonly year: number;
}

/** A call to action, as a closing block merges it. */
export interface FooterCta {
  /**
   * The cta section's content id. A composition that merges it into its
   * closing block renders it there, framed, and not again in the reading order.
   */
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  /** The section's language, when it isn't the portfolio's. */
  readonly lang?: string;
  /** Its primary action, the one the closing block leads with. */
  readonly primary?: FooterLink;
  readonly secondary?: FooterLink;
}

/** The cta section footerOutline() exposes, among the sections that render. */
function closingCta(rendered: readonly Section[]): Section | undefined {
  const at = rendered.findIndex((section) => section.kind === 'contact');
  if (at === -1) return rendered.findLast((section) => section.kind === 'cta');
  return [rendered[at + 1], rendered[at - 1]].find((section) => section?.kind === 'cta');
}

function footerCta(section: Section, input: VariantRenderInput): FooterCta | undefined {
  if (section.kind !== 'cta') return undefined;
  const primary = section.primaryAction ? footerLink(section.primaryAction, input) : undefined;
  const secondary = section.secondaryAction
    ? footerLink(section.secondaryAction, input)
    : undefined;
  return {
    id: section.id,
    ...(present(section.title) ? { title: section.title } : {}),
    ...(present(section.description) ? { description: section.description } : {}),
    ...(section.lang !== undefined ? { lang: section.lang } : {}),
    ...(primary ? { primary } : {}),
    // A second action to the first's own target is the same place.
    ...(secondary && !(primary && sameTarget(primary.href, secondary.href)) ? { secondary } : {}),
  };
}

/**
 * A link target, compared as a visitor reaches it: a mailto by its
 * addresses alone, in any case, whatever subject or body it presets; a web
 * address with its scheme and host in any case; and a path with or without
 * its last slash.
 */
function targetKey(href: string): string {
  const trimmed = href.trim();
  if (/^mailto:/i.test(trimmed)) {
    return `mailto:${trimmed.slice('mailto:'.length).split('?')[0]!.toLowerCase()}`;
  }
  return trimmed
    .replace(/^https?:\/\/[^/?#]*/i, (origin) => origin.toLowerCase())
    .replace(/(?<=[^/])\/+(?=$|[?#])/, '');
}

/**
 * Whether two hrefs reach the same place, as footerOutline() dedupes them:
 * a mailto by its addresses, whatever it presets, a web address with its
 * scheme and host in any case, a path with or without its last slash.
 */
export const sameTarget = (a: string, b: string): boolean => targetKey(a) === targetKey(b);

/** The links whose targets none of `reached` is, nor an earlier link, in order. */
function unreached(links: readonly FooterLink[], reached: readonly string[]): FooterLink[] {
  const seen = new Set(reached.map(targetKey));
  return links.filter((link) => {
    const key = targetKey(link.href);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function footerLink(link: Link, input: VariantRenderInput): FooterLink {
  return {
    text: linkText(link),
    href: hrefFor(link.url, input),
    ...(link.platform !== undefined ? { platform: link.platform } : {}),
  };
}

/**
 * What a footer reads, from the render input alone. Pass the composition's
 * SectionComposition when it sets anchorOf(), as for pageOutline().
 */
export function footerOutline(input: VariantRenderInput, composition?: Anchoring): FooterOutline {
  const { identity, contact, meta, links } = input.portfolio;
  const contactSection = input.portfolio.sections.find(
    (section) => section.kind === 'contact' && sectionRenders(section, input),
  );
  const contactAnchor = contactSection ? anchorOf(contactSection, composition) : null;
  const cta = closingCta(
    input.portfolio.sections.filter((section) => sectionRenders(section, input)),
  );
  const closing = cta ? footerCta(cta, input) : undefined;
  const email = present(identity.email)
    ? { text: identity.email.trim(), href: `mailto:${identity.email.trim()}` }
    : undefined;
  // What the call to action and the email already reach, which no link list repeats.
  const reached = [closing?.primary, closing?.secondary, email].flatMap((link) =>
    link ? [link.href] : [],
  );
  const listed = (each: readonly Link[]) =>
    unreached(
      each.map((link) => footerLink(link, input)),
      reached,
    );
  return {
    name: identity.name,
    ...(present(identity.tagline) ? { tagline: identity.tagline } : {}),
    ...(email ? { email } : {}),
    links: listed(links),
    ...(contact
      ? {
          contact: {
            ...(present(contact.message) ? { message: contact.message } : {}),
            links: listed(contact.links ?? []),
          },
        }
      : {}),
    ...(contactAnchor !== null
      ? { contactHref: anchorHref(input, `${input.ids.prefix}${contactAnchor}`) }
      : {}),
    ...(closing ? { cta: closing } : {}),
    colophon: {
      ...(present(meta?.title) ? { title: meta.title } : {}),
      ...(present(meta?.description) ? { description: meta.description } : {}),
      locale: input.portfolio.locale,
      direction: input.portfolio.direction,
    },
    renderedOn: input.env.now,
    year: new Date(input.env.now).getUTCFullYear(),
  };
}
