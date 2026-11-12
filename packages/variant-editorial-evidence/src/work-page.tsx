import { Fragment, type ReactNode } from 'react';
import { Surface } from '@portfolio/appearance/primitives';
import type { Evidence, Work } from '@portfolio/schema';
import {
  DateText,
  evidenceByIds,
  formatFigure,
  formatNames,
  hrefFor,
  MaybeLink,
  PeriodText,
  placedMedia,
  present,
  renderContext,
  RichText,
  type CaseStudyPageProps,
  type CaseStudyPart,
  type RenderContext,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { workImages } from './figures';
import { Colophon } from './colophon';
import { Masthead } from './masthead';
import {
  archiveId,
  chapterOfWork,
  homeModel,
  isRoutedWork,
  placementOf,
  plateId,
  type HomeModel,
  type Placement,
} from './model';
import { Caption, Facts, Figure, homeRegion, joined, Words } from './parts';

// A work's own page, /work/<slug> (#13, P2): a feature article on the
// issue's grid. The running head carries the case's ancestry (chapter,
// section, title); the title is the page's one h1 at display size; the head
// column leads back to where the work shows on home, the lede sits on the
// standfirst step, the fact sheet in the margin, and the cover plate on the
// text column with its caption at its foot in the margin. Then the article,
// in the issue's own stops, never the outline's labels in its order:
//
//   The work      the description; the highlights in the margin; the
//                 work's other plates (Pl. 1a, 1b) breaking out across the
//                 text and the margin (EE-S9).
//   Background    the challenge and the context; the role and the
//                 constraints as margin callouts.
//   Decisions     numbered, each with what was considered instead beside it.
//   Results       the evidence and the outcomes; an award beside them; a
//                 cited quotation at headline size between rules.
//   In hindsight  the reflection, on the standfirst step.
//   Back matter   links, what cites it, and how to cite it.
//
// It closes on the next work in the selected run at headline size, and the
// colophon (C5). Every outline part keeps its anchor on what it holds. The
// host answers a slug with no case study with its 404.

/** A work's plate, Pl. n, or none: the curated run's order, the signature first. */
function plateOrder(model: HomeModel): readonly Work[] {
  return [model.lead, ...model.featured].filter((work): work is Work => work !== undefined);
}

/** Where the page leads back to on home, and how the head column names the case. */
interface Way {
  readonly back: string;
  readonly backLabel: string;
  /** The section the running head names between the chapter and the title. */
  readonly section?: ReactNode;
  readonly line?: string;
}

function wayBack(input: VariantRenderInput, model: HomeModel, work: Work): Way {
  const placement: Placement = placementOf(work, model);
  const selection = model.chapters
    .flatMap((chapter) => chapter.bands)
    .find(({ section }) => section.id === model.selection)?.section;
  const sectionHref = (id: string) => homeRegion(input, `${input.ids.prefix}${id}`);
  const titled = (section: { readonly title?: string; readonly lang?: string } | undefined) =>
    present(section?.title) ? <span lang={section.lang}>{section.title}</span> : undefined;
  switch (placement.kind) {
    case 'plate':
      return {
        back: selection
          ? sectionHref(selection.id)
          : homeRegion(input, plateId(input, { id: work.id })),
        backLabel: 'Back to selected work',
        section: titled(selection),
        line: `Case study, Pl. ${placement.number} of ${model.plates.size}`,
      };
    case 'archive':
      return {
        back: homeRegion(input, archiveId(input)),
        backLabel: 'Back to the archive',
        section: <Words input={input}>Archive</Words>,
        line: 'Case study, from the archive',
      };
    case 'section':
      return {
        back: sectionHref(work.id),
        backLabel: 'Back to work',
        section: titled(placement.section),
        line: 'Case study',
      };
    case 'none':
      return { back: routeHref(input, { route: 'home' }), backLabel: 'Back home' };
  }
}

/** A cardinal for a short count, as a sentence starts with it; the figure past ten. */
const COUNTS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** What a reference list calls a work's medium, when it has a usual name. */
const MEDIUM: Readonly<Record<string, string>> = {
  software: 'Software',
  system: 'System',
  interface: 'Interface',
  writing: 'Text',
  research: 'Research',
  photography: 'Photograph',
  'image-series': 'Photographs',
  music: 'Music',
  'audio-video': 'Audio and video',
  object: 'Object',
};

/** An address as a reference prints it: no scheme, no trailing slash. */
const bare = (url: string) => url.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');

/**
 * An address set to break only after its slashes: each part, its slash with
 * it, is one unit, so a slug never breaks at its hyphen. Each is the link's
 * own child, so it takes the link's underline in every state.
 */
function Breakable({ url }: { url: string }) {
  const parts = bare(url).split('/');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          <span className="ee-url__part">
            {part}
            {index < parts.length - 1 ? '/' : null}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/** The year a date or period starts, as written: the first four digits. */
const yearOf = (raw: string | undefined) => (raw && /^\d{4}/.test(raw) ? raw.slice(0, 4) : '');

/** The work's links, its audio and video among them. */
function linksOf(work: Work): { url: string; text: string }[] {
  return [
    ...(work.links ?? []).map((link) => ({
      url: link.url,
      text: [link.label, link.platform].find(present) ?? bare(link.url),
    })),
    ...(work.url ? [{ url: work.url, text: bare(work.url) }] : []),
  ];
}

/** "Name (2022–). Title [Software]. address", from the work and its owner alone. */
function citation(work: Work, input: VariantRenderInput): ReactNode {
  const start = yearOf(work.period?.start ?? work.publishedAt ?? work.releasedAt);
  const end = work.period ? (work.period.end ? yearOf(work.period.end) : '') : undefined;
  const year = start ? (end === undefined || end === start ? start : `${start}–${end}`) : '';
  const medium = MEDIUM[work.medium];
  const where = linksOf(work)[0]?.url;
  return (
    <>
      {input.portfolio.identity.name}
      {year ? ` (${year})` : null}. <i>{work.title}</i>
      {medium ? (
        <>
          {' ['}
          <Words input={input}>{medium}</Words>
          {']'}
        </>
      ) : null}
      .
      {where ? (
        <>
          {' '}
          <Breakable url={where} />
        </>
      ) : null}
    </>
  );
}

/** When a record was true, as its date. */
const evidenceDate = (entry: Evidence) =>
  entry.publishedAt ?? entry.presentedAt ?? entry.receivedAt ?? entry.grantedAt ?? entry.filedAt;

/** A record as a reference line: its venue or title, linked where it has an address, and its date. */
function citedLine(entry: Evidence, ctx: RenderContext): ReactNode {
  const name = present(entry.publication)
    ? entry.publication
    : present(entry.title)
      ? entry.title
      : entry.source?.name;
  const raw = evidenceDate(entry);
  return joined([
    <MaybeLink key="n" url={entry.url ?? entry.source?.url} ctx={ctx}>
      {name}
    </MaybeLink>,
    entry.type === 'award' ? entry.organization : null,
    raw !== undefined ? <DateText key="d" raw={raw} ctx={ctx} /> : null,
  ]);
}

/** The quotation a record gives the work: a press excerpt or a testimonial's words. */
const quoteOf = (entry: Evidence) =>
  present(entry.excerpt) ? entry.excerpt : present(entry.statement) ? entry.statement : undefined;

/** A band of the article: its stop's name hanging in the head column, its text, and its margin. */
function Band({
  id,
  label,
  meta,
  margin,
  children,
  after,
  input,
  className,
}: {
  id: string;
  label: string;
  meta?: string;
  margin?: ReactNode;
  children: ReactNode;
  /** What reads after the margin: a figure across both columns that closes the band. */
  after?: ReactNode;
  input: VariantRenderInput;
  className?: string;
}) {
  const head = `${id}--head`;
  return (
    <section
      id={id}
      className={`ee-band${margin ? ' ee-band--margined' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={head}
    >
      <div className="ee-band__head">
        <div className="ee-head">
          <h2 className="ee-head-title" id={head}>
            <Words input={input}>{label}</Words>
          </h2>
          {meta ? (
            <p className="ee-head-meta" data-type-role="body-compact">
              <Words input={input}>{meta}</Words>
            </p>
          ) : null}
        </div>
      </div>
      <div className="ee-band__body">
        {children}
        {margin ? <div className="ee-band__margin">{margin}</div> : null}
        {after}
      </div>
    </section>
  );
}

/** A callout in a band's margin: a small head and what it says. */
function Callout({ title, id, children }: { title: ReactNode; id: string; children: ReactNode }) {
  return (
    <aside className="ee-aside" aria-labelledby={id}>
      <p className="ee-aside__head-title" id={id}>
        {title}
      </p>
      {children}
    </aside>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const { ids } = input;
  const model = homeModel(input);
  const way = wayBack(input, model, work);
  const ctx = renderContext(input, { id: work.id, lang: work.lang }, 1);
  const study = work.caseStudy;
  const parts = new Map<CaseStudyPart['key'], CaseStudyPart>(
    outline.parts.map((part) => [part.key, part]),
  );
  const anchor = (key: CaseStudyPart['key']) => parts.get(key)?.anchor;
  const region = (name: string) => `${ids.prefix}${work.id}--ee-${name}`;
  const words = (text: string) => <Words input={input}>{text}</Words>;

  const cover = placedMedia(work.cover, ctx);
  const plates = workImages(work, input)
    .filter((placement) => placement.asset !== work.cover?.asset)
    .flatMap((placement) => {
      const placed = placedMedia(placement, ctx);
      return placed ? [placed] : [];
    });
  const plate = model.plates.get(work.id);
  const evidence = evidenceByIds(work.evidence, input);
  const awards = evidence.filter((entry) => entry.type === 'award' && present(entry.title));
  const figures = evidence.filter((entry) => entry.metric?.value !== undefined);
  // What cites the work: every record but its own figures.
  const cited = evidence.filter((entry) => entry.metric?.value === undefined);
  const quoted = evidence.find((entry) => quoteOf(entry) !== undefined);
  const highlights = (work.highlights ?? []).filter(present);
  const links = linksOf(work);
  const chapter = chapterOfWork(work, model);

  // The next work in the selected run, else the next with its own page.
  const order = plateOrder(model);
  const at = order.findIndex(({ id }) => id === work.id);
  const nextPlate = at >= 0 ? order[at + 1] : undefined;
  const next = nextPlate
    ? {
        title: nextPlate.title,
        lang: nextPlate.lang,
        summary: nextPlate.summary,
        href: isRoutedWork(nextPlate)
          ? routeHref(input, { route: 'work', slug: nextPlate.slug })
          : homeRegion(input, plateId(input, nextPlate)),
        label: `Next in selected work, Pl. ${model.plates.get(nextPlate.id)}`,
      }
    : outline.next
      ? {
          title: outline.next.title,
          lang: outline.next.lang,
          summary: input.portfolio.works.find(({ id }) => id === outline.next!.id)?.summary,
          href: outline.next.href,
          label: 'Next case study',
        }
      : undefined;
  const hasArchive = model.archive.length > 0 && model.selection !== undefined;
  const decisions = study.decisions ?? [];

  // Each band takes the anchor of the first part it holds, and what it holds the rest.
  const firstOf = (...keys: CaseStudyPart['key'][]) =>
    keys.map(anchor).find((id): id is string => id !== undefined);
  const backgroundId = firstOf('challenge', 'context', 'role', 'constraints');
  const results =
    present(study.evidence) ||
    present(study.outcomes) ||
    awards.length > 0 ||
    figures.length > 0 ||
    quoted !== undefined;
  const resultsId = results ? firstOf('evidence', 'outcomes') : undefined;
  const own = (key: CaseStudyPart['key'], band: string | undefined) =>
    anchor(key) === band ? undefined : anchor(key);

  return (
    <>
      <Masthead
        input={input}
        folio={chapter}
        chapters={model.chapters}
        thesis={model.thesisSection?.id}
        archive={hasArchive ? homeRegion(input, archiveId(input)) : undefined}
        section={
          <>
            {way.section ?? null}
            {way.section ? ' ' : null}
            <span lang={work.lang}>{work.title}</span>
          </>
        }
      />
      <main
        id={ids.main}
        className="ee-main ee-case"
        tabIndex={-1}
        lang={work.lang}
        data-work-id={work.id}
      >
        <header className="ee-band ee-case__open">
          <h1 className="ee-case__title">{work.title}</h1>
          <div className="ee-band__head">
            <nav
              className="ee-case__way"
              aria-labelledby={region('way')}
              data-type-role="body-compact"
            >
              <span id={region('way')} hidden>
                {words('Where this case is')}
              </span>
              <a href={way.back}>{words(way.backLabel)}</a>
              {way.line ? <p>{words(way.line)}</p> : null}
            </nav>
          </div>
          <div className="ee-band__body">
            {present(work.summary) ? (
              <RichText source={work.summary} className="ee-case__lede" input={input} />
            ) : null}
            {/* The fact sheet on the language's subtle surface, its rows still ruled. */}
            <Facts
              surfaceClassName="ee-case__facts"
              facts={[
                present(work.role) ? [words('Role'), work.role] : null,
                work.period
                  ? [words('When'), <PeriodText key="v" period={work.period} ctx={ctx} />]
                  : work.publishedAt
                    ? [words('Published'), <DateText key="v" raw={work.publishedAt} ctx={ctx} />]
                    : null,
                present(work.organization) ? [words('Context'), work.organization] : null,
                work.tools?.length ? [words('Made with'), formatNames(work.tools, ctx)] : null,
                awards.length > 0
                  ? [
                      words('Recognition'),
                      awards.map((entry, index) => (
                        <span key={entry.id} lang={entry.lang}>
                          {index > 0 ? '; ' : null}
                          {joined([entry.title, entry.organization, yearOf(entry.receivedAt)])}
                        </span>
                      )),
                    ]
                  : null,
                links.length > 0
                  ? [
                      words('Links'),
                      <span key="l" className="ee-links">
                        {links.map((link, index) => (
                          <a key={index} href={hrefFor(link.url, input)}>
                            {/* A bare address breaks after its slashes, as the back matter's do (row 98). */}
                            {link.text === bare(link.url) ? (
                              <Breakable url={link.url} />
                            ) : (
                              link.text
                            )}
                          </a>
                        ))}
                      </span>,
                    ]
                  : null,
              ]}
            />
            {cover ? (
              <>
                {/* The cover on its plate's mat, the language's surface, as Pl. 1 sits on home. */}
                <Surface className="ee-case__plate">
                  <Figure
                    placed={cover}
                    ctx={ctx}
                    className="ee-media"
                    eager
                    sizes="(min-width: 81.25rem) 39rem, (min-width: 48rem) 66vw, 100vw"
                  />
                </Surface>
                <Caption
                  className="ee-plate__side"
                  title={<span lang={work.lang}>{work.title}</span>}
                  index={plate !== undefined ? words(`Pl. ${plate}`) : undefined}
                />
              </>
            ) : null}
          </div>
        </header>

        {present(work.description) || highlights.length > 0 || plates.length > 0 ? (
          <Band
            id={region('work')}
            label="The work"
            input={input}
            margin={
              highlights.length > 0 ? (
                <ul className="ee-ruled" role="list" data-type-role="body-compact">
                  {highlights.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : undefined
            }
          >
            {present(work.description) ? (
              <RichText
                source={work.description}
                className="ee-prose ee-case__work"
                input={input}
              />
            ) : null}
            {plates.length > 0 ? (
              <figure className="ee-case__plates">
                {plates.map((placed, index) => (
                  <div key={placed.asset} className="ee-case__pl">
                    <Figure
                      placed={placed}
                      ctx={ctx}
                      className="ee-media"
                      sizes="(min-width: 81.25rem) 30rem, 100vw"
                    />
                    <Caption
                      index={words(
                        plate !== undefined
                          ? `Pl. ${plate}${String.fromCharCode(97 + index)}`
                          : `Fig. ${index + 1}`,
                      )}
                    />
                  </div>
                ))}
              </figure>
            ) : null}
          </Band>
        ) : null}

        {backgroundId ? (
          <Band
            id={backgroundId}
            label="Background"
            input={input}
            margin={
              parts.has('role') || parts.has('constraints') ? (
                <>
                  {present(study.role) ? (
                    <div id={own('role', backgroundId)}>
                      <Callout title={words('Role')} id={`${backgroundId}-role`}>
                        <RichText source={study.role} input={input} />
                      </Callout>
                    </div>
                  ) : null}
                  {present(study.constraints) ? (
                    <div id={own('constraints', backgroundId)}>
                      <Callout title={words('Constraints')} id={`${backgroundId}-constraints`}>
                        <RichText source={study.constraints} input={input} />
                      </Callout>
                    </div>
                  ) : null}
                </>
              ) : undefined
            }
          >
            <div className="ee-prose">
              {present(study.challenge) ? (
                <div id={own('challenge', backgroundId)}>
                  <RichText source={study.challenge} className="ee-prose" input={input} />
                </div>
              ) : null}
              {present(study.context) ? (
                <div id={own('context', backgroundId)}>
                  <RichText source={study.context} className="ee-prose" input={input} />
                </div>
              ) : null}
            </div>
          </Band>
        ) : null}

        {decisions.length > 0 ? (
          <Band
            id={anchor('decisions')!}
            label="Decisions"
            meta={
              decisions.length > 1
                ? `${COUNTS[decisions.length - 1] ?? decisions.length}, in the order they were made.`
                : undefined
            }
            input={input}
          >
            <ol className="ee-rows ee-decisions" role="list">
              {decisions.map((decision, index) => (
                <li key={index} className="ee-row">
                  <h3 className="ee-decision">
                    <span className="ee-n">{index + 1}</span>{' '}
                    <RichText source={decision.decision} inline input={input} />
                  </h3>
                  {present(decision.rationale) ? (
                    <RichText source={decision.rationale} className="ee-prose" input={input} />
                  ) : null}
                  {present(decision.alternatives) ? (
                    <div className="ee-row__note" data-type-role="body-compact">
                      <p className="ee-aside__head-title">{words('Considered instead')}</p>
                      <RichText source={decision.alternatives} input={input} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </Band>
        ) : null}

        {resultsId ? (
          <Band
            id={resultsId}
            label="Results"
            input={input}
            after={
              quoted ? (
                <figure className="ee-case__quote" lang={quoted.lang}>
                  <blockquote
                    className="ee-quote__text"
                    data-type-role="headline"
                    cite={quoted.url ? hrefFor(quoted.url, input) : undefined}
                  >
                    <RichText source={quoteOf(quoted)!} input={input} />
                  </blockquote>
                  <figcaption className="ee-attrib" data-type-role="body-compact">
                    {joined([
                      present(quoted.author) || quoted.source ? (
                        <b key="a">
                          {present(quoted.author) ? quoted.author : quoted.source?.name}
                        </b>
                      ) : null,
                      present(quoted.title) ? (
                        <MaybeLink key="t" url={quoted.url} ctx={ctx}>
                          “{quoted.title}”
                        </MaybeLink>
                      ) : null,
                      quoted.publication,
                      quoted.source?.role,
                      evidenceDate(quoted) !== undefined ? (
                        <DateText key="d" raw={evidenceDate(quoted)!} ctx={ctx} />
                      ) : null,
                    ])}
                  </figcaption>
                </figure>
              ) : null
            }
            margin={
              awards.length > 0 || figures.length > 0 ? (
                <>
                  <Facts
                    facts={figures.map((entry) => [
                      <span key="t" lang={entry.lang}>
                        {entry.title ?? entry.metric?.key}
                      </span>,
                      <data key="v" value={entry.metric!.value!}>
                        {formatFigure(entry.metric!.value!, ctx)}
                        {present(entry.metric?.unit) ? ` ${entry.metric.unit}` : null}
                      </data>,
                    ])}
                  />
                  {awards.map((entry) => (
                    <Callout key={entry.id} title={entry.title} id={`${resultsId}-${entry.id}`}>
                      <p lang={entry.lang}>
                        {joined([entry.organization, yearOf(entry.receivedAt)])}
                        {entry.organization || entry.receivedAt ? '. ' : null}
                        {present(entry.description) ? (
                          <RichText source={entry.description} inline input={input} />
                        ) : null}
                      </p>
                    </Callout>
                  ))}
                </>
              ) : undefined
            }
          >
            <div className="ee-prose">
              {present(study.evidence) ? (
                <RichText source={study.evidence} className="ee-prose" input={input} />
              ) : null}
              {present(study.outcomes) ? (
                <div id={own('outcomes', resultsId)}>
                  <RichText source={study.outcomes} className="ee-prose" input={input} />
                </div>
              ) : null}
            </div>
          </Band>
        ) : null}

        {present(study.reflection) ? (
          <Band id={anchor('reflection')!} label="In hindsight" input={input}>
            <RichText source={study.reflection} className="ee-case__lede" input={input} />
          </Band>
        ) : null}

        <Band id={region('back')} label="Back matter" input={input} className="ee-case__back">
          <div className="ee-case__matter" data-type-role="body-compact">
            {links.length > 0 ? (
              <div>
                <h3 className="ee-aside__head-title">{words('Links')}</h3>
                <ul role="list">
                  {links.map((link, index) => (
                    <li key={index}>
                      <a href={hrefFor(link.url, input)}>
                        <Breakable url={link.url} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {cited.length > 0 ? (
              <div id={results ? undefined : anchor('evidence')}>
                <h3 className="ee-aside__head-title">{words('Cited in')}</h3>
                <ul role="list">
                  {cited.map((entry) => (
                    <li key={entry.id} lang={entry.lang}>
                      {citedLine(entry, ctx)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 className="ee-aside__head-title">{words('Cite this work')}</h3>
              <p>{citation(work, input)}</p>
            </div>
          </div>
        </Band>

        <nav className="ee-band ee-chapter__open ee-case__end" aria-labelledby={region('next')}>
          <div className="ee-band__head" />
          <div className="ee-band__body">
            {next ? (
              <div className="ee-case__next">
                <p id={region('next')} className="ee-label" data-type-role="body-compact">
                  {words(next.label)}
                </p>
                <p className="ee-case__next-title" data-type-role="headline" lang={next.lang}>
                  <a href={next.href}>{next.title}</a>
                </p>
                {present(next.summary) ? (
                  <RichText source={next.summary} className="ee-prose" input={input} />
                ) : null}
              </div>
            ) : (
              <span id={region('next')} hidden>
                {words('Where to go next')}
              </span>
            )}
            <ul className="ee-case__out" role="list" data-type-role="body-compact">
              <li>
                <a href={way.back}>{words(way.backLabel)}</a>
              </li>
              {hasArchive && way.backLabel !== 'Back to the archive' ? (
                <li>
                  <a href={homeRegion(input, archiveId(input))}>{words('The archive')}</a>
                </li>
              ) : null}
              <li>
                <a href={routeHref(input, { route: 'home' })}>{words('Home')}</a>
              </li>
            </ul>
          </div>
        </nav>
      </main>
      <Colophon input={input} model={model} />
    </>
  );
}
