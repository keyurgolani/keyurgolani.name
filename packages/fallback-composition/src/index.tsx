import type { ReactElement } from 'react';
import type { Link, Section } from '@portfolio/schema';
import {
  CaseStudy,
  footerOutline,
  hrefFor,
  NavigationMenuSlot,
  navigationModel,
  pageOutline,
  renderContext,
  renderSection,
  rhythmFrame,
  sectionRenders,
  sectionRhythms,
  SHARED_SECTIONS,
  VisitorControlSlot,
  routedWork,
  sameTarget,
  type Destination,
  type FooterLink,
  type FooterOutline,
  type NavigationModel,
  type OutlineSection,
  type RoutedWork,
  type SectionComposition,
  type SectionOf,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// The fallback composition (#5): every visible section in content order, in
// one column, each through the kit's shared renderers. The host renders it
// in place of a variant this build doesn't register, and for the contract
// fixtures and #19's matrices; a site can't select it. It owns composition
// alone: no color, type, or motion of its own beyond the shared tokens, and
// no theme toggle. On a work's route (#10b) it renders that work's case
// study, through the kit's shared CaseStudy. The host renders that page here
// for every composition whose manifest says `routes.work: shared`.
//
// Its navigation is the kit's navigationModel() (global rule 7): the chrome
// is the name and the five destinations in their fixed order, and on a
// narrow screen the name and a Menu, the kit's NavigationMenuSlot, which
// leads with the destinations and keeps every section behind one
// disclosure. The host fills the slot with #19's Dialog, and takes the
// visitor's control into it, so this stays a server module that loads
// anywhere. Home ends on its index, every titled section grouped under its
// destination as real links, then one closing block: the contact section
// with the call to action beside it (footerOutline().cta) inside its frame,
// both through the shared renderers, the call to action's primary action
// set apart. A case study ends on a short index: the destinations and the
// works. Where scripts don't run, or no host fills the slot, the Menu is a
// link to the index.

/** Below this, the Menu stands in for the destinations, and the visitor's control moves into it. */
const NARROW = '(width < 48rem)';

/** Every id the owner's content holds, anywhere in it: any of them can be an element's id on the page. */
function contentIds(value: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) contentIds(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'id' && typeof item === 'string') found.add(item);
      else contentIds(item, found);
    }
  }
  return found;
}

/**
 * The Menu's local id. The host's Menu, #19's Dialog, takes a local id,
 * single hyphens only, the same form an owner's ids have, so it's `fc-menu`
 * unless the content already holds that id, and otherwise the first of
 * `fc-menu-2`, `fc-menu-3`, and on, that it doesn't.
 */
function menuId(portfolio: VariantRenderInput['portfolio']): string {
  const taken = contentIds(portfolio, new Set());
  let id = 'fc-menu';
  for (let n = 2; taken.has(id); n += 1) id = `fc-menu-${n}`;
  return id;
}

/** A link in the index. */
interface IndexEntry {
  readonly key: string;
  readonly text: string;
  readonly href: string;
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}

/** One group of the index: a head that links where its destination does, and its other entries. */
interface IndexGroup {
  readonly head: IndexEntry;
  readonly entries: readonly IndexEntry[];
  /** For a More head, the section it links, under its own title. */
  readonly first?: IndexEntry;
}

/** A titled section's entry. */
const entryOf = (section: OutlineSection): IndexEntry | null =>
  section.title !== undefined && section.href !== undefined
    ? {
        key: section.id,
        text: section.title,
        href: section.href,
        ...(section.lang !== undefined ? { lang: section.lang } : {}),
        ...(section.dir !== undefined ? { dir: section.dir } : {}),
      }
    : null;

const present = <T,>(value: T | null): value is T => value !== null;

/** A destination's own link, its label to its first section. */
const destinationEntry = (destination: Destination): IndexEntry => ({
  key: destination.id,
  text: destination.label,
  href: destination.href,
  ...(destination.lang !== undefined ? { lang: destination.lang } : {}),
});

/**
 * The home index, grouped: each destination's head links where the
 * destination does, then its other titled sections, in the chrome's order,
 * none of them the head's own. A destination with one section is its head
 * alone, so no group holds a single link, and sections the closing block
 * shows aren't listed again: a destination left with none drops out.
 * Titled sections no destination takes, such as a custom one, follow under
 * More.
 */
function indexGroups(
  model: NavigationModel,
  closing: ReadonlySet<string>,
  uiLang: 'en' | undefined,
): IndexGroup[] {
  const grouped = new Set<string>();
  const groups: IndexGroup[] = [];
  for (const destination of model.primary) {
    for (const section of destination.sections) grouped.add(section.id);
    const listed = destination.sections.filter((section) => !closing.has(section.id));
    if (listed.length === 0) continue;
    const lands = listed.some(({ href }) => href === destination.href);
    const head = {
      ...destinationEntry(destination),
      href: lands ? destination.href : listed[0]!.href!,
    };
    // The head already reaches its own section, so the entries leave it out.
    const entries =
      listed.length > 1
        ? listed
            .map(entryOf)
            .filter(present)
            .filter(({ href }) => href !== head.href)
        : [];
    groups.push({ head, entries });
  }
  const rest = model.index
    .filter((section) => !grouped.has(section.id) && !closing.has(section.id))
    .map(entryOf)
    .filter(present);
  if (rest.length === 1) {
    // One such section is its own head, in the owner's words: "More" names a group, not one place.
    groups.push({ head: { ...rest[0]!, key: 'more' }, entries: [] });
  } else if (rest.length > 1) {
    // More links its first section, so that one isn't listed again under it.
    groups.push({
      head: { key: 'more', text: 'More', href: rest[0]!.href, ...(uiLang ? { lang: uiLang } : {}) },
      entries: rest.slice(1),
      first: rest[0]!,
    });
  }
  return groups;
}

/**
 * The index as the Menu shows it, under the destinations it already lists:
 * a group that's a destination's link alone goes, since the Menu's own
 * links reach it, and a More left alone is its sections under their own
 * titles. Nothing when nothing's left.
 */
function menuGroups(model: NavigationModel, groups: readonly IndexGroup[]): IndexGroup[] {
  const reached = new Set(model.primary.map(({ href }) => href));
  const left = groups.filter(({ head, entries }) => entries.length > 0 || !reached.has(head.href));
  const [only] = left;
  if (left.length === 1 && only!.first !== undefined) {
    return [only!.first, ...only!.entries].map((entry) => ({ head: entry, entries: [] }));
  }
  return left;
}

/** A case study's short index: the destinations, then every work with its own page. */
function shortIndexGroups(model: NavigationModel, uiLang: 'en' | undefined): IndexGroup[] {
  const groups: IndexGroup[] = model.primary.map((destination) => ({
    head: destinationEntry(destination),
    entries: [],
  }));
  const works = model.works.filter((work) => !work.current);
  if (works.length > 0) {
    groups.push({
      head: {
        key: 'works',
        text: 'All work',
        href: model.primary.find(({ id }) => id === 'work')?.href ?? works[0]!.href,
        ...(uiLang ? { lang: uiLang } : {}),
      },
      entries: works.map((work) => ({
        key: work.id,
        text: work.title,
        href: work.href,
        ...(work.lang !== undefined ? { lang: work.lang } : {}),
      })),
    });
  }
  return groups;
}

/**
 * The grouped index: each head a link, its entries a quieter list under it.
 * Heads with no entries at all, as on a case study with no other works, are
 * a run of plain links at the body's size instead of labels over nothing.
 */
function IndexList({ groups }: { readonly groups: readonly IndexGroup[] }) {
  const flat = groups.every(({ entries }) => entries.length === 0);
  return (
    <ul className={flat ? 'fc-index__groups fc-index__groups--flat' : 'fc-index__groups'}>
      {groups.map(({ head, entries }) => (
        // A flat run's items are links in a row, not groups spaced down a column.
        <li key={head.key} className={flat ? undefined : 'fc-index__group'}>
          <a
            className="fc-index__head"
            href={head.href}
            lang={head.lang}
            data-type-role={flat ? undefined : 'label'}
          >
            {head.text}
          </a>
          {entries.length > 0 ? (
            <ul className="fc-index__links">
              {entries.map((entry) => (
                <li key={entry.key}>
                  <a href={entry.href} lang={entry.lang} dir={entry.dir}>
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The ids the chrome and the index take. Two hyphens: no content id has them, so none can take these. */
function chromeIds(prefix: string) {
  return {
    site: `${prefix}fc--site`,
    index: `${prefix}fc--index`,
    indexTitle: `${prefix}fc--index-title`,
  };
}

/** The Menu's content: the destinations as large links, then every section behind one disclosure. */
function MenuContent({
  model,
  groups,
  current,
  uiLang,
}: {
  readonly model: NavigationModel;
  readonly groups: readonly IndexGroup[];
  readonly current: Destination['id'] | undefined;
  readonly uiLang: 'en' | undefined;
}) {
  const sections = menuGroups(model, groups);
  return (
    <>
      <ul className="fc-menu__destinations">
        {model.primary.map((destination) => (
          <li key={destination.id}>
            <a
              href={destination.href}
              lang={destination.lang}
              data-type-role="title"
              aria-current={destination.id === current ? 'page' : undefined}
            >
              {destination.label}
            </a>
          </li>
        ))}
      </ul>
      {sections.length > 0 ? (
        // #19's disclosure slots, written out: a native details element, open
        // with no script, with the primitive's chevron saying whether it's open.
        <details className="fc-menu__all" data-ui-slot="disclosure" data-marker="chevron">
          <summary data-ui-slot="disclosure.summary" lang={uiLang}>
            All sections
          </summary>
          <div data-ui-slot="disclosure.content">
            <IndexList groups={sections} />
          </div>
        </details>
      ) : null}
    </>
  );
}

/** The persistent chrome: the name, the destinations, and on a narrow screen a Menu. */
function Header({
  input,
  model,
  groups,
  current,
  uiLang,
}: {
  readonly input: VariantRenderInput;
  readonly model: NavigationModel;
  readonly groups: readonly IndexGroup[];
  readonly current: Destination['id'] | undefined;
  readonly uiLang: 'en' | undefined;
}) {
  const ids = chromeIds(input.ids.prefix);
  return (
    <header className="fc-header">
      {/*
       * #19's navigation primitive's markup, its slots, which the platform
       * stylesheet styles and sizes: each link a target of 24 by 24 CSS px,
       * and 32 by 32 at 768 px wide and below. Written out rather than
       * through <Navigation>, a client component.
       */}
      <nav
        className="fc-nav"
        data-ui-slot="navigation"
        data-orientation="horizontal"
        aria-labelledby={ids.site}
      >
        <span id={ids.site} lang={uiLang} hidden>
          Site
        </span>
        <a className="fc-home" href={model.name.href}>
          {model.name.label}
        </a>
        {model.primary.length > 0 ? (
          <ul className="fc-destinations" data-ui-slot="navigation.list">
            {model.primary.map((destination) => (
              <li key={destination.id} data-ui-slot="navigation.item">
                <a
                  data-ui-slot="navigation.link"
                  href={destination.href}
                  lang={destination.lang}
                  aria-current={destination.id === current ? 'page' : undefined}
                >
                  {destination.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {model.primary.length > 0 || groups.length > 0 ? (
          <div className="fc-menu">
            <NavigationMenuSlot
              id={menuId(input.portfolio)}
              label="Menu"
              {...(uiLang ? { lang: uiLang } : {})}
              // The index when there is one, else the first destination: a place that's on the page.
              href={groups.length > 0 ? `#${ids.index}` : model.primary[0]!.href}
              visitorControl={{ media: NARROW }}
            >
              <MenuContent model={model} groups={groups} current={current} uiLang={uiLang} />
            </NavigationMenuSlot>
          </div>
        ) : null}
      </nav>
      <VisitorControlSlot />
    </header>
  );
}

/** The index, as navigation: the page's back matter, before the closing block. */
function Index({
  input,
  groups,
  uiLang,
}: {
  readonly input: VariantRenderInput;
  readonly groups: readonly IndexGroup[];
  readonly uiLang: 'en' | undefined;
}) {
  if (groups.length === 0) return null;
  const ids = chromeIds(input.ids.prefix);
  return (
    <nav id={ids.index} className="fc-index" aria-labelledby={ids.indexTitle}>
      <h2 id={ids.indexTitle} className="fc-index__title" lang={uiLang}>
        Index
      </h2>
      <IndexList groups={groups} />
    </nav>
  );
}

/** The raw links a footerOutline() list kept, in order: it keeps a subsequence of them, each target once. */
function keptLinks(
  raw: readonly Link[],
  listed: readonly FooterLink[],
  input: VariantRenderInput,
): Link[] {
  let at = 0;
  return raw.filter((link) => {
    if (listed[at]?.href !== hrefFor(link.url, input)) return false;
    at += 1;
    return true;
  });
}

/** Whether the owner wrote something there. */
const said = (text: string | undefined): text is string => text !== undefined && text.trim() !== '';

/**
 * The owner's passages as one, each on one line however its source wraps,
 * since the message shows only the line breaks this composition puts in.
 */
const joined = (...texts: readonly (string | undefined)[]) =>
  texts
    .filter(said)
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .join(' ') || undefined;

/**
 * The page's one closing block, every part through the kit's shared
 * renderers, each section in its own frame so both anchors land:
 * - the contact section's frame holds it all;
 * - inside, the call to action's frame leads, under one heading, the
 *   contact's title or else the call to action's, and one message, opening
 *   on the call to action's title when the heading didn't take it, then its
 *   description with the contact's message folded in; then its actions, the
 *   primary one set apart, with the email address beside them as text when
 *   an action mails it;
 * - then every other way to get in touch, quieter, each place once, as
 *   footerOutline() lists them: no link to where an action already goes.
 * A call to action in another language than the contact keeps its own
 * heading and message, a level down, after the contact's.
 */
function closingBlock(
  input: VariantRenderInput,
  footer: FooterOutline,
  contact: SectionOf<'contact'>,
  cta: SectionOf<'cta'> | undefined,
): ReactElement | null {
  const { portfolio } = input;
  // An action mails the address when it reaches it, a subject it presets or not.
  const mailed =
    footer.email !== undefined &&
    [footer.cta?.primary, footer.cta?.secondary].some(
      (action) => action !== undefined && sameTarget(action.href, footer.email!.href),
    );
  // The ways the contact lists, as its shared renderer picks them, less what the block already reaches.
  const ways = portfolio.contact?.links?.length
    ? keptLinks(portfolio.contact.links, footer.contact?.links ?? [], input)
    : keptLinks(portfolio.links, footer.links, input);
  const merged = cta !== undefined && cta.lang === contact.lang;
  const reach: VariantRenderInput = {
    ...input,
    portfolio: {
      ...portfolio,
      identity: mailed ? { ...portfolio.identity, email: undefined } : portfolio.identity,
      links: [],
      contact: {
        ...portfolio.contact,
        message: merged ? undefined : portfolio.contact?.message,
        links: ways,
      },
    },
  };
  const address = mailed ? <p className="fc-closing__address">{footer.email!.text}</p> : null;
  // The contact's title is the one heading, the words the hero's link and
  // the Contact destination promise; the call to action's title opens the
  // message as its first line, so every title the owner wrote shows and
  // none is a second heading.
  const opening = cta
    ? [
        said(contact.title) ? cta.title : undefined,
        said(contact.subtitle) ? cta.subtitle : undefined,
      ].filter(said)
    : [];
  const ask = cta
    ? renderSection(
        merged
          ? {
              ...cta,
              title: said(contact.title) ? contact.title : cta.title,
              subtitle: said(contact.subtitle) ? contact.subtitle : cta.subtitle,
              // The one line break the message shows: after the opening title.
              description:
                [
                  ...opening.map((text) => joined(text)),
                  joined(cta.description, portfolio.contact?.message),
                ]
                  .filter(said)
                  .join('\n') || undefined,
            }
          : cta,
        input,
        {
          renderers: {},
          Frame: ({ frame, children }) => (
            <section {...frame} className="fc-closing__ask">
              {children}
              {address}
            </section>
          ),
        },
        { level: merged ? 2 : 3 },
      )
    : null;
  const closing: SectionComposition = {
    renderers: {},
    Frame: ({ frame, children }) => (
      <section {...frame} className="fc-closing">
        {merged ? ask : null}
        {children}
        {merged ? null : ask}
      </section>
    ),
  };
  return renderSection(
    merged ? { ...contact, title: undefined, subtitle: undefined } : contact,
    reach,
    closing,
    { level: 2 },
  );
}

/** The navigation every page of the fallback draws, from the home page's outline. */
function chrome(input: VariantRenderInput) {
  const model = navigationModel(pageOutline(input, SHARED_SECTIONS));
  // The host's own words are English, marked so in a portfolio in another language.
  const uiLang = /^en(?:-|$)/i.test(input.portfolio.locale) ? undefined : ('en' as const);
  return { model, uiLang };
}

/** A work's own page: its case study, the page's one h1, and the chrome that leads home. */
function WorkPage({
  input,
  work,
}: {
  readonly input: VariantRenderInput;
  readonly work: RoutedWork;
}) {
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: undefined }, 1);
  const { model, uiLang } = chrome(input);
  const groups = shortIndexGroups(model, uiLang);
  return (
    <>
      <Header input={input} model={model} groups={groups} current="work" uiLang={uiLang} />
      <main id={input.ids.main} className="fc-main" tabIndex={-1}>
        <CaseStudy work={work} ctx={ctx} level={1} />
      </main>
      <footer className="fc-footer">
        <Index input={input} groups={groups} uiLang={uiLang} />
      </footer>
    </>
  );
}

export default function FallbackComposition({ input }: { readonly input: VariantRenderInput }) {
  const work = routedWork(input);
  if (work) return <WorkPage input={input} work={work} />;
  const { portfolio, ids } = input;
  const footer = footerOutline(input, SHARED_SECTIONS);
  // The closing block: the contact section that renders, and the call to action merged into it.
  const contact = portfolio.sections.find(
    (section): section is SectionOf<'contact'> =>
      section.kind === 'contact' && renderSection(section, input, SHARED_SECTIONS) !== null,
  );
  const cta = contact
    ? portfolio.sections.find(
        (section): section is SectionOf<'cta'> =>
          section.kind === 'cta' && section.id === footer.cta?.id,
      )
    : undefined;
  const closing = new Set([contact?.id, cta?.id].filter((id): id is string => id !== undefined));
  // The page's one h1 comes before any section's h2: a hero that renders
  // first carries it, and otherwise the identity's name does, above the
  // sections, every hero among them at h2.
  let heroLeads = false;
  let rendered = false;
  // The main is the kit's stack: each section a chapter, a section, or a
  // group apart, by its kind and the one before it (sectionRhythms()). With
  // no hero first, the name's h1 opens the page, and the first section
  // follows it a group apart, as a section follows a hero. The closing
  // block's sections are the footer's, so they don't count.
  const shown = portfolio.sections.filter(
    (section) => !closing.has(section.id) && sectionRenders(section, input),
  );
  const rhythms = new Map(sectionRhythms(shown));
  if (shown[0] !== undefined && shown[0].kind !== 'hero') rhythms.set(shown[0].id, 'group');
  const composition: SectionComposition = { renderers: {}, Frame: rhythmFrame(rhythms) };
  const sections: { section: Section; element: ReactElement }[] = [];
  for (const section of portfolio.sections) {
    if (closing.has(section.id)) continue;
    const leads = !rendered && section.kind === 'hero';
    const element = renderSection(section, input, composition, { level: leads ? 1 : 2 });
    if (element === null) continue;
    heroLeads ||= leads;
    rendered = true;
    sections.push({ section, element });
  }
  const { model, uiLang } = chrome(input);
  const groups = indexGroups(model, closing, uiLang);
  return (
    <>
      <Header input={input} model={model} groups={groups} current={undefined} uiLang={uiLang} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="fc-main pf-stack pf-stats--leaders" tabIndex={-1}>
        {heroLeads ? null : <h1 className="fc-name">{portfolio.identity.name}</h1>}
        {sections.map(({ element }) => element)}
      </main>
      {groups.length > 0 || contact ? (
        <footer className="fc-footer">
          <Index input={input} groups={groups} uiLang={uiLang} />
          {contact ? closingBlock(input, footer, contact, cta) : null}
        </footer>
      ) : null}
    </>
  );
}
