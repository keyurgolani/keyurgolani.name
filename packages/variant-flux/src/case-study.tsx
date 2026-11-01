import type { CSSProperties, ReactNode } from 'react';
import type { Evidence, Placement } from '@portfolio/schema';
import {
  anchorSection,
  formatNames,
  pageOutline,
  PeriodText,
  renderContext,
  type CaseStudyPageProps,
  type CaseStudyPart,
} from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { IndexDialog } from './chrome/index-dialog';
import { TabBar } from './chrome/tab-bar';
import { Field, GooDefs } from './field/field';
import { Pool } from './field/pool';
import {
  addressOf,
  caseOf,
  controlsOf,
  headOf,
  present,
  sheetsOf,
  wordEms,
  type CasePartKey,
  type CaseView,
} from './model';
import {
  captionedImage,
  Img,
  Out,
  ownId,
  Phrase,
  Prose,
  readyImage,
  Tracks,
  uiLang,
  When,
  WipeCurtain,
  Words,
} from './parts';
import { Footer } from './renderers/close';
import { Rows } from './renderers/record';

// A work's own page in Flux, /work/<slug> (brief §5.10, P2; P-0's case).
// It opens as home does: the field behind it all, the inks pouring off
// the edges, the work's title as the one h1 over its summary, the cover
// whole in the liquid drop on the third ink's pool, and the work's
// highlights as the one line of proof. Below, the case is one sheet whose
// tab melts out of its top edge, "The work": the work's own words beside
// its fact sheet, its pictures in blob-masked frames, the decisions as the
// centrepiece, each standing on an ink lip with its drip, the account in
// two runs with run-in heads (what it was up against, what changed), the
// reflection at display size, and the records it cites, on the record.
// Then a second sheet, the way on: the next case study, else back to the
// sheet that lists it. The bar marks that destination (Work, most often),
// the Index lists this page's parts before home's sheets, and the footer
// is home's. Every part's id is the outline's anchor, so each link lands.

/** The composition's words for each part's head. */
const PART_WORDS: Record<CasePartKey, string> = {
  challenge: 'Challenge',
  context: 'Context',
  role: 'Role',
  constraints: 'Constraints',
  decisions: 'Decisions',
  evidence: 'Evidence',
  outcomes: 'Outcomes',
  reflection: 'Reflection',
};

const caseId = (input: VariantRenderInput, name: string) => ownId(input.ids.prefix, `case-${name}`);

/** The crumb over the title: the home sheet that lists the work, then what it is and since when. */
function Crumb({ view, input }: { view: CaseView; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const home = routeHref(input, { route: 'home' });
  const { work } = view;
  const what = view.signature ? 'Signature work' : undefined;
  return (
    <p className="fx-case__crumb" data-type-role="body-compact">
      <a href={`${home}#${ownId(input.ids.prefix, `sheet-${view.home.id}`)}`}>
        {view.home.own ? <Words lang={lang}>{view.home.word}</Words> : view.home.word}
      </a>
      {what || view.since ? (
        <span className="fx-case__what">
          {what ? <Words lang={lang}>{view.since ? `${what}, since ` : what}</Words> : null}
          {!what && view.since ? <Words lang={lang}>Since </Words> : null}
          {view.since ? (
            <When raw={work.period?.start ?? work.publishedAt ?? work.releasedAt} lang={lang} />
          ) : null}
        </span>
      ) : null}
    </p>
  );
}

/** The opening: the field, the crumb and the title, the summary, the drop, the proof line. */
function CaseOpening({ view, input }: { view: CaseView; input: VariantRenderInput }) {
  const { blobs } = controlsOf(input);
  const { work } = view;
  const placed = view.media ? readyImage(view.media, input) : undefined;
  const note = placed ? captionedImage(view.media, input)?.caption : undefined;
  return (
    <section
      className="fx-opening-frame"
      aria-labelledby={caseId(input, 'title')}
      data-fx-place={view.home.id}
    >
      <div className="fx-opening fx-opening--case" data-fx-inks={blobs}>
        <Field prefix={input.ids.prefix} inks={blobs !== 'off'} />
        <div className="fx-opening__words">
          <div className="fx-case__head">
            <Crumb view={view} input={input} />
            <h1
              className="fx-case__title"
              id={caseId(input, 'title')}
              data-type-role="display"
              data-length={view.length}
              style={{ '--layout-fx-ems': view.titleEms } as CSSProperties}
            >
              {work.title}
            </h1>
          </div>
          {present(work.summary) ? (
            <p className="fx-lede" data-type-role="title">
              <Phrase source={work.summary} input={input} />
            </p>
          ) : null}
        </div>
        <div
          className="fx-plate fx-plate--case"
          data-cover={placed ? (view.fit ?? 'contain') : 'none'}
        >
          <div className="fx-plate__stage">
            <div className="fx-drop">
              {placed ? (
                <Img
                  placed={placed}
                  input={input}
                  sizes="(min-width: 64rem) 34vw, 80vw"
                  eager
                  className="fx-drop__img"
                />
              ) : (
                <p className="fx-drop__type" data-type-role="headline" aria-hidden="true">
                  {work.title}
                </p>
              )}
            </div>
            {blobs === '3' ? <Pool /> : null}
          </div>
          {/* What the owner wrote about the picture in the drop, under it: the drop clips its own. */}
          {note ? <div className="fx-plate__note">{note}</div> : null}
        </div>
        {view.proof.length > 0 ? (
          <ul className="fx-proof" aria-label="In short" data-type-role="body-compact">
            {view.proof.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** The fact sheet: what it is, when, with whom, with what, and where to find it. */
function Facts({ view, input }: { view: CaseView; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const { work } = view;
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: work.title }, 3);
  const links = [
    ...(present(work.url) ? [{ url: work.url, label: 'Project site', own: true }] : []),
    ...(work.links ?? [])
      .filter((link) => present(link.url) && link.url !== work.url)
      .map((link) => ({
        url: link.url,
        label: present(link.label) ? link.label : addressOf(link.url),
        own: false,
      })),
  ];
  const awards = view.cited.filter((entry) => entry.type === 'award');
  const rows: [string, ReactNode][] = [
    ...(present(work.role) ? ([['Role', work.role]] as [string, ReactNode][]) : []),
    ...(work.period
      ? ([['Period', <PeriodText key="p" period={work.period} ctx={ctx} />]] as [
          string,
          ReactNode,
        ][])
      : []),
    ...([work.organization, work.publication, work.artist, work.label, work.series].some(present)
      ? ([
          [
            'With',
            [work.organization, work.publication, work.artist, work.label, work.series]
              .filter(present)
              .join(', '),
          ],
        ] as [string, ReactNode][])
      : []),
    ...(work.tools?.length
      ? ([['Tools', formatNames(work.tools, ctx)]] as [string, ReactNode][])
      : []),
    ...(work.tags?.length
      ? ([['Tags', formatNames(work.tags, ctx)]] as [string, ReactNode][])
      : []),
    ...(awards.length > 0
      ? ([
          [
            'Recognition',
            awards.map((award, index) => (
              <span key={award.id} lang={award.lang}>
                {index > 0 ? '; ' : null}
                {award.title}
              </span>
            )),
          ],
        ] as [string, ReactNode][])
      : []),
    ...(links.length > 0
      ? ([
          [
            'Links',
            links.map((link, index) => (
              <span key={link.url}>
                {index > 0 ? ', ' : null}
                <a href={link.url}>
                  {link.own ? <Words lang={lang}>{link.label}</Words> : link.label}
                  <Out href={link.url} />
                </a>
              </span>
            )),
          ],
        ] as [string, ReactNode][])
      : []),
  ];
  if (rows.length === 0) return null;
  return (
    <dl className="fx-case__facts">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt data-type-role="caption">
            <Words lang={lang}>{term}</Words>
          </dt>
          <dd data-type-role="body-compact">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The work's pictures past the one in the drop, in blob-masked frames. */
function Pictures({ view, input }: { view: CaseView; input: VariantRenderInput }) {
  const { work } = view;
  const images = [work.cover, ...(work.media ?? [])]
    .filter(
      (each, index, all): each is Placement =>
        each !== undefined &&
        each.asset !== view.media?.asset &&
        all.findIndex((other) => other?.asset === each.asset) === index,
    )
    .flatMap((placement) => {
      const placed = captionedImage(placement, input);
      return placed ? [placed] : [];
    });
  if (images.length === 0) return null;
  return (
    <ul
      className="fx-gallery__frames fx-case__pictures"
      role="list"
      data-count={String(images.length)}
    >
      {images.map((placed, index) => (
        <li key={placed.asset} className="fx-frame" data-shape={String(index % 3)}>
          <Img
            placed={placed}
            input={input}
            sizes="(min-width: 64rem) 45vw, 100vw"
            inline={false}
            className="fx-frame__img"
          />
        </li>
      ))}
    </ul>
  );
}

function PartHead({
  part,
  input,
  className,
  role = 'title',
}: {
  part: CaseStudyPart;
  input: VariantRenderInput;
  className: string;
  role?: string;
}) {
  return (
    <h3 className={className} id={`${part.anchor}--h`} data-type-role={role}>
      <Words lang={uiLang(input.portfolio.locale)}>{PART_WORDS[part.key]}</Words>
    </h3>
  );
}

/** The decisions, each standing on an ink lip with its drip: the case's centrepiece. */
function Decisions({
  part,
  view,
  input,
}: {
  part: CaseStudyPart;
  view: CaseView;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  const decisions = view.work.caseStudy.decisions ?? [];
  return (
    <section
      className="fx-case__decide"
      id={part.anchor}
      aria-labelledby={`${part.anchor}--h`}
      data-count={String(decisions.length)}
    >
      <PartHead part={part} input={input} className="fx-sec__title" role="headline" />
      <ol className="fx-case__decisions" role="list">
        {decisions.map((decision, index) => (
          <li key={index} className="fx-decision">
            <span className="fx-decision__drip" aria-hidden="true" />
            <h4 className="fx-decision__title" data-type-role="headline">
              <Phrase source={decision.decision} input={input} />
            </h4>
            {present(decision.rationale) ? (
              <p className="fx-decision__why" data-type-role="body">
                <span className="fx-case__soft">
                  <Words lang={lang}>Why: </Words>
                </span>
                <Phrase source={decision.rationale} input={input} />
              </p>
            ) : null}
            {present(decision.alternatives) ? (
              <p className="fx-decision__instead fx-case__soft" data-type-role="body-compact">
                <Words lang={lang}>Instead of: </Words>
                <Phrase source={decision.alternatives} input={input} />
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One part of the account, under its run-in head. */
function StoryPart({
  part,
  view,
  input,
}: {
  part: CaseStudyPart;
  view: CaseView;
  input: VariantRenderInput;
}) {
  const study = view.work.caseStudy;
  const source = part.key === 'decisions' ? undefined : study[part.key];
  const highlights =
    part.key === 'outcomes' ? (view.work.highlights ?? []).filter(present).slice(3) : [];
  return (
    <section
      className="fx-case__part"
      id={part.anchor}
      aria-labelledby={`${part.anchor}--h`}
      data-part={part.key}
    >
      <PartHead part={part} input={input} className="fx-case__runin" />
      {present(source) ? <Prose source={source} input={input} /> : null}
      {highlights.length > 0 ? (
        <ul className="fx-case__more" role="list" data-type-role="body-compact">
          {highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The records the work cites, as home's rows, each with a link to where it sits on home. */
function OnRecord({
  view,
  evidence,
  input,
}: {
  view: CaseView;
  evidence?: CaseStudyPart;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  const home = routeHref(input, { route: 'home' });
  if (view.cited.length === 0) return null;
  // With no evidence text of its own, the evidence part is the record: its anchor lands here.
  const id = (view.evidenceOnRecord ? evidence?.anchor : undefined) ?? caseId(input, 'record');
  const there = (entry: Evidence) => {
    const section = anchorSection(entry, input);
    if (!section) return undefined;
    const head = headOf(section);
    return { href: `${home}#${input.ids.prefix}${entry.id}`, label: head.title };
  };
  return (
    <section className="fx-case__record" id={id} aria-labelledby={`${id}--h`}>
      <h3 className="fx-sec__title" id={`${id}--h`} data-type-role="headline">
        <Words lang={lang}>On the record</Words>
      </h3>
      <Rows entries={view.cited} input={input} home={there} />
    </section>
  );
}

/** The way on: the next case study, else back to the sheet that lists this one. */
function Onward({
  view,
  outline,
  input,
}: {
  view: CaseView;
  outline: CaseStudyPageProps['outline'];
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  const home = routeHref(input, { route: 'home' });
  const back = `${home}#${ownId(input.ids.prefix, `sheet-${view.home.id}`)}`;
  const next = outline.next;
  const nextWork = next ? input.portfolio.works.find((work) => work.id === next.id) : undefined;
  const word = next ? 'Next' : view.home.word;
  const own = next ? true : view.home.own;
  const id = caseId(input, 'onward');
  const placed = nextWork ? readyImage(nextWork.cover ?? nextWork.media?.[0], input) : undefined;
  const style = { '--layout-fx-step': 1, '--layout-fx-ems': wordEms(word) } as CSSProperties;
  return (
    <section
      className="fx-sheet fx-case__onward"
      id={id}
      data-sheet="onward"
      data-fx-ink="b"
      data-fx-place={view.home.id}
      style={style}
      aria-labelledby={`${id}--h`}
    >
      <div className="fx-sheet__tab">
        <h2 className="fx-sheet__word" id={`${id}--h`} data-type-role="display">
          {own ? <Words lang={lang}>{word}</Words> : word}
        </h2>
        <span className="fx-sheet__drip" aria-hidden="true" />
      </div>
      <div className="fx-sheet__body">
        {next ? (
          <div className="fx-case__next" lang={next.lang}>
            <p className="fx-case__next-title" data-type-role="display">
              <a href={next.href}>{next.title}</a>
            </p>
            {nextWork && present(nextWork.summary) ? (
              <p className="fx-case__soft" data-type-role="title">
                <Phrase source={nextWork.summary} input={input} />
              </p>
            ) : null}
            {placed ? (
              <div className="fx-frame fx-case__next-frame" data-shape="1" aria-hidden="true">
                <Img
                  placed={placed}
                  input={input}
                  sizes="(min-width: 64rem) 30vw, 80vw"
                  inline={false}
                  decorative
                  className="fx-frame__img"
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <p className={next ? 'fx-case__back' : 'fx-case__back fx-case__back--only'}>
          <a href={back} data-type-role={next ? 'title' : 'display'}>
            <Words lang={lang}>Back to </Words>
            {view.home.own ? <Words lang={lang}>{view.home.word}</Words> : view.home.word}
          </a>
        </p>
      </div>
    </section>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const lang = uiLang(input.portfolio.locale);
  const sheets = sheetsOf(input, pageOutline(input));
  const view = caseOf(input, outline, sheets);
  const { decisions, reflection } = view;
  const id = caseId(input, 'work');
  const word = 'The work';
  const style = { '--layout-fx-step': 0, '--layout-fx-ems': wordEms(word) } as CSSProperties;
  const evidence = outline.parts.find((part) => part.key === 'evidence');
  // This page's stops, in the order the page sets them, for the Index.
  const stops = [
    ...(decisions ? [decisions] : []),
    ...view.before,
    ...view.after,
    ...(reflection ? [reflection] : []),
    ...(view.evidenceOnRecord && evidence ? [evidence] : []),
  ];
  return (
    <div className="fx fx--case" data-fx-here={view.home.id}>
      <span className="fx-top" aria-hidden="true" />
      <WipeCurtain on={controlsOf(input).wipe} />
      <GooDefs prefix={input.ids.prefix} />
      <TabBar input={input} sheets={sheets} here={view.home.id} />
      <main
        id={input.ids.main}
        className="fx-main"
        tabIndex={-1}
        lang={work.lang}
        data-work-id={work.id}
      >
        <CaseOpening view={view} input={input} />
        <section
          className="fx-sheet fx-case__sheet"
          id={id}
          data-sheet="case"
          data-fx-ink="a"
          data-fx-place={view.home.id}
          style={style}
          aria-labelledby={`${id}--h`}
        >
          <div className="fx-sheet__tab">
            <h2 className="fx-sheet__word" id={`${id}--h`} data-type-role="display">
              <Words lang={lang}>{word}</Words>
            </h2>
            <span className="fx-sheet__drip" aria-hidden="true" />
          </div>
          <div className="fx-sheet__body">
            <div className="fx-case__open">
              <div className="fx-case__intro">
                {present(work.description) ? (
                  <Prose source={work.description} input={input} role="title" />
                ) : null}
                <Tracks work={work} input={input} fold={false} />
              </div>
              <Facts view={view} input={input} />
            </div>
            <Pictures view={view} input={input} />
            {decisions ? <Decisions part={decisions} view={view} input={input} /> : null}
            {view.before.length + view.after.length > 0 ? (
              <div className="fx-case__story">
                {view.before.length > 0 ? (
                  <div className="fx-case__run">
                    {view.before.map((part) => (
                      <StoryPart key={part.key} part={part} view={view} input={input} />
                    ))}
                  </div>
                ) : null}
                {view.after.length > 0 ? (
                  <div className="fx-case__run">
                    {view.after.map((part) => (
                      <StoryPart key={part.key} part={part} view={view} input={input} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {reflection ? (
              <section
                className="fx-case__reflect"
                id={reflection.anchor}
                aria-labelledby={`${reflection.anchor}--h`}
              >
                <PartHead part={reflection} input={input} className="fx-case__runin" />
                <Prose
                  source={work.caseStudy.reflection!}
                  input={input}
                  role="headline"
                  className="fx-case__reflection"
                />
              </section>
            ) : null}
            <OnRecord view={view} evidence={evidence} input={input} />
          </div>
        </section>
        <Onward view={view} outline={outline} input={input} />
      </main>
      <Footer input={input} />
      <IndexDialog
        input={input}
        sheets={sheets}
        page={{
          title: work.title,
          href: `#${caseId(input, 'title')}`,
          links: [
            ...stops.map((part) => ({
              href: part.href,
              label: (
                <Words lang={lang}>
                  {part.key === 'evidence' && view.evidenceOnRecord
                    ? 'On the record'
                    : PART_WORDS[part.key]}
                </Words>
              ),
            })),
            ...(view.evidenceOnRecord || view.cited.length === 0
              ? []
              : [
                  {
                    href: `#${caseId(input, 'record')}`,
                    label: <Words lang={lang}>On the record</Words>,
                  },
                ]),
          ],
        }}
      />
      <Enhancement input={input} id="tabs" />
    </div>
  );
}
