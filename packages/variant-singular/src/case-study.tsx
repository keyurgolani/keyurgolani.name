import type { ReactNode } from 'react';
import {
  MediaFigure,
  placedImage,
  renderContext,
  type CaseStudyPageProps,
} from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Bar } from './chrome/bar';
import { Colophon } from './chrome/colophon';
import { Rail } from './chrome/rail';
import { Strip } from './chrome/strip';
import {
  caseActionOf,
  caseStopsOf,
  hostOf,
  listAnd,
  NOTES_ANCHOR,
  present,
  proofOf,
  squash,
  yearOf,
  type CaseStop,
  type Stop,
} from './model';
import { Band } from './panels/action-band';
import { Entries } from './renderers/entry';
import { EvidenceItem } from './renderers/evidence';
import { ownId, Phrase, Prose, uiLang, urlHref, When, Words } from './parts';

// A work's own page (brief §5.7, "Case stops"; routes.work bespoke): the
// home's panel grammar, one question per screen. Brief always, with a fact
// sheet; Exhibit when there's a cover; Problem, Choices, Result and
// Hindsight when the case study has them, the last on the accent; then
// Notes, in the record's grammar. Each stop ends on its band, on the other
// of paper and ink, and the rail, the strip and Contents walk the stops.

function StopShell({
  input,
  stop,
  stops,
  className,
  children,
}: {
  input: VariantRenderInput;
  stop: CaseStop;
  stops: readonly CaseStop[];
  className: string;
  children: ReactNode;
}) {
  const id = ownId(input.ids.prefix, stop.anchor);
  return (
    <section
      id={id}
      className="sg-panel"
      data-ground={stop.ground}
      data-sg-panel={`case-${stop.key}`}
      data-sg-stop=""
      data-sg-anchor={stop.anchor}
      aria-labelledby={`${id}--h`}
    >
      <div
        className={`sg-grid sg-panel__body ${className}`}
        data-ui-surface={stop.ground === 'canvas' ? undefined : stop.ground}
      >
        {children}
      </div>
      <Band
        input={input}
        n={stop.n}
        total={stops.length}
        ground={stop.band}
        finale={stop.ground === 'accent'}
        action={caseActionOf(stops, stop, input)}
      />
    </section>
  );
}

function Label({ input, stop, text }: { input: VariantRenderInput; stop: CaseStop; text: string }) {
  return (
    <h2
      className="sg-label"
      id={`${ownId(input.ids.prefix, stop.anchor)}--h`}
      tabIndex={-1}
      data-sg-heading=""
      data-type-role="title"
      data-sg-rise="meta"
    >
      <Words lang={uiLang(input.portfolio.locale)}>{text}</Words>
    </h2>
  );
}

function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const lang = uiLang(input.portfolio.locale);
  const study = work.caseStudy;
  const stops = caseStopsOf(work);
  const of = (key: CaseStop['key']) => stops.find((stop) => stop.key === key);
  const cited = (work.evidence ?? [])
    .map((id) => input.portfolio.evidence.find((entry) => entry.id === id))
    .filter((entry) => entry !== undefined);
  const award = cited.find((entry) => entry.type === 'award' && present(entry.title));
  const tools = (work.tools ?? []).filter(present).map(squash);
  const links = (work.links ?? []).filter((link) => present(link.url));
  const shown = work.cover ?? work.media?.[0];
  const cover = placedImage(shown, input, shown?.caption);
  // Every other picture the work has, with its caption, under the work.
  const frames = (work.media ?? [])
    .filter((placement) => placement !== shown)
    .map((placement) => ({ placement, image: placedImage(placement, input, placement.caption) }))
    .filter((frame) => frame.image !== undefined);
  const tags = (work.tags ?? []).filter(present).map(squash);
  const ctx = renderContext(input, { id: work.id, title: work.title }, 2);
  const proof = proofOf(input, work);
  const facts: [string, ReactNode][] = [];
  if (present(work.role)) facts.push(['Role', squash(work.role)]);
  if (present(work.organization)) facts.push(['For', squash(work.organization)]);
  if (work.period?.start)
    facts.push(['Since', <When key="since" raw={work.period.start} input={input} />]);
  if (tools.length > 0) facts.push(['Made with', listAnd(tools)]);
  if (tags.length > 0) facts.push(['On', listAnd(tags)]);
  if (award) {
    const year = yearOf(award.receivedAt);
    facts.push(['Recognition', `${squash(award.title!)}${year ? `, ${year}` : ''}`]);
  }
  if (links.length > 0) {
    facts.push([
      'Links',
      links.map((link, i) => (
        <span key={link.url}>
          {i > 0 ? ', ' : null}
          <a href={urlHref(link.url, input)}>
            {present(link.label) ? squash(link.label) : hostOf(link.url)}
          </a>
        </span>
      )),
    ]);
  }
  const all: readonly Stop[] = [
    ...stops,
    { anchor: NOTES_ANCHOR, label: { text: 'Notes', own: false } },
  ];
  const related =
    outline.related.length > 0
      ? outline.related
      : outline.works.filter((each) => each.id !== work.id);
  const brief = of('brief')!;
  const exhibit = of('exhibit');
  const problem = of('problem');
  const choices = of('choices');
  const result = of('result');
  const hindsight = of('hindsight');
  const notesId = ownId(input.ids.prefix, NOTES_ANCHOR);
  return (
    <div className="sg sg--case" data-sg-snap="proximity">
      <Bar input={input} stops={all} short="This case study" />
      <Strip input={input} stops={all} />
      <Rail input={input} stops={all} label="This case study" />
      <main id={input.ids.main} className="sg-main" tabIndex={-1}>
        <StopShell input={input} stop={brief} stops={stops} className="sg-case-brief">
          <h1
            className="sg-case-brief__h"
            id={`${ownId(input.ids.prefix, brief.anchor)}--h`}
            tabIndex={-1}
            data-sg-heading=""
            data-type-role="display"
            lang={work.lang}
            data-sg-rise="lead"
          >
            {squash(work.title)}
          </h1>
          {present(work.summary) ? (
            <p className="sg-case-brief__sum" data-type-role="title" data-sg-rise="support">
              <Phrase source={work.summary} input={input} />
            </p>
          ) : null}
          {!exhibit && present(work.description) ? (
            <div className="sg-case-prose sg-case-brief__more" data-sg-rise="support">
              <Prose source={work.description} input={input} className="sg-rec__prose" />
            </div>
          ) : null}
          {facts.length > 0 ? (
            <dl className="sg-facts" data-type-role="body" data-sg-rise="meta">
              {facts.map(([term, value]) => (
                <div key={term}>
                  <dt>
                    <Words lang={lang}>{term}</Words>
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </StopShell>
        {exhibit ? (
          <StopShell input={input} stop={exhibit} stops={stops} className="sg-best">
            <div className="sg-best__text">
              <Label input={input} stop={exhibit} text="The work" />
              {present(work.description) ? (
                <div className="sg-case-prose" data-sg-rise="support">
                  <Prose source={work.description} input={input} className="sg-rec__prose" />
                </div>
              ) : null}
              {proof.length > 0 ? (
                <ul
                  className="sg-best__proof"
                  role="list"
                  data-type-role="title"
                  data-sg-rise="support"
                >
                  {proof.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {frames.length > 0 ? (
                <ul className="sg-gallery__frames sg-gallery__frames--small" role="list">
                  {frames.map(({ placement, image }) => (
                    <li key={placement.asset}>
                      <MediaFigure
                        placed={image!}
                        ctx={ctx}
                        sizes="(min-width: 48rem) 20vw, 50vw"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {cover ? (
              <div className="sg-best__media" data-sg-rise="support">
                <MediaFigure
                  placed={cover}
                  ctx={ctx}
                  eager
                  sizes="(min-width: 48rem) 50vw, 100vw"
                />
              </div>
            ) : null}
          </StopShell>
        ) : null}
        {problem ? (
          <StopShell input={input} stop={problem} stops={stops} className="sg-case-statement">
            <Label input={input} stop={problem} text="The problem" />
            {present(study.challenge) ? (
              <div className="sg-case-statement__big" data-type-role="title" data-sg-rise="lead">
                <Prose source={study.challenge} input={input} />
              </div>
            ) : null}
            {present(study.context) ? (
              <div className="sg-case-statement__side" data-type-role="body" data-sg-rise="support">
                <div>
                  <h3>
                    <Words lang={lang}>Where</Words>
                  </h3>
                  <Prose source={study.context} input={input} />
                </div>
              </div>
            ) : null}
          </StopShell>
        ) : null}
        {choices ? (
          <StopShell input={input} stop={choices} stops={stops} className="sg-choices">
            <Label input={input} stop={choices} text="The choices" />
            {present(study.role) ? (
              <div className="sg-choices__role" data-type-role="body" data-sg-rise="support">
                <Prose source={study.role} input={input} />
              </div>
            ) : null}
            {(study.decisions?.length ?? 0) > 0 ? (
              <ol className="sg-choices__list" data-sg-rise="lead">
                {study.decisions!.map((decision, i) => (
                  <li key={i}>
                    <h3 data-type-role="title">
                      <span className="sg-num" aria-hidden="true">
                        {i + 1}
                      </span>
                      <Phrase source={decision.decision} input={input} />
                    </h3>
                    {present(decision.rationale) ? (
                      <p data-type-role="body">
                        <Phrase source={decision.rationale} input={input} />
                      </p>
                    ) : null}
                    {present(decision.alternatives) ? (
                      <p className="sg-choices__alt" data-type-role="body">
                        <b>
                          <Words lang={lang}>Rather than</Words>
                        </b>{' '}
                        <Phrase source={decision.alternatives} input={input} />
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {present(study.constraints) ? (
              <div className="sg-case-statement__side" data-type-role="body" data-sg-rise="meta">
                <div>
                  <h3>
                    <Words lang={lang}>Within</Words>
                  </h3>
                  <Prose source={study.constraints} input={input} />
                </div>
              </div>
            ) : null}
          </StopShell>
        ) : null}
        {result ? (
          <StopShell input={input} stop={result} stops={stops} className="sg-case-statement">
            <Label input={input} stop={result} text="The result" />
            {present(study.outcomes) ? (
              <div className="sg-case-statement__big" data-type-role="title" data-sg-rise="lead">
                <Prose source={study.outcomes} input={input} />
              </div>
            ) : null}
            {present(study.evidence) ? (
              <div className="sg-case-statement__side" data-type-role="body" data-sg-rise="support">
                <div>
                  <h3>
                    <Words lang={lang}>The evidence</Words>
                  </h3>
                  <Prose source={study.evidence} input={input} />
                </div>
              </div>
            ) : null}
          </StopShell>
        ) : null}
        {hindsight ? (
          <StopShell input={input} stop={hindsight} stops={stops} className="sg-case-hindsight">
            <Label input={input} stop={hindsight} text="In hindsight" />
            <div className="sg-hindsight" data-type-role="title" data-sg-rise="lead">
              <Prose source={study.reflection!} input={input} />
            </div>
          </StopShell>
        ) : null}
        <section
          className="sg-record"
          id={notesId}
          data-ground="canvas"
          data-sg-stop=""
          data-sg-anchor={NOTES_ANCHOR}
          data-sg-record=""
          aria-labelledby={`${notesId}--h`}
        >
          <div className="sg-grid sg-record__head">
            <h2
              className="sg-record__h"
              id={`${notesId}--h`}
              tabIndex={-1}
              data-sg-heading=""
              data-type-role="display"
            >
              <Words lang={lang}>Notes</Words>
            </h2>
          </div>
          <div className="sg-record__rows">
            {cited.length > 0 ? (
              <section className="sg-grid sg-rec" aria-labelledby={`${notesId}--refs`}>
                <header className="sg-rec__head">
                  <h3 id={`${notesId}--refs`} className="sg-rec__title">
                    <Words lang={lang}>References</Words>
                  </h3>
                </header>
                <div className="sg-rec__body">
                  {/* Each cited record whole, as the home's record shows it. */}
                  <Entries>
                    {cited.map((entry) => (
                      <EvidenceItem key={entry.id} entry={entry} input={input} level={3} />
                    ))}
                  </Entries>
                </div>
              </section>
            ) : null}
            {links.length > 0 ? (
              <section className="sg-grid sg-rec" aria-labelledby={`${notesId}--links`}>
                <header className="sg-rec__head">
                  <h3 id={`${notesId}--links`} className="sg-rec__title">
                    <Words lang={lang}>Links</Words>
                  </h3>
                </header>
                <div className="sg-rec__body">
                  <ul className="sg-notes" role="list">
                    {links.map((link) => (
                      <li key={link.url} className="sg-notes__row">
                        <a href={urlHref(link.url, input)}>
                          {present(link.label) ? squash(link.label) : hostOf(link.url)}
                        </a>
                        <span className="sg-rec__muted">{hostOf(link.url)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}
            {related.length > 0 ? (
              <section className="sg-grid sg-rec" aria-labelledby={`${notesId}--next`}>
                <header className="sg-rec__head">
                  <h3 id={`${notesId}--next`} className="sg-rec__title">
                    <Words lang={lang}>Next</Words>
                  </h3>
                </header>
                <div className="sg-rec__body">
                  <ul className="sg-notes" role="list">
                    {related.slice(0, 3).map((each) => (
                      <li key={each.id} className="sg-notes__row">
                        <a href={each.href}>{squash(each.title)}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </main>
      <Colophon input={input} />
      <Enhancement input={input} id="pager" />
    </div>
  );
}

export { CaseStudyPage };
