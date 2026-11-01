import type { ReactNode } from 'react';
import type { Evidence, Work } from '@portfolio/schema';
import {
  DateText,
  formatNames,
  Heading,
  hrefFor,
  MediaFigure,
  PeriodText,
  placedImage,
  placedMedia,
  present,
  renderContext,
  RichText,
  type CaseStudyPageProps,
  type RenderContext,
} from '@portfolio/kit/sections';
import { caseModel, MEDIUM_WORDS, type CaseModel, type CasePart } from './case-model';
import { Colophon, Rail, StatusLine } from './chrome';
import { chromeIds, dateText, pack, recordState, said } from './model';
import { BoardIcon, CountText, Lamps, linkText, Out, Words } from './parts';
import { Bar } from './wall/panel';
import { Excerpt, Frames, Tracks } from './renderers/detail';

// A work's own page in Mission Control, /work/<slug> (brief §5.8: "a board
// with a fact-sheet inspector and a decision log"). The same rail, status
// line and colophon as home, so Contact is one tap away; the status line
// names the Work board it's back to. One board: its header band holds the
// page's one h1, the work's title, beside the work's lamps and counts and
// the board's own index of the account's parts. Then the wall: the brief
// (the cover, the summary, the description) beside the inspector (the
// fact sheet, only the fields the work has), then each part of the case
// study as a panel in the operations log's words, the decisions as a
// numbered log across the wall, the evidence with the records the work
// cites. Last, the way on: the next case in curation order, else All work
// beside the nearest related work, saying what they share. Every part's id
// is the outline's, so each link in the index lands.

type Routed = CaseStudyPageProps['work'];

/** The inspector's rows: what the work is, when, with whom, with what, and where to find it. */
function Inspector({ work, model, ctx }: { work: Work; model: CaseModel; ctx: RenderContext }) {
  const { input } = ctx;
  const ids = chromeIds(input.ids.prefix);
  const uiLang = model.home.uiLang;
  const medium = MEDIUM_WORDS[work.medium];
  const outcomes = model.parts.some((part) => part.key === 'outcomes');
  const highlights = (work.highlights ?? []).filter(present);
  const links = [
    ...(work.links ?? []).map((link) => ({ url: link.url, text: linkText(link) })),
    ...(said(work.url) ? [{ url: work.url, text: 'Project site' }] : []),
  ];
  const rows: [string, ReactNode][] = [];
  if (said(work.role)) rows.push(['Role', work.role]);
  if (work.period) rows.push(['Period', <PeriodText key="p" period={work.period} ctx={ctx} />]);
  if (said(work.organization)) rows.push(['With', work.organization]);
  if (said(work.artist)) rows.push(['Artist', work.artist]);
  if (said(work.series)) rows.push(['Series', work.series]);
  if (said(work.publication)) rows.push(['Published in', work.publication]);
  if (said(work.label)) rows.push(['Label', work.label]);
  if (work.guests?.length) rows.push(['Guests', formatNames(work.guests, ctx)]);
  if (work.tracks?.some((track) => said(track.title)))
    rows.push(['Tracks', <Tracks key="t" work={work} ctx={ctx} />]);
  if (medium)
    rows.push([
      'Medium',
      <Words key="m" lang={uiLang}>
        {medium}
      </Words>,
    ]);
  if (work.tools?.length) rows.push(['Tools', formatNames(work.tools, ctx)]);
  if (work.tags?.length) rows.push(['Tags', formatNames(work.tags, ctx)]);
  if (model.awards.length > 0)
    rows.push([
      'Recognition',
      model.awards.map((award, index) => (
        <span key={award.id} lang={award.lang}>
          {index > 0 ? '; ' : null}
          {award.title}
          {award.receivedAt ? (
            <>
              {', '}
              <DateText raw={award.receivedAt} ctx={ctx} />
            </>
          ) : null}
        </span>
      )),
    ]);
  if (!outcomes && highlights.length > 0)
    rows.push([
      'Highlights',
      <ul key="h" className="mc-ticks">
        {highlights.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    ]);
  if (links.length > 0)
    rows.push([
      'Links',
      <ul key="l" className="mc-actions">
        {links.map((link) => (
          <li key={link.url}>
            <Out href={hrefFor(link.url, input)} className="mc-link">
              {link.text}
            </Out>
          </li>
        ))}
      </ul>,
    ]);
  // The work's lamps read once, beside its title in the page's band, not again on this bar.
  if (rows.length === 0) return null;
  return (
    <section
      className="mc-panel mc-case__facts"
      data-span={6}
      id={ids.caseFacts}
      aria-labelledby={ids.caseFactsTitle}
    >
      <Bar level={2} id={ids.caseFactsTitle} title={<Words lang={uiLang}>Inspector</Words>} />
      <dl className="mc-facts">
        {rows.map(([term, value]) => (
          <div key={term} className="mc-facts__row">
            <dt>
              <Words lang={uiLang}>{term}</Words>
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The records the work cites, as log rows: when, what, where, and their lamps. */
function Cited({ records, ctx }: { records: readonly Evidence[]; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <ol className="mc-log">
      {records.map((record) => {
        const date =
          record.publishedAt ?? record.presentedAt ?? record.grantedAt ?? record.receivedAt;
        const url = record.url ?? record.links?.[0]?.url;
        const title = record.title ?? record.statement;
        const place = [record.venue, record.publication, record.organization].find(said);
        return (
          <li key={record.id} className="mc-log__row" lang={record.lang}>
            {date ? (
              <time className="mc-log__date mc-num" dateTime={date}>
                {dateText(date, input.portfolio.locale)}
              </time>
            ) : (
              <span className="mc-log__date" />
            )}
            <div className="mc-log__main">
              {said(title) ? (
                <Heading level={ctx.itemLevel} className="mc-log__title">
                  {url ? (
                    <Out href={hrefFor(url, input)}>
                      <RichText source={title} inline input={input} />
                    </Out>
                  ) : (
                    <RichText source={title} inline input={input} />
                  )}
                </Heading>
              ) : null}
              {record.title !== undefined && said(record.statement) ? (
                <RichText source={record.statement} className="mc-log__summary" input={input} />
              ) : null}
            </div>
            <div className="mc-log__meta">
              {place ? <span>{place}</span> : null}
              <Lamps lamps={recordState(record, input)} uiLang={ctx.uiLang} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One part's own content: the brief, the decision log, the evidence with its records, else the owner's words. */
function PartBody({
  part,
  work,
  model,
  ctx,
}: {
  part: CasePart;
  work: Routed;
  model: CaseModel;
  ctx: RenderContext;
}) {
  const { input } = ctx;
  const study = work.caseStudy;
  const uiLang = model.home.uiLang;
  switch (part.key) {
    case 'brief':
      return (
        <>
          {model.cover ? (
            <MediaFigure
              placed={
                placedMedia(
                  model.coverAt === -1 ? work.cover : work.media?.[model.coverAt ?? -1],
                  ctx,
                ) ?? model.cover
              }
              ctx={ctx}
              className="mc-cell__media mc-case__cover"
              eager
              sizes="(width >= 73.75rem) 60vw, 100vw"
            />
          ) : null}
          <div className="mc-panel__body">
            {said(work.summary) ? (
              <RichText source={work.summary} className="mc-case__summary" input={input} />
            ) : null}
            <Excerpt work={work} ctx={ctx} />
            {said(work.description) ? (
              <RichText source={work.description} className="mc-prose" input={input} />
            ) : null}
            {said(work.showNotes) ? (
              <RichText source={work.showNotes} className="mc-prose" input={input} />
            ) : null}
            <Frames
              work={work}
              ctx={ctx}
              {...(model.coverAt !== undefined && model.coverAt >= 0
                ? { except: model.coverAt }
                : {})}
            />
          </div>
        </>
      );
    case 'decisions':
      return (
        <ol className="mc-decisions">
          {(study.decisions ?? []).map((decision, index) => (
            <li key={index} className="mc-decision">
              <span className="mc-decision__no mc-num" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="mc-decision__main">
                <Heading level={ctx.itemLevel} className="mc-log__title">
                  <RichText source={decision.decision} inline input={input} />
                </Heading>
                {said(decision.rationale) ? (
                  <RichText source={decision.rationale} className="mc-log__summary" input={input} />
                ) : null}
              </div>
              {said(decision.alternatives) ? (
                <p className="mc-decision__alt">
                  <span className="mc-decision__label">
                    <Words lang={uiLang}>Considered instead</Words>
                  </span>{' '}
                  <RichText source={decision.alternatives} inline input={input} />
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      );
    case 'evidence':
      return (
        <>
          {said(study.evidence) ? (
            <div className="mc-panel__body">
              <RichText source={study.evidence} className="mc-prose" input={input} />
            </div>
          ) : null}
          {model.cited.length > 0 ? <Cited records={model.cited} ctx={ctx} /> : null}
        </>
      );
    case 'outcomes': {
      const highlights = (work.highlights ?? []).filter(present);
      return (
        <div className="mc-panel__body">
          <RichText source={study.outcomes!} className="mc-prose" input={input} />
          {highlights.length > 0 ? (
            <ul className="mc-ticks">
              {highlights.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    default:
      return (
        <div className="mc-panel__body">
          <RichText source={study[part.key]!} className="mc-prose" input={input} />
        </div>
      );
  }
}

/** The way on: the next case, else All work beside the nearest related work. */
function Onward({ model, ctx, works }: { model: CaseModel; ctx: RenderContext; works: number }) {
  const { input } = ctx;
  const ids = chromeIds(input.ids.prefix);
  const uiLang = model.home.uiLang;
  const { onward } = model;
  const cover = (work: Work | undefined) => {
    const image = placedImage(work?.cover ?? work?.media?.[0], input);
    return image && image.image.state === 'ready' ? image : undefined;
  };
  if (onward.kind === 'next') {
    const image = cover(onward.work);
    return (
      <section
        className="mc-panel mc-case__next"
        data-span={16}
        data-on="next"
        id={ids.caseNext}
        aria-labelledby={ids.caseNextTitle}
      >
        <Bar
          level={2}
          id={ids.caseNextTitle}
          title={<Words lang={uiLang}>Next case</Words>}
          meta={
            <CountText
              count={{ n: works, one: 'case study', many: 'case studies' }}
              uiLang={uiLang}
            />
          }
        />
        <div className="mc-case__onward">
          <div className="mc-panel__body">
            <p className="mc-case__next-title" lang={onward.next.lang}>
              <a href={onward.next.href}>{onward.next.title}</a>
            </p>
            {onward.work && said(onward.work.summary) ? (
              <RichText source={onward.work.summary} className="mc-cell__summary" input={input} />
            ) : null}
          </div>
          {image ? (
            <MediaFigure
              placed={image}
              ctx={ctx}
              className="mc-cell__media mc-case__thumb"
              sizes="(width >= 47.5rem) 30vw, 100vw"
            />
          ) : null}
        </div>
      </section>
    );
  }
  const related = onward.related;
  const image = cover(related?.of);
  return (
    <section
      className="mc-panel mc-case__next"
      data-span={16}
      data-on="all"
      id={ids.caseNext}
      aria-labelledby={ids.caseNextTitle}
    >
      <Bar
        level={2}
        id={ids.caseNextTitle}
        title={
          <a href={onward.href}>
            <Words lang={uiLang}>All work</Words>
          </a>
        }
        meta={
          // With one case study, the count would only say so: the bar names where to go.
          works === 1 ? undefined : (
            <CountText
              count={{ n: works, one: 'case study', many: 'case studies' }}
              uiLang={uiLang}
            />
          )
        }
      />
      {related ? (
        <div className="mc-case__onward">
          <article className="mc-panel__body" lang={related.lang}>
            {related.terms.length > 0 ? (
              <p className="mc-role">
                <Words lang={uiLang}>Related, also</Words> {related.terms.join(', ')}
              </p>
            ) : null}
            <Heading level={ctx.itemLevel} className="mc-case__next-title">
              <a href={related.href}>{related.title}</a>
            </Heading>
            {related.of && said(related.of.summary) ? (
              <RichText source={related.of.summary} className="mc-cell__summary" input={input} />
            ) : null}
          </article>
          {image ? (
            <MediaFigure
              placed={image}
              ctx={ctx}
              className="mc-cell__media mc-case__thumb"
              sizes="(width >= 47.5rem) 30vw, 100vw"
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const model = caseModel(input, outline);
  const { home } = model;
  const ids = chromeIds(input.ids.prefix);
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 2);
  const decisions = work.caseStudy.decisions?.length ?? 0;
  // The brief and the inspector share the first row; the parts pack first-fit after them.
  const brief = model.parts.find(({ key }) => key === 'brief');
  const restPacked = pack(
    model.parts.filter(({ key }) => key !== 'brief').map((item) => ({ item, span: item.span })),
  );
  const panel = (part: CasePart, span: number) => (
    <section
      key={part.key}
      id={part.anchor}
      className="mc-panel mc-case__part"
      data-part={part.key}
      data-span={span}
      aria-labelledby={`${part.anchor}--head`}
    >
      <Bar
        level={2}
        id={`${part.anchor}--head`}
        title={<Words lang={home.uiLang}>{part.label}</Words>}
        meta={
          part.count > 1 ? (
            <CountText
              count={
                part.key === 'decisions'
                  ? { n: part.count, one: 'decision', many: 'decisions' }
                  : { n: part.count, one: 'record', many: 'records' }
              }
              uiLang={home.uiLang}
            />
          ) : undefined
        }
      />
      <PartBody part={part} work={work} model={model} ctx={ctx} />
    </section>
  );
  return (
    <div className="mc-root" data-mc-page="case">
      <Rail input={input} model={home} />
      <StatusLine input={input} model={home} crumb={model.back} />
      <main
        id={input.ids.main}
        className="mc-main"
        tabIndex={-1}
        lang={work.lang}
        data-work-id={work.id}
      >
        <section className="mc-board mc-board--case" aria-labelledby={ids.caseTitle}>
          <header className="mc-board__head">
            <h1 className="mc-board__title mc-case__title" id={ids.caseTitle}>
              <BoardIcon board="work" />
              <span>{work.title}</span>
            </h1>
            <div className="mc-board__counts">
              <Lamps lamps={recordState(work, input)} uiLang={home.uiLang} />
              {decisions > 0 ? (
                <CountText
                  count={{ n: decisions, one: 'decision', many: 'decisions' }}
                  uiLang={home.uiLang}
                />
              ) : null}
            </div>
            {model.parts.length > 1 ? (
              <nav className="mc-board__nav" aria-label="Parts of this case" lang={home.uiLang}>
                <ul className="mc-board__index">
                  {model.parts.map((part) => (
                    <li key={part.key}>
                      <a href={part.href}>{part.label}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </header>
          <div className="mc-wall">
            {brief ? panel(brief, 10) : null}
            <Inspector work={work} model={model} ctx={ctx} />
            {restPacked.map(({ item, span }) => panel(item, span))}
            <Onward model={model} ctx={ctx} works={outline.works.length} />
          </div>
        </section>
      </main>
      <Colophon input={input} model={home} />
    </div>
  );
}
