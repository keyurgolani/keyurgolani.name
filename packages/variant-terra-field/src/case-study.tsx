import type { ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import {
  DateText,
  formatNames,
  Heading,
  MediaFigure,
  PeriodText,
  placedImage,
  present,
  renderContext,
  renderSection,
  RichText,
  type CaseStudyPageProps,
  type RenderContext,
} from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import { FieldNotes } from './chrome/field-notes';
import { Footer } from './chrome/footer';
import { Marker } from './chrome/marker';
import { Masthead } from './chrome/masthead';
import { caseModel, chromeIds, MEDIUM_WORDS, said, type CaseModel, type CasePart } from './model';
import { linkText, Links, Words } from './parts';
import { renderersFor } from './renderers';
import { closeFrame } from './renderers/contact';
import { CitedRecords } from './renderers/evidence';
import { When } from './renderers/works';

// A work's own page in Terra Field, /work/<slug> (brief §5.5 step 9). The
// masthead and the work's opening sit on a short field whose arc the cover
// overlaps, so the field opens onto the work as home's opens onto its
// plate. Under it, on paper and on the page's axis: the ruled fact sheet,
// an index of the account's parts, then each part under a horizon-line
// head in Terra's own words: the decisions numbered in order, the evidence
// with the records the work cites in their home forms. Then the way on (the
// next case study, else All work beside the nearest related work, labelled
// by what they share), and the same rising close and footer as home. One
// h1, the work's title; every part's id is the outline's, so each link in
// the index lands.

const one = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);

/** The opening's one line above the title: the home section that holds the work, then what it is. */
function Crumb({ work, model, ctx }: { work: Work; model: CaseModel; ctx: RenderContext }) {
  const medium = MEDIUM_WORDS[work.medium];
  const what: ReactNode[] = [
    model.signature ? <Words lang={ctx.uiLang}>Signature work</Words> : null,
    medium ? (
      <Words lang={ctx.uiLang}>{model.signature ? medium.toLowerCase() : medium}</Words>
    ) : null,
    work.period?.start || work.publishedAt || work.releasedAt ? (
      <When work={work} ctx={ctx} since />
    ) : null,
  ].filter((part) => part !== null);
  return (
    <p className="tf-kicker tf-label tf-crumb">
      {model.place ? (
        <a href={model.place.href} lang={model.place.lang}>
          {model.place.label}
        </a>
      ) : null}
      {model.place && what.length > 0 ? <span aria-hidden="true">/</span> : null}
      {what.length > 0 ? (
        <span>
          {what.map((part, index) => (
            <span key={index}>
              {index > 0 ? ', ' : null}
              {part}
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}

/** The ruled fact sheet: what the work is, when, with whom, with what, and where to find it. */
function Facts({ work, model, ctx }: { work: Work; model: CaseModel; ctx: RenderContext }) {
  const { input } = ctx;
  const medium = MEDIUM_WORDS[work.medium];
  const links = [
    ...(work.links ?? []).map((link) => ({ url: link.url, text: linkText(link) })),
    ...(work.url ? [{ url: work.url, text: 'Project site' }] : []),
  ];
  const outcomes = model.parts.some((part) => part.key === 'outcomes');
  const highlights = (work.highlights ?? []).filter(present);
  const rows: [string, ReactNode][] = [
    ...(said(work.role) ? ([['Role', work.role]] as [string, ReactNode][]) : []),
    ...(work.period
      ? ([['Period', <PeriodText key="p" period={work.period} ctx={ctx} />]] as [
          string,
          ReactNode,
        ][])
      : []),
    ...(said(work.organization) ? ([['With', work.organization]] as [string, ReactNode][]) : []),
    ...(medium
      ? ([
          [
            'Medium',
            <Words key="m" lang={ctx.uiLang}>
              {medium}
            </Words>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(work.tools?.length
      ? ([['Tools', formatNames(work.tools, ctx)]] as [string, ReactNode][])
      : []),
    ...(model.awards.length > 0
      ? ([
          [
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
          ],
        ] as [string, ReactNode][])
      : []),
    ...(!outcomes && highlights.length > 0
      ? ([['Highlights', highlights.join('; ')]] as [string, ReactNode][])
      : []),
    ...(links.length > 0
      ? ([['Links', <Links key="l" links={links} input={input} />]] as [string, ReactNode][])
      : []),
  ];
  if (rows.length === 0) return null;
  const ids = chromeIds(input.ids.prefix);
  return (
    <section className="tf-page tf-casefacts" aria-labelledby={ids.caseFacts}>
      <h2 className="tf-sr" id={ids.caseFacts}>
        <Words lang={ctx.uiLang}>Fact sheet</Words>
      </h2>
      <dl className="tf-factsheet tf-compact">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>
              <Words lang={ctx.uiLang}>{term}</Words>
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One part's own content: the decisions numbered, the evidence with its records, else the owner's words. */
function PartBody({
  part,
  work,
  model,
  ctx,
}: {
  part: CasePart;
  work: Work & { readonly caseStudy: NonNullable<Work['caseStudy']> };
  model: CaseModel;
  ctx: RenderContext;
}) {
  const { input } = ctx;
  const study = work.caseStudy;
  switch (part.key) {
    case 'overview':
      return <RichText source={work.description!} className="tf-casepart__lead" input={input} />;
    case 'decisions':
      return (
        <ol className="tf-decisions" role="list">
          {(study.decisions ?? []).map((decision, index) => (
            <li key={index} className="tf-decision">
              <span className="tf-decision__no tf-num" aria-hidden="true">
                {index + 1}
              </span>
              <Heading level={ctx.itemLevel} className="tf-title tf-decision__title">
                <RichText source={decision.decision} inline input={input} />
              </Heading>
              {said(decision.rationale) ? (
                <RichText source={decision.rationale} className="tf-compact" input={input} />
              ) : null}
              {said(decision.alternatives) ? (
                <p className="tf-compact tf-muted tf-decision__alt">
                  <Words lang={ctx.uiLang}>Considered instead:</Words>{' '}
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
          {said(study.evidence) ? <RichText source={study.evidence} input={input} /> : null}
          {model.cited.length > 0 ? <CitedRecords records={model.cited} ctx={ctx} /> : null}
        </>
      );
    case 'outcomes': {
      const highlights = (work.highlights ?? []).filter(present);
      return (
        <>
          <RichText source={study.outcomes!} input={input} />
          {highlights.length > 0 ? (
            <ul className="tf-ruled tf-compact" role="list">
              {highlights.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
        </>
      );
    }
    case 'reflection':
      return <RichText source={study.reflection!} className="tf-quote" input={input} />;
    default:
      return <RichText source={study[part.key]!} input={input} />;
  }
}

/** The way on: the next case study, else All work beside the nearest related work. */
function Onward({ model, ctx, works }: { model: CaseModel; ctx: RenderContext; works: number }) {
  const { input } = ctx;
  const ids = chromeIds(input.ids.prefix);
  const { onward } = model;
  if (onward.kind === 'next') {
    const cover = placedImage(onward.work?.cover ?? onward.work?.media?.[0], input);
    return (
      <section className="tf-page tf-casenext" aria-labelledby={ids.caseNext} data-on="next">
        <div className="tf-casenext__all">
          <h2 className="tf-label tf-kicker" id={ids.caseNext}>
            <Words lang={ctx.uiLang}>Next case study</Words>
          </h2>
          <p className="tf-headline tf-casenext__title" lang={onward.next.lang}>
            <a href={onward.next.href}>{onward.next.title}</a>
          </p>
          {onward.work && said(onward.work.summary) ? (
            <RichText source={onward.work.summary} className="tf-compact" input={input} />
          ) : null}
        </div>
        {cover && cover.image.state === 'ready' ? (
          <div className="tf-casenext__related tf-frame">
            <MediaFigure placed={cover} ctx={ctx} inline sizes="(min-width: 48rem) 30vw, 100vw" />
          </div>
        ) : null}
      </section>
    );
  }
  const related = onward.related;
  const cover = related
    ? placedImage(related.of?.cover ?? related.of?.media?.[0], input)
    : undefined;
  return (
    <section className="tf-page tf-casenext" aria-labelledby={ids.caseNext} data-on="all">
      <div className="tf-casenext__all">
        <p className="tf-label tf-kicker">
          {works === 1 ? (
            <Words lang={ctx.uiLang}>The only case study</Words>
          ) : (
            <>
              <span className="tf-num">{works}</span> <Words lang={ctx.uiLang}>case studies</Words>
            </>
          )}
        </p>
        <h2 className="tf-display tf-casenext__title" id={ids.caseNext}>
          <a href={onward.href}>
            <Words lang={ctx.uiLang}>All work</Words>
          </a>
        </h2>
      </div>
      {related ? (
        <article className="tf-plate tf-casenext__related" lang={related.lang}>
          <div className="tf-plate__cap">
            {related.terms.length > 0 ? (
              <p className="tf-label tf-kicker">
                <Words lang={ctx.uiLang}>Related:</Words>{' '}
                {related.terms.map((term, index) => (
                  <span key={term}>
                    {index > 0 ? ', ' : null}
                    <Words lang={ctx.uiLang}>also</Words> {term}
                  </span>
                ))}
              </p>
            ) : null}
            <Heading level={ctx.itemLevel} className="tf-title tf-plate__title">
              <a href={related.href}>{related.title}</a>
            </Heading>
            {related.of && said(related.of.summary) ? (
              <RichText source={related.of.summary} className="tf-compact" input={input} />
            ) : null}
          </div>
          {cover && cover.image.state === 'ready' ? (
            <div className="tf-frame">
              <MediaFigure placed={cover} ctx={ctx} inline sizes="(min-width: 48rem) 20vw, 100vw" />
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const model = caseModel(input, outline);
  const { home } = model;
  const ids = chromeIds(input.ids.prefix);
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 2);
  const renderers = renderersFor({ model: home });
  const closing = home.contact ?? home.cta;
  return (
    <div className="tf-root" data-tf-field={home.quiet ? 'quiet' : 'accent'} data-tf-page="case">
      <Masthead input={input} model={home} current={model.here} />
      <main
        id={input.ids.main}
        className="tf-main"
        tabIndex={-1}
        lang={work.lang}
        data-work-id={work.id}
      >
        <section
          className="tf-hero tf-hero--case"
          aria-labelledby={ids.caseTitle}
          data-cover={model.cover ? '' : undefined}
        >
          <div className="tf-page" data-ui-surface={home.quiet ? undefined : 'accent'}>
            <div className="tf-hero__inner">
              <Crumb work={work} model={model} ctx={ctx} />
              <h1 className="tf-display tf-hero__line" id={ids.caseTitle}>
                {work.title}
              </h1>
              {said(work.summary) ? (
                <RichText source={work.summary} className="tf-hero__lede" input={input} />
              ) : null}
            </div>
          </div>
        </section>
        {model.cover ? (
          <div className="tf-page tf-casecover">
            <div className="tf-casecover__frame">
              <MediaFigure
                placed={model.cover.image}
                ctx={ctx}
                eager
                sizes="(min-width: 64rem) 66vw, 100vw"
              />
            </div>
          </div>
        ) : null}
        <Facts work={work} model={model} ctx={ctx} />
        {/* The same marker as home's, so Field notes is one tap from any depth (N2, MF-2). */}
        <Marker input={input} model={home} />
        {model.parts.length > 1 ? (
          <nav
            className="tf-page tf-caseparts"
            aria-label="The case, part by part"
            lang={ctx.uiLang}
          >
            <ul className="tf-caseparts__list tf-compact" role="list">
              {model.parts.map((part) => (
                <li key={part.key}>
                  <a href={part.href}>{part.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="tf-page tf-casebody">
          {model.parts.map((part) => (
            <section
              key={part.key}
              id={part.anchor}
              className="tf-casepart"
              data-part={part.key}
              aria-labelledby={`${part.anchor}--head`}
            >
              <header className="tf-sechead">
                <div className="tf-sechead__line">
                  <h2 className="tf-title tf-sechead__title" id={`${part.anchor}--head`}>
                    <Words lang={ctx.uiLang}>{part.label}</Words>
                  </h2>
                  {part.count > 1 ? (
                    <p className="tf-sechead__count tf-compact">
                      <span className="tf-num">{part.count}</span>{' '}
                      <Words lang={ctx.uiLang}>
                        {part.key === 'decisions'
                          ? one(part.count, 'decision', 'decisions')
                          : one(part.count, 'record', 'records')}
                      </Words>
                    </p>
                  ) : null}
                </div>
              </header>
              <PartBody part={part} work={work} model={model} ctx={ctx} />
            </section>
          ))}
        </div>
        <Onward model={model} ctx={ctx} works={outline.works.length} />
        {closing
          ? renderSection(
              closing,
              input,
              { renderers, Frame: closeFrame(input, home.quiet) },
              { level: 2 },
            )
          : null}
      </main>
      <Footer input={input} model={home} />
      <FieldNotes
        input={input}
        model={home}
        page={{
          title: 'This page',
          links: model.parts.map((part) => ({ href: part.href, label: part.label })),
        }}
      />
      <Enhancement input={input} id="field" />
    </div>
  );
}
