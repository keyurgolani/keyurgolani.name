import type { CSSProperties, ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  evidenceOf,
  footerOutline,
  LabeledDate,
  present,
  renderContext,
  renderSection,
  VisitorControlSlot,
  type HomePageProps,
  type OutlineSection,
  type RenderContext,
  type SectionComposition,
} from '@portfolio/kit/sections';
import { Dock, type DockStop } from './dock';
import { ClosingFrame, OpeningFrame, ringFrame } from './frames';
import { CLOSING_PLATE_ROW, MAP_HEIGHT, MAP_WIDTH, orbitGeometry, PLATE_ROWS } from './geometry';
import {
  countLabel,
  countOf,
  cosmosModel,
  ringIntro,
  ringLegend,
  type CosmosModel,
  type Ring,
} from './model';
import { Orrery } from './orrery';
import { RENDERERS } from './renderers';
import { OrbitStage, StageMotionControl } from './stage';
import { IndexClose, IndexLink, IndexTrigger } from './system-index';
import { RovingPlates } from './system-nav';

// Kinetic Cosmos's home page (redesign, stream E): the portfolio as an
// orrery. One inset stage opens it: the name and an Index in its top row,
// the system of four rings drawn as an orrery, with a plate of real links
// for each ring wired to its body by a leader, the thesis as the headline,
// and a band with what the owner is doing now and the pause for the
// orbits. Each ring follows as a chapter that opens on its own orbit line,
// which carries the ring's section links, and each section in it opens on
// an orbit rule. A closing stage bookends the opening with the ways out, a
// dock low on the screen says which ring you're in, and the Index lists
// every section on its ring. Every word is the owner's, a count of the
// owner's records, or one of a few fixed English labels, marked so in a
// portfolio that isn't English.

/** Kinds that sit half a ring wide beside a neighbour of the same sort. */
function compact(section: Section, input: HomePageProps['input']): boolean {
  switch (section.kind) {
    case 'lede':
    case 'now':
    case 'focus':
      return true;
    case 'practice':
      return section.part === 'skills' || section.part === 'tools';
    case 'evidence': {
      const types = evidenceOf(section, input).map((entry) => entry.type);
      return (
        types.length > 0 &&
        (types.every((type) => type === 'metric') ||
          types.every((type) => type === 'award') ||
          types.every((type) => type === 'patent'))
      );
    }
    default:
      return false;
  }
}

/**
 * Each ring section's width: two compact neighbours pair up, half each; everything else is
 * full. A section closed on home is one rule and never pairs (KIN-4), so closed rows run as
 * one even list and an open one never sits beside a lone rule.
 */
function spansOf(
  sections: readonly OutlineSection[],
  byId: ReadonlyMap<string, Section>,
  input: HomePageProps['input'],
  closed: ReadonlySet<string> = new Set(),
): Map<string, 'half' | 'full'> {
  const spans = new Map<string, 'half' | 'full'>();
  const pairs = (section: Section) => compact(section, input) && !closed.has(section.id);
  for (let index = 0; index < sections.length; index++) {
    const here = byId.get(sections[index]!.id)!;
    const next = sections[index + 1] ? byId.get(sections[index + 1]!.id) : undefined;
    if (pairs(here) && next && pairs(next)) {
      spans.set(here.id, 'half');
      spans.set(next.id, 'half');
      index++;
    } else spans.set(here.id, 'full');
  }
  return spans;
}

/**
 * Whether a section folds into a disclosure on a phone (KC-S6): the long,
 * low-traffic parts of a résumé, skills, tools, awards, patents, and
 * studies, so the phone page doesn't run to thirty screens.
 */
function folds(section: Section, input: HomePageProps['input']): boolean {
  switch (section.kind) {
    case 'practice':
      return section.part === 'skills' || section.part === 'tools';
    case 'fun-facts':
      return true;
    case 'chronology': {
      const entries = chronologyOf(section, input);
      return entries.length > 0 && entries.every((entry) => entry.kind === 'study');
    }
    case 'evidence': {
      const types = evidenceOf(section, input).map((entry) => entry.type);
      // The record's long lists, and on a phone the papers and press (KC-S6); the words of
      // others lead with one quotation at every width instead (item 8).
      return (
        types.length > 0 &&
        types.every((type) => ['award', 'patent', 'press', 'publication'].includes(type))
      );
    }
    default:
      return false;
  }
}

/**
 * The home outline (Design gate item 8, KIN-4): the Record ring carries one
 * summary, its opening sections up to the first that isn't compact (the
 * About and the figures beside it), and the rest of the record, the roles
 * and the words of others too, sits in closed disclosures, one orbit, each
 * opening on a tap or when a link names it. Personal folds everything past
 * its first section, its Now, the focus list that repeats the Now too. The
 * other rings close their record-like tails.
 */
function closedInRing(
  ring: Ring,
  byId: ReadonlyMap<string, Section>,
  input: HomePageProps['input'],
): Set<string> {
  const titled = (entry: OutlineSection) => present(entry.title);
  if (ring.key !== 'record' && ring.key !== 'personal') {
    // Every other ring closes its own record-like tail: the repositories, the talks, papers
    // and press, and the work kept elsewhere.
    return new Set(
      ring.sections
        .filter((entry) => titled(entry) && isTail(byId.get(entry.id)!, input))
        .map(({ id }) => id),
    );
  }
  // Personal's summary is its first section, its Now; the focus list beside it repeats it, so it folds.
  const first = ring.sections.findIndex((entry) => !compact(byId.get(entry.id)!, input));
  const summary =
    ring.key === 'personal' ? 1 : first < 0 ? ring.sections.length : Math.max(first, 1);
  return new Set(
    ring.sections
      .slice(summary)
      .filter(titled)
      .map(({ id }) => id),
  );
}

/** A ring's record-like tail, which closes on home: repositories, talks, papers, press, and work elsewhere. */
function isTail(section: Section, input: HomePageProps['input']): boolean {
  if (section.kind === 'github') return true;
  if (section.kind !== 'evidence') return false;
  const types = evidenceOf(section, input).map((entry) => entry.type);
  return (
    types.length > 0 &&
    types.every((type) => ['talk', 'publication', 'press', 'external-work'].includes(type))
  );
}

/** What a section's orbit rule shows beside its title: when a now was true, else its count. */
function noteOf(section: Section, input: HomePageProps['input'], ctx: RenderContext): ReactNode {
  if (section.kind === 'now' && section.asOf !== undefined) {
    return <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />;
  }
  const count = countLabel(section, input, ctx);
  if (section.kind === 'chronology' && count !== undefined) {
    // A chronology on more than one thread says so: "4 entries on 3 threads".
    const threads = new Set(
      chronologyOf(section, input).flatMap((entry) =>
        present(entry.thread) ? [entry.thread] : [],
      ),
    );
    if (threads.size > 1) return `${count} on ${threads.size} threads`;
  }
  return count;
}

/** The orbit line a ring opens on, with its sections' links riding it, in two tiers when crowded. */
function OrbitLine({ ring, titleId }: { ring: Ring; titleId: string }) {
  const linked = ring.sections.filter(
    (section) => section.href !== undefined && present(section.title),
  );
  const tiers = linked.length > 5;
  return (
    <div className="kc-arc" data-ring={ring.position - 1} data-tiers={tiers ? '' : undefined}>
      <svg
        className="kc-arc__line"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0 100 Q500 -100 1000 100" />
      </svg>
      <span className="kc-arc__trail" aria-hidden="true" />
      <span className="kc-arc__body" aria-hidden="true" />
      {linked.length > 0 ? (
        <nav className="kc-arc__index" aria-labelledby={titleId}>
          <ol role="list">
            {linked.map((section, index) => {
              // Spread from 30% to 88% of the line; the line's height there follows its curve.
              const at = linked.length === 1 ? 0.5 : 0.3 + (0.58 * index) / (linked.length - 1);
              const rise = 1 - Math.pow((at - 0.5) / 0.5, 2);
              return (
                <li
                  key={section.id}
                  className="kc-arc__stop"
                  data-tier={tiers ? index % 2 : undefined}
                  style={
                    {
                      '--layout-at': at.toFixed(3),
                      '--layout-rise': rise.toFixed(3),
                    } as CSSProperties
                  }
                >
                  <a href={section.href} lang={section.lang}>
                    {section.title}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
    </div>
  );
}

function RingChapter({
  ring,
  children,
  summary,
  uiLang,
}: {
  ring: Ring;
  children: ReactNode;
  summary?: string;
  uiLang?: string;
}) {
  const titleId = `${ring.anchor}--title`;
  return (
    <section className="kc-ring" id={ring.anchor} data-ring={ring.key} aria-labelledby={titleId}>
      {/* The ring opens on an inverse band, its arc and its title: one device a ring keeps at any blur. */}
      <div className="kc-ring__opener" data-ui-surface="inverse">
        <OrbitLine ring={ring} titleId={titleId} />
        <div className="kc-ring__head">
          <h2 id={titleId} className="kc-ring__title" lang={ring.lang}>
            {ring.label}
          </h2>
          {summary !== undefined ? (
            <p className="kc-ring__intro" lang={uiLang}>
              {summary}
            </p>
          ) : null}
        </div>
      </div>
      <div className="kc-ring__body">{children}</div>
    </section>
  );
}

/**
 * The system's plates: a real link for each ring, set where its leader starts,
 * and one for the closing's Contact under them, the dock's own `#contact`, so
 * the way to Contact shows on arrival while the dock is out of sight. It has
 * no ring, so it lights no leader.
 */
function Plates({
  model,
  summaries,
  caption,
  contact,
  uiLang,
}: {
  model: CosmosModel;
  summaries: ReadonlyMap<string, string | undefined>;
  caption?: { text: string; lang: string };
  contact?: { href?: string };
  uiLang?: string;
}) {
  if (model.rings.length === 0) return null;
  return (
    <nav className="kc-plates" aria-label="System" lang={uiLang}>
      {/* The hero's tagline is the legend's caption: it names what the rings hold. A phone shows it in the band instead. */}
      {caption !== undefined ? (
        <p className="kc-plates__caption" lang={caption.lang}>
          {caption.text}
        </p>
      ) : null}
      <RovingPlates className="kc-plates__list">
        {model.rings.map((ring, index) => (
          <li
            key={ring.key}
            className="kc-plate"
            data-ring={index}
            style={{ '--layout-row': ((PLATE_ROWS[index] ?? 0) * 100).toFixed(2) } as CSSProperties}
          >
            <a className="kc-plate__link" href={ring.href}>
              <span className="kc-plate__mark" aria-hidden="true" data-ring={index} />
              <span className="kc-plate__name" lang={ring.lang}>
                {ring.label}
              </span>
              {summaries.get(ring.key) ? (
                <span className="kc-plate__summary" lang={uiLang}>
                  {summaries.get(ring.key)}
                </span>
              ) : null}
            </a>
          </li>
        ))}
        {contact?.href ? (
          <li
            className="kc-plate kc-plate--closing"
            style={{ '--layout-row': (CLOSING_PLATE_ROW * 100).toFixed(2) } as CSSProperties}
          >
            <a className="kc-plate__link" href={contact.href}>
              <span className="kc-plate__mark" aria-hidden="true" />
              <span className="kc-plate__name" lang={uiLang}>
                Contact
              </span>
            </a>
          </li>
        ) : null}
      </RovingPlates>
    </nav>
  );
}

/**
 * The signature work's plate, hung above the innermost ring's body, a link
 * to the work where the Work ring shows it. None without a signature work
 * on the page.
 */
function SignatureLabel({
  input,
  counts,
}: {
  input: HomePageProps['input'];
  counts: readonly number[];
}) {
  const id = input.portfolio.signature;
  const work = id ? input.portfolio.works.find((each) => each.id === id) : undefined;
  const orbit = orbitGeometry(counts)[0];
  if (!work || !orbit || !anchorSection(work, input)) return null;
  return (
    <a
      className="kc-signature-label"
      href={`#${input.ids.prefix}${work.id}`}
      lang={work.lang}
      style={
        {
          '--layout-x': (orbit.anchor.x / MAP_WIDTH).toFixed(4),
          '--layout-y': (orbit.anchor.y / MAP_HEIGHT).toFixed(4),
        } as CSSProperties
      }
    >
      <span className="kc-signature-label__ground" aria-hidden="true" />
      {work.title}
    </a>
  );
}

/** The index's orrery, in its own units: wide and flat, one ring a group, its sections bodies on it. */
const INDEX_WIDTH = 1300;
const INDEX_HEIGHT = 200;

/** A ring of the index's orrery: its radii, and where its i-th of n bodies sits, as fractions of the drawing. */
function indexRing(position: number) {
  const rx = 140 + position * 140;
  const ry = 10 + rx * 0.15;
  const cx = INDEX_WIDTH / 2;
  const cy = INDEX_HEIGHT / 2;
  return {
    rx,
    ry,
    /** The ring's name sits just outside its left end. */
    name: { x: (cx - rx - 12) / INDEX_WIDTH, y: cy / INDEX_HEIGHT },
    body(index: number, count: number) {
      const angle = ((200 + position * 37 + (index * 360) / Math.max(count, 1)) * Math.PI) / 180;
      return {
        x: (cx + rx * Math.cos(angle)) / INDEX_WIDTH,
        y: (cy + ry * Math.sin(angle)) / INDEX_HEIGHT,
      };
    },
  };
}

/**
 * The index: the system drawn as an orrery, one body a section on its
 * ring, a ring that follows the section in focus, and a readout of it; and
 * under it every section listed by ring, then the way out. An opening
 * section the owner titles is listed with the ring its kind belongs to.
 */
export function SystemIndex({
  id,
  model,
  closing,
  input,
  ctx,
  uiLang,
}: {
  id: string;
  model: CosmosModel;
  closing: readonly OutlineSection[];
  input: HomePageProps['input'];
  ctx: RenderContext;
  uiLang?: string;
}) {
  const titleId = `${id}--title`;
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  // The same count as the section's own rule, so the index and the page agree.
  const countFor = (entry: OutlineSection): number => {
    const section = byId.get(entry.id);
    return section ? (countOf(section, input)?.count ?? 0) : 0;
  };
  const titled = (sections: readonly OutlineSection[]) =>
    sections.filter((section) => section.href !== undefined && present(section.title));
  // The opening's sections are the stage's parts, which have no box of their
  // own, so their entries take you to the main region, the stage at its
  // head, which takes focus (code review M2).
  const openingIn = (key: string) =>
    titled(model.opening)
      .filter((entry) => {
        const kind = byId.get(entry.id)?.kind;
        return key === (kind === 'practice' ? 'record' : 'work');
      })
      .map((entry) => ({ ...entry, href: `#${input.ids.main}` }));
  const groups = [
    ...model.rings.map((ring) => ({
      key: ring.key,
      label: ring.label,
      lang: ring.lang,
      sections: [...openingIn(ring.key), ...titled(ring.sections)],
    })),
    ...(closing.length > 0
      ? [{ key: 'contact', label: 'Contact', lang: uiLang, sections: titled(closing) }]
      : []),
  ];
  const drawn = groups.slice(0, 4);
  const total = groups.reduce((sum, group) => sum + group.sections.length, 0);
  return (
    <dialog id={id} className="kc-index" data-ui-surface="inverse" aria-labelledby={titleId}>
      <div className="kc-index__head">
        <h2 id={titleId} className="kc-index__title" lang={uiLang}>
          The system
        </h2>
        <p className="kc-index__lede" lang={uiLang}>
          Every section of the page, placed on the ring it belongs to.
        </p>
        <IndexClose target={id} className="kc-index__close">
          <span lang={uiLang}>Close</span>
          <kbd className="kc-index__key" lang={uiLang}>
            Esc
          </kbd>
        </IndexClose>
      </div>
      <div className="kc-index__system" aria-hidden="true">
        <svg
          className="kc-index__orrery"
          viewBox={`0 0 ${INDEX_WIDTH} ${INDEX_HEIGHT}`}
          focusable="false"
        >
          {drawn.map((group, position) => {
            const ring = indexRing(position);
            return (
              <g key={group.key}>
                <ellipse
                  cx={INDEX_WIDTH / 2}
                  cy={INDEX_HEIGHT / 2}
                  rx={ring.rx}
                  ry={ring.ry}
                  className="kc-index__orbit"
                />
                {group.sections.map((section, index) => {
                  const at = ring.body(index, group.sections.length);
                  return (
                    <circle
                      key={section.id}
                      className="kc-index__body"
                      cx={(at.x * INDEX_WIDTH).toFixed(1)}
                      cy={(at.y * INDEX_HEIGHT).toFixed(1)}
                      r="5"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        <span className="kc-index__core" />
        {drawn.map((group, position) => {
          const { name } = indexRing(position);
          return (
            <span
              key={group.key}
              className="kc-index__ring-name"
              lang={group.lang}
              style={
                {
                  '--layout-x': name.x.toFixed(4),
                  '--layout-y': name.y.toFixed(4),
                } as CSSProperties
              }
            >
              {group.label}
            </span>
          );
        })}
        <span className="kc-index__focus" />
      </div>
      <div className="kc-index__groups" data-count={groups.length}>
        {groups.map((group, position) => (
          <div key={group.key} className="kc-index__group">
            <h3 className="kc-index__ring" lang={group.lang}>
              <span className="kc-index__ring-mark" aria-hidden="true" />
              {group.label}
            </h3>
            <ol className="kc-index__list" role="list">
              {group.sections.map((section, index) => {
                const at =
                  position < 4 ? indexRing(position).body(index, group.sections.length) : undefined;
                const count = byId.get(section.id)
                  ? countLabel(byId.get(section.id)!, input, ctx)
                  : undefined;
                return (
                  <li key={section.id} className="kc-index__entry">
                    <IndexLink
                      href={section.href!}
                      lang={section.lang}
                      className="kc-index__link"
                      at={at}
                      readout={
                        count
                          ? `${section.title}: ${count}, in ${group.label}`
                          : `${section.title}, in ${group.label}`
                      }
                    >
                      {section.title}
                    </IndexLink>
                    {countFor(section) > 0 ? (
                      <span className="kc-index__count" data-type-role="label">
                        {countFor(section)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <div className="kc-index__foot" data-type-role="label">
        <p lang={uiLang}>
          {total} destinations on {model.rings.length} {model.rings.length === 1 ? 'ring' : 'rings'}
          , plus the way out. Escape closes it and returns you to where you were.
        </p>
        <p className="kc-index__readout" aria-live="polite" />
      </div>
    </dialog>
  );
}

/**
 * The masthead, on the stage's ground: the wordmark, which leads home, the
 * owner's tagline, the visitor's controls, and the Index, on home and on a
 * work's own page.
 */
export function Masthead({
  input,
  home,
  id,
  indexId,
  uiLang,
}: {
  input: HomePageProps['input'];
  home: string;
  id: string;
  indexId: string;
  uiLang?: string;
}) {
  const { identity } = input.portfolio;
  return (
    <header className="kc-masthead" id={id} data-ui-surface="inverse">
      <p className="kc-wordmark">
        <a className="kc-wordmark__link" href={home}>
          <span className="kc-wordmark__mark" aria-hidden="true" />
          <span className="kc-wordmark__name">{identity.name}</span>
        </a>
        {present(identity.tagline) ? (
          <span className="kc-wordmark__role">{identity.tagline}</span>
        ) : null}
      </p>
      <div className="kc-masthead__controls">
        <VisitorControlSlot />
        <IndexTrigger target={indexId} className="kc-index-trigger">
          <span className="kc-index-trigger__mark" aria-hidden="true" />
          <span lang={uiLang}>Index</span>
        </IndexTrigger>
      </div>
    </header>
  );
}

/** The colophon: the owner's name, where they are, what the orbits do, and the way back up. */
export function Colophon({
  input,
  topId,
  uiLang,
}: {
  input: HomePageProps['input'];
  topId: string;
  uiLang?: string;
}) {
  const footer = footerOutline(input);
  const { identity } = input.portfolio;
  return (
    <footer className="kc-colophon">
      <p className="kc-colophon__name">{footer.name}</p>
      {present(identity.location) ? (
        <p className="kc-colophon__place">{identity.location}</p>
      ) : null}
      <p className="kc-colophon__note" lang={uiLang}>
        The orbits pause when you leave the page.
      </p>
      <p className="kc-colophon__top">
        <a href={`#${topId}`} lang={uiLang}>
          Back to the core
        </a>
      </p>
    </footer>
  );
}

export const sectionsById = (input: HomePageProps['input']) =>
  new Map(input.portfolio.sections.map((section) => [section.id, section]));

export function HomePage({ input, outline }: HomePageProps) {
  const { portfolio, ids } = input;
  const model = cosmosModel(outline, input);
  const byId = sectionsById(input);
  const ctx = renderContext(input, { id: 'kc', title: undefined }, 2);
  const uiLang = ctx.uiLang;

  const thesis = model.opening.find((entry) => byId.get(entry.id)?.kind === 'practice');
  const hero = model.opening.find((entry) => byId.get(entry.id)?.kind === 'hero');
  const heroSection = hero ? byId.get(hero.id) : undefined;
  const descriptor =
    heroSection?.kind === 'hero' && present(heroSection.tagline) ? heroSection.tagline : undefined;

  const opening: SectionComposition = { renderers: RENDERERS, Frame: OpeningFrame };
  const closing: SectionComposition = { renderers: RENDERERS, Frame: ClosingFrame };
  // The thesis carries the page's h1 when there is one; otherwise the hero does.
  const thesisPart = thesis
    ? renderSection(byId.get(thesis.id)!, input, opening, { level: 1 })
    : null;
  const heroPart = heroSection
    ? renderSection(heroSection, input, opening, { level: thesisPart ? 2 : 1 })
    : null;
  const hasH1 = thesisPart !== null || heroPart !== null;

  const summaries = new Map(model.rings.map((ring) => [ring.key, ringLegend(ring, input, ctx)]));
  const indexId = `${ids.prefix}kc--index`;
  const topId = `${ids.prefix}kc--top`;
  const stageId = `${ids.prefix}kc--stage`;
  const counts = model.rings.map((ring) => ring.sections.length);

  const closingParts = model.closing.map((entry, index) =>
    renderSection(byId.get(entry.id)!, input, closing, { level: index === 0 ? 2 : 3 }),
  );
  const contactEntry = model.closing[0];
  const stops: DockStop[] = [
    ...model.rings.map((ring) => ({
      key: ring.key,
      label: ring.label,
      ...(ring.lang ? { lang: ring.lang } : {}),
      href: ring.href,
      anchor: ring.anchor,
    })),
    ...(contactEntry?.href && contactEntry.anchor
      ? [
          {
            key: 'contact',
            label: 'Contact',
            ...(uiLang ? { lang: uiLang } : {}),
            href: contactEntry.href,
            anchor: contactEntry.anchor,
          },
        ]
      : []),
  ];

  return (
    <>
      <Masthead input={input} home={outline.home} id={topId} indexId={indexId} uiLang={uiLang} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="kc-main" tabIndex={-1}>
        <OrbitStage className="kc-opening" id={stageId}>
          <div className="kc-map">
            <div className="kc-map__clip">
              <Orrery counts={counts} seed={input.env.seed} />
            </div>
            <Plates
              model={model}
              summaries={summaries}
              caption={
                descriptor !== undefined
                  ? { text: descriptor, lang: heroSection?.lang ?? portfolio.locale }
                  : undefined
              }
              contact={contactEntry}
              uiLang={uiLang}
            />
            <SignatureLabel input={input} counts={counts} />
          </div>
          {hasH1 ? null : <h1 className="kc-thesis kc-thesis--name">{portfolio.identity.name}</h1>}
          {thesisPart}
          {heroPart}
          {descriptor !== undefined ? (
            <p className="kc-band__tagline" lang={heroSection?.lang}>
              {descriptor}
            </p>
          ) : null}
          <span className="kc-band" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((mark) => (
              <span key={mark} className="kc-band__mark" />
            ))}
          </span>
          <StageMotionControl policy={input.presentation.motionPolicy} lang={uiLang} />
        </OrbitStage>
        <div className="kc-orbitals">
          {model.rings.map((ring) => {
            const closed = closedInRing(ring, byId, input);
            const data = {
              notes: new Map(
                ring.sections.map((entry) => [entry.id, noteOf(byId.get(entry.id)!, input, ctx)]),
              ),
              spans: spansOf(ring.sections, byId, input, closed),
              folds: new Set(
                ring.sections
                  .filter((entry) => folds(byId.get(entry.id)!, input))
                  .map(({ id }) => id),
              ),
              closed,
            };
            const composition: SectionComposition = {
              renderers: RENDERERS,
              Frame: ringFrame(data),
            };
            return (
              <RingChapter
                key={ring.key}
                ring={ring}
                summary={ringIntro(ring, input, ctx)}
                uiLang={uiLang}
              >
                {ring.sections.map((entry) =>
                  renderSection(byId.get(entry.id)!, input, composition, { level: 3 }),
                )}
              </RingChapter>
            );
          })}
          {closingParts.length > 0 ? (
            <div className="kc-closing" data-ui-surface="inverse">
              {closingParts}
            </div>
          ) : null}
          {stops.length > 0 ? (
            <Dock
              stops={stops}
              rings={model.rings.length}
              indexTarget={indexId}
              stageId={stageId}
              uiLang={uiLang}
            />
          ) : null}
        </div>
      </main>
      <Colophon input={input} topId={topId} uiLang={uiLang} />
      <SystemIndex
        id={indexId}
        model={model}
        closing={model.closing}
        input={input}
        ctx={ctx}
        uiLang={uiLang}
      />
    </>
  );
}
