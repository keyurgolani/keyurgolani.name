import type { CSSProperties, ReactNode } from 'react';
import type { Evidence, Section } from '@portfolio/schema';
import {
  anchorSection,
  evidenceByIds,
  formatFigure,
  formatNames,
  hrefFor,
  isSignature,
  MediaFigure,
  pageOutline,
  PeriodText,
  placedMedia,
  present,
  renderContext,
  RichText,
  worksOf,
  type CaseStudyPageProps,
  type CaseStudyPart,
  type RenderContext,
} from '@portfolio/kit/sections';
import { Dock, type DockStop } from './dock';
import { FACT_PARTS, FlightArc, STOP_WORDS } from './flight-rail';
import { Colophon, Masthead, sectionsById, SystemIndex } from './home';
import { cosmosModel, type CosmosModel, type Ring } from './model';
import { LinkTo } from './parts';
import { SignatureSystem } from './renderers/works';

// A work's own page in Kinetic Cosmos, /work/<slug> (redesign, stream E,
// KC-M2). The work is a body of the system, so its page opens on a stage
// like home's: the way back through the system and its ring, the title as
// the page's one h1, its lines after the first stepped in, the work's own
// words and links, and the signature body, its cover in an orbit with its
// highlights as moons. Then the long account beside the fact sheet, which
// holds the case's setting as rows (the problem, the system around it, my
// part, what it couldn't move); the case's stops as links riding an orbit
// arc; and the rest of the case as bodies of their own, each in the
// composition's own words: the decisions as a table, the readings as
// sentences, where it landed, and the look back. Then the work's figures,
// what else orbits it, and the next body. The dock tracks
// the stop you're at and keeps the rings one link away; the Index holds
// every section of home. The host answers a slug with no case study with
// its 404.

/** The ring, and its works section, that hold the work on home. */
function placeOf(
  model: CosmosModel,
  byId: ReadonlyMap<string, Section>,
  input: CaseStudyPageProps['input'],
  workId: string,
): Ring | undefined {
  return model.rings.find((ring) =>
    ring.sections.some((entry) => {
      const section = byId.get(entry.id);
      return section !== undefined && worksOf(section, input).some((work) => work.id === workId);
    }),
  );
}

/** A figure's reading: its number, formatted, and its unit. */
function Reading({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const value = entry.metric?.value;
  if (value === undefined) return null;
  return (
    <>
      <data value={value}>{formatFigure(value, ctx)}</data>
      {present(entry.metric?.unit) ? (
        <span className="kc-reading__unit">{entry.metric.unit}</span>
      ) : null}
    </>
  );
}

/** The year a record dates from, for its hanging year. */
function yearOf(entry: Evidence): string | undefined {
  const raw =
    entry.publishedAt ??
    entry.receivedAt ??
    entry.grantedAt ??
    entry.filedAt ??
    entry.presentedAt ??
    entry.asOf;
  return raw === undefined ? undefined : /^\d{4}/.exec(raw)?.[0];
}

/** One stop's own content: the decisions as a table, the readings as figures, else the owner's words. */
function StopContent({
  part,
  study,
  readings,
  ctx,
  uiLang,
}: {
  part: CaseStudyPart;
  study: CaseStudyPageProps['work']['caseStudy'];
  readings: readonly Evidence[];
  ctx: RenderContext;
  uiLang?: string;
}) {
  const { input } = ctx;
  if (part.key === 'decisions') {
    return (
      <table className="kc-decisions">
        <thead>
          <tr lang={uiLang}>
            <th scope="col">Decision</th>
            <th scope="col">Why</th>
            <th scope="col">Considered instead</th>
          </tr>
        </thead>
        <tbody>
          {(study.decisions ?? []).map((decision, index) => (
            <tr key={index}>
              <th scope="row">
                <RichText source={decision.decision} className="kc-decision" input={input} />
              </th>
              <td data-label="Why">
                {present(decision.rationale) ? (
                  <RichText source={decision.rationale} className="kc-prose" input={input} />
                ) : null}
              </td>
              <td data-label="Considered instead">
                {present(decision.alternatives) ? (
                  <RichText source={decision.alternatives} className="kc-prose" input={input} />
                ) : (
                  <span className="kc-decisions__none" lang={uiLang}>
                    Nothing recorded
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (part.key === 'evidence') {
    return (
      <>
        {present(study.evidence) ? (
          <RichText source={study.evidence} className="kc-prose" input={input} />
        ) : null}
        {readings.length > 0 ? (
          <dl className="kc-readings">
            {readings.map((entry) => (
              <div key={entry.id} className="kc-reading" lang={entry.lang}>
                <dt className="kc-reading__what">
                  {present(entry.title) ? entry.title : null}
                  {present(entry.statement) ? (
                    <RichText source={entry.statement} inline input={input} />
                  ) : null}
                </dt>
                <dd className="kc-reading__value">
                  <Reading entry={entry} ctx={ctx} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </>
    );
  }
  const words = study[part.key];
  return present(words) ? <RichText source={words} className="kc-prose" input={input} /> : null;
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const { ids, portfolio } = input;
  const home = pageOutline(input);
  const model = cosmosModel(home, input);
  const byId = sectionsById(input);
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 2);
  const homeCtx = renderContext(input, { id: 'kc', title: undefined }, 2);
  const uiLang = ctx.uiLang;
  const study = work.caseStudy;
  const ring = placeOf(model, byId, input, work.id);
  const signature = isSignature(work, input);

  const topId = `${ids.prefix}kc--top`;
  const stageId = `${ids.prefix}kc--stage`;
  const indexId = `${ids.prefix}kc--index`;
  const factsId = `${ids.prefix}kc--facts`;

  const cited = evidenceByIds(work.evidence, input);
  const readings = cited.filter((entry) => entry.metric?.value !== undefined);
  const records = cited.filter((entry) => entry.metric?.value === undefined);
  const cover = work.cover ?? work.media?.[0];
  const figures = (work.media ?? [])
    .filter((placement) => placement !== cover)
    .flatMap((placement) => {
      const placed = placedMedia(placement, ctx);
      return placed ? [placed] : [];
    });
  const links = work.links ?? [];
  const at = outline.works.findIndex((each) => each.id === work.id);
  const next = outline.next
    ? portfolio.works.find((each) => each.id === outline.next!.id)
    : undefined;
  // With no next case study, the way on is the next work in the ring, at its place on home
  // (design review P2, M1), as Cinema does with the same sample.
  const onward = (() => {
    if (outline.next) {
      return {
        title: outline.next.title,
        lang: outline.next.lang,
        href: outline.next.href,
        work: next,
        cover: outline.next.cover,
      };
    }
    const inRing = ring
      ? ring.sections.flatMap((entry) => {
          const section = byId.get(entry.id);
          return section ? worksOf(section, input) : [];
        })
      : [];
    const at = inRing.findIndex((each) => each.id === work.id);
    const candidate = [...inRing.slice(at + 1), ...inRing.slice(0, Math.max(at, 0))].find(
      (each) => each.id !== work.id,
    );
    if (!candidate) return undefined;
    const anchored =
      anchorSection(candidate, input) !== null && anchorSection(candidate, input) !== undefined;
    return {
      title: candidate.title,
      lang: candidate.lang,
      href: anchored
        ? `${outline.home}#${ids.prefix}${candidate.id}`
        : (ring?.href ?? outline.home),
      work: candidate,
      cover: placedMedia(candidate.cover ?? candidate.media?.[0], ctx),
    };
  })();

  const kicker = [
    signature ? 'Signature work' : 'A work',
    ring ? `in the ${ring.label} ring` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  const back = ring
    ? { href: ring.href, label: `Back to the ${ring.label} ring` }
    : { href: outline.home, label: 'Back to the system' };

  const actions: ReactNode[] = [
    ...links.map((link, index) => (
      <LinkTo
        key={`link-${index}`}
        link={link}
        ctx={ctx}
        className={index === 0 ? 'kc-button kc-button--bright' : 'kc-link-action'}
      />
    )),
    work.url !== undefined ? (
      <a
        key="url"
        className={links.length === 0 ? 'kc-button kc-button--bright' : 'kc-link-action'}
        href={hrefFor(work.url, input)}
      >
        <span lang={uiLang}>Project site</span>
      </a>
    ) : null,
  ];

  // The setting of the case reads as facts, rows of the fact sheet at their own anchors; the
  // rest of it are bodies of their own (KC-M2: no template's run of heads and paragraphs).
  const asFacts = outline.parts.filter((part) => FACT_PARTS.has(part.key));
  const bodies = outline.parts.filter((part) => !FACT_PARTS.has(part.key));
  const tabled = bodies.filter((part) => part.key === 'decisions');
  const hung = bodies.filter((part) => part.key !== 'decisions');
  const facts: Array<{ key: string; id?: string; label: string; value: ReactNode }> = [
    ...(
      [
        ['work-role', 'Role', present(work.role) ? work.role : null],
        ['period', 'Period', work.period ? <PeriodText period={work.period} ctx={ctx} /> : null],
        ['organization', 'With', present(work.organization) ? work.organization : null],
        ['tools', 'Built with', work.tools?.length ? formatNames(work.tools, ctx) : null],
      ] as const
    ).flatMap(([key, label, value]) => (value === null ? [] : [{ key, label, value }])),
    ...asFacts.map((part) => ({
      key: part.key,
      id: part.anchor,
      label: STOP_WORDS[part.key],
      value: <RichText source={study[part.key] as string} className="kc-prose" input={input} />,
    })),
  ];

  const contact = model.closing[0];
  const stops: DockStop[] = [
    ...model.rings.map((each) => ({
      key: each.key,
      label: each.label,
      ...(each.lang ? { lang: each.lang } : {}),
      href: each.href,
      anchor: each.anchor,
    })),
    ...(contact?.href && contact.anchor
      ? [
          {
            key: 'contact',
            label: 'Contact',
            ...(uiLang ? { lang: uiLang } : {}),
            href: contact.href,
            anchor: contact.anchor,
          },
        ]
      : []),
  ];
  const track: DockStop[] = outline.parts.map((part) => ({
    key: part.key,
    label: STOP_WORDS[part.key],
    ...(uiLang ? { lang: uiLang } : {}),
    href: part.href,
    anchor: part.anchor,
  }));

  const label = (id: string, text: string, count?: string) => (
    <div className="kc-case-label">
      <h2 id={id} lang={uiLang}>
        {text}
      </h2>
      {count !== undefined ? (
        <span className="kc-case-label__count" lang={uiLang}>
          {count}
        </span>
      ) : null}
    </div>
  );

  return (
    <>
      <Masthead input={input} home={outline.home} id={topId} indexId={indexId} uiLang={uiLang} />
      <main
        id={ids.main}
        className="kc-main kc-case"
        tabIndex={-1}
        lang={work.lang}
        data-work-id={work.id}
      >
        <div className="kc-opening kc-case-stage" id={stageId} data-ui-surface="inverse">
          <nav className="kc-crumbs" aria-label="Breadcrumb">
            <ol role="list">
              <li>
                <a href={outline.home} lang={uiLang}>
                  The system
                </a>
              </li>
              {ring ? (
                <li>
                  <a href={ring.href} lang={ring.lang}>
                    {ring.label}
                  </a>
                </li>
              ) : null}
              <li>
                <span aria-current="page" lang={work.lang}>
                  {work.title}
                </span>
              </li>
            </ol>
          </nav>
          <div className="kc-case-stage__text">
            <p className="kc-case-stage__kicker" lang={uiLang}>
              {kicker}
            </p>
            <h1 className="kc-case-stage__title">{work.title}</h1>
            {present(work.summary) ? (
              <RichText source={work.summary} className="kc-lede" input={input} />
            ) : null}
            <div className="kc-actions">{actions}</div>
          </div>
          <SignatureSystem work={work} ctx={ctx} />
          <span className="kc-band" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((mark) => (
              <span key={mark} className="kc-band__mark" />
            ))}
          </span>
          <p className="kc-case-stage__back">
            <a href={back.href} lang={uiLang}>
              {back.label}
            </a>
          </p>
          {at >= 0 && outline.works.length > 1 ? (
            <p className="kc-case-stage__place" lang={uiLang}>
              Case study {at + 1} of {outline.works.length}
            </p>
          ) : null}
        </div>
        <div className="kc-orbitals kc-case__orbitals">
          <div className="kc-case-intro">
            <div className="kc-case-intro__words">
              {present(work.description) ? (
                <RichText
                  source={work.description}
                  className="kc-case-intro__prose"
                  input={input}
                />
              ) : null}
            </div>
            <section className="kc-case-facts" aria-labelledby={factsId}>
              {label(factsId, 'Fact sheet')}
              <dl className="kc-facts kc-case-facts__list">
                {facts.map((fact) => (
                  <div key={fact.key} id={fact.id} className="kc-facts__row">
                    <dt lang={uiLang}>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
          {outline.parts.length > 0 ? <FlightArc parts={outline.parts} uiLang={uiLang} /> : null}
          {tabled.map((part) => (
            <section
              key={part.key}
              id={part.anchor}
              className="kc-case-body"
              data-stop={part.key}
              aria-labelledby={`${part.anchor}--head`}
            >
              <h2 className="kc-case-body__label" id={`${part.anchor}--head`} lang={uiLang}>
                <span className="kc-rule__body" aria-hidden="true" />
                {STOP_WORDS[part.key]}
              </h2>
              <div className="kc-case-body__content">
                <StopContent
                  part={part}
                  study={study}
                  readings={readings}
                  ctx={ctx}
                  uiLang={uiLang}
                />
              </div>
            </section>
          ))}
          {hung.length > 0 ? (
            // The case's last stops as bodies on one orbit, each hung from the arc under its own
            // body, the way the signature's moons hang (design review P2, M2).
            <div
              className="kc-case-orbit"
              style={{ '--layout-count': hung.length } as CSSProperties}
            >
              <svg
                className="kc-case-orbit__arc"
                viewBox="0 0 100 10"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M0 0 Q50 20 100 0" />
              </svg>
              {hung.map((part, index) => {
                const at = (2 * index + 1) / (2 * hung.length);
                return (
                  <section
                    key={part.key}
                    id={part.anchor}
                    className="kc-case-body kc-case-body--hung"
                    data-stop={part.key}
                    aria-labelledby={`${part.anchor}--head`}
                    style={{ '--layout-dip': (4 * at * (1 - at)).toFixed(3) } as CSSProperties}
                  >
                    <span className="kc-moon__body" aria-hidden="true" />
                    <h2 className="kc-case-body__label" id={`${part.anchor}--head`} lang={uiLang}>
                      <span className="kc-rule__body" aria-hidden="true" />
                      {STOP_WORDS[part.key]}
                    </h2>
                    <div className="kc-case-body__content">
                      <StopContent
                        part={part}
                        study={study}
                        readings={readings}
                        ctx={ctx}
                        uiLang={uiLang}
                      />
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
          {figures.length > 0 ? (
            <div className="kc-case-figures">
              {/* One caption system for the case's figures (KC-S11): each numbered, then its own caption. */}
              {figures.map((placed, index) => (
                <div key={index} className="kc-case-figure">
                  <p className="kc-case-figure__number" lang={uiLang}>
                    Figure {index + 1}
                  </p>
                  <MediaFigure
                    placed={placed}
                    ctx={ctx}
                    className="kc-media"
                    sizes="(min-width: 64rem) 60vw, 100vw"
                  />
                </div>
              ))}
            </div>
          ) : null}
          {records.length > 0 ? (
            <div className="kc-case-back">
              {/* The work's links are the stage's buttons, so there's no list that repeats them
                  (design review P2, S3). */}
              <section aria-labelledby={`${factsId}--orbit`}>
                {label(
                  `${factsId}--orbit`,
                  'In orbit around this work',
                  records.length === 1 ? '1 record' : `${records.length} records`,
                )}
                <ol className="kc-case-records" role="list">
                  {records.map((entry) => (
                    <li key={entry.id} className="kc-case-record" lang={entry.lang}>
                      <span className="kc-case-record__year">{yearOf(entry)}</span>
                      <div className="kc-case-record__text">
                        {present(entry.title) ? (
                          <p className="kc-case-record__title">
                            {entry.url !== undefined ? (
                              <a href={hrefFor(entry.url, input)}>{entry.title}</a>
                            ) : (
                              entry.title
                            )}
                          </p>
                        ) : null}
                        {entry.source ? (
                          <p className="kc-case-record__source">{entry.source.name}</p>
                        ) : null}
                        {present(entry.statement) ? (
                          <RichText source={entry.statement} className="kc-summary" input={input} />
                        ) : present(entry.description) ? (
                          <RichText
                            source={entry.description}
                            className="kc-summary"
                            input={input}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          ) : null}
          {onward ? (
            <section className="kc-case-next" aria-labelledby={`${factsId}--next`}>
              {label(
                `${factsId}--next`,
                ring ? `Next body in the ${ring.label} ring` : 'Next body',
              )}
              <p className="kc-case-next__title" lang={onward.lang}>
                <a href={onward.href}>{onward.title}</a>
              </p>
              {onward.work && present(onward.work.summary) ? (
                <RichText source={onward.work.summary} className="kc-summary" input={input} />
              ) : null}
              {/* The cover's box is the grid child, so it takes the right-hand columns from 64rem
                  (KIN-2); the picture in it is a cover, rounded as the home's are. */}
              {onward.cover ? (
                <div className="kc-case-next__cover">
                  <MediaFigure
                    placed={onward.cover}
                    ctx={ctx}
                    className="kc-cover"
                    sizes="(min-width: 64rem) 30vw, 100vw"
                  />
                </div>
              ) : null}
              <p className="kc-case-next__home">
                <a href={outline.home} lang={uiLang}>
                  Back to the system
                </a>
              </p>
            </section>
          ) : (
            <div className="kc-case-next">
              <p className="kc-case-next__home">
                <a href={outline.home} lang={uiLang}>
                  Back to the system
                </a>
              </p>
            </div>
          )}
          {stops.length > 0 ? (
            <Dock
              stops={stops}
              rings={model.rings.length}
              indexTarget={indexId}
              stageId={stageId}
              uiLang={uiLang}
              label="The case"
              track={track}
              unit="Stop"
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
        ctx={homeCtx}
        uiLang={uiLang}
      />
    </>
  );
}
