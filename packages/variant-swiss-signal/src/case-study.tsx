import type { CSSProperties } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  evidenceByIds,
  hrefFor,
  pageOutline,
  placedImage,
  recordAnchor,
  type CaseStudyPageProps,
  type CaseStudyPart,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { IndexSheet } from './chrome/index-sheet';
import { Colophon } from './chrome/colophon';
import { Masthead } from './chrome/masthead';
import { Img, readyImage } from './media';
import {
  caseAsideParts,
  caseFacts,
  caseHome,
  coverCaption,
  DECISION_HEADS,
  formatNumber,
  lengthClass,
  wordClass,
  wordFit,
  mediumWord,
  partsOf,
  present,
  splitAside,
  workWhen,
  yearOf,
} from './model';
import { Out, ownId, Paren, Phrase, Prose, uiLang, When, Words } from './parts';
import { Position } from './position';
import { RuledTable } from './renderers/ruled-table';

// A work's own page (brief §5.1, component 19): the case study as one more
// sheet of the same poster. A crumb back to the works section it sits in,
// with its place there; the title at poster scale with "(medium, when)" in
// the signal; the summary and the work's links on the left and a ruled fact
// sheet on the right; Fig. 1, the cover, with its caption beside it; what
// the work is; the case as numbered specification rows, only the parts the
// owner wrote, the decisions a ruled table (Decision, Why, Instead of); the
// records it cites "On the record"; and the next case at display size, or
// the way back to its works section with the others there. It prints as one
// more résumé page.

/** Each part's word: the case reads as the owner's account, in the order the work happened. */
const PART_WORDS: Readonly<Record<CaseStudyPart['key'], string>> = {
  challenge: 'Challenge',
  context: 'Context',
  role: 'Role',
  constraints: 'Constraints',
  decisions: 'Decisions',
  evidence: 'Evidence',
  outcomes: 'Outcomes',
  reflection: 'Reflection',
};

type Study = CaseStudyPageProps['work']['caseStudy'];

/** What a cited record is called in a list: its title, else who said it or what it states. */
function citedLabel(entry: Evidence): string {
  if (present(entry.title)) return entry.title;
  return entry.publication ?? entry.organization ?? entry.statement ?? entry.id;
}

/**
 * One part's body: its words, or for the decisions, their ruled table. The
 * kit counts an Evidence part when the work cites records even where the
 * owner wrote no words for it, so that part lists the records, each a link to
 * its row On the record.
 */
function PartBody({
  part,
  study,
  input,
  lang,
  cited,
  citedId,
}: {
  part: CaseStudyPart;
  study: Study;
  input: VariantRenderInput;
  lang: 'en' | undefined;
  cited: readonly Evidence[];
  citedId: (id: string) => string;
}) {
  if (part.key === 'decisions') {
    return (
      <div className="ss-spec__wide">
        <RuledTable
          caption="Decisions"
          lang={lang}
          // Below 48rem Why and Instead of leave as columns and stand under
          // each decision as labelled lines, so a decision reads as one row.
          columns={DECISION_HEADS.map((label, index) => ({ label, span: 4, wide: index > 0 }))}
          rows={(study.decisions ?? []).map((decision, index) => ({
            key: String(index),
            narrow: (
              <dl className="ss-decision">
                {present(decision.rationale) ? (
                  <div>
                    <dt data-type-role="label">
                      <Words lang={lang}>{DECISION_HEADS[1]}</Words>
                    </dt>
                    <dd>
                      <Phrase source={decision.rationale} input={input} />
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt data-type-role="label">
                    <Words lang={lang}>{DECISION_HEADS[2]}</Words>
                  </dt>
                  <dd>
                    {present(decision.alternatives) ? (
                      <Phrase source={decision.alternatives} input={input} />
                    ) : (
                      <span className="ss-muted">
                        <Words lang={lang}>Not recorded</Words>
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            ),
            cells: [
              <span key="d" className="ss-strong">
                <Phrase source={decision.decision} input={input} />
              </span>,
              present(decision.rationale) ? (
                <Phrase key="w" source={decision.rationale} input={input} />
              ) : null,
              present(decision.alternatives) ? (
                <Phrase key="i" source={decision.alternatives} input={input} />
              ) : (
                <span key="i" className="ss-muted">
                  <Words lang={lang}>Not recorded</Words>
                </span>
              ),
            ],
          }))}
        />
      </div>
    );
  }
  const text = study[part.key];
  if (typeof text === 'string' && present(text))
    return <Prose source={text} input={input} className="ss-spec__text" />;
  if (part.key === 'evidence' && cited.length > 0) {
    return (
      <ul className="ss-spec__text ss-spec__cited" data-type-role="body">
        {cited.map((entry) => {
          const year = yearOf(entry.receivedAt ?? entry.publishedAt);
          // Who it's by, unless that's already its label: nothing renders where neither is left.
          const label = citedLabel(entry);
          const raw = entry.organization ?? entry.publication ?? entry.venue;
          const by = raw && raw !== label ? raw : undefined;
          return (
            <li key={entry.id} lang={entry.lang}>
              <a href={`#${citedId(entry.id)}`}>{label}</a>
              {by || year ? (
                <span className="ss-muted" data-type-role="body-compact">
                  {by}
                  {by && year ? ', ' : null}
                  {year ? <span className="ss-num">{year}</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  return null;
}

/** A record the work cites: a press quote, else an award or any other entry as a ruled row. */
function Cited({
  entry,
  input,
  lang,
}: {
  entry: Evidence;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  const quote = entry.excerpt ?? entry.statement;
  if (entry.type === 'press' && present(quote)) {
    return (
      <figure className="ss-press">
        <blockquote data-type-role="quote">
          <p>
            {'“'}
            <Phrase source={quote} input={input} />
            {'”'}
          </p>
        </blockquote>
        <figcaption data-type-role="body-compact">
          {present(entry.publication) ? (
            <span className="ss-strong">{entry.publication}</span>
          ) : null}
          <span className="ss-muted">
            {entry.author}
            {entry.author && entry.publishedAt ? ', ' : null}
            <When raw={entry.publishedAt} lang={lang} />
          </span>
          {present(entry.title) && entry.url ? (
            <a href={hrefFor(entry.url, input)}>
              {entry.title}
              <Out href={entry.url} />
            </a>
          ) : null}
        </figcaption>
      </figure>
    );
  }
  const title = present(entry.title) ? entry.title : (entry.statement ?? '');
  // Under a title, what it is: its description, else its statement (as the record's own tables read).
  const description = entry.description ?? (present(entry.title) ? entry.statement : undefined);
  const by = entry.organization ?? entry.publication ?? entry.venue;
  const year = yearOf(entry.receivedAt ?? entry.publishedAt);
  return (
    <div className="ss-cited">
      <p className="ss-cited__main">
        <span className="ss-strong" data-type-role="title">
          {entry.url ? (
            <a href={hrefFor(entry.url, input)}>
              {title}
              <Out href={entry.url} />
            </a>
          ) : (
            title
          )}
        </span>
        {present(description) ? (
          <span className="ss-sub" data-type-role="body">
            <Phrase source={description} input={input} />
          </span>
        ) : null}
      </p>
      {by || year ? (
        <p className="ss-cited__by" data-type-role="body-compact">
          {by ? <span className="ss-strong">{by}</span> : null}
          {year ? <span className="ss-num">{year}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const own = (name: string) => ownId(prefix, `case-${name}`);
  const home = routeHref(input, { route: 'home' });
  const place = caseHome(work, input);
  const homeHref = (anchor: string) => `${home}#${anchor}`;
  const [title, authoredAside] = (() => {
    const split = splitAside(work.title);
    return [split.text, split.aside];
  })();
  const asideParts = caseAsideParts(work);
  const derived =
    asideParts.medium || asideParts.when ? (
      <Words lang={lang}>
        {asideParts.medium}
        {asideParts.medium && asideParts.when ? ', ' : null}
        {asideParts.when ? <span className="ss-nowrap">{asideParts.when}</span> : null}
      </Words>
    ) : null;
  // A long title is set in sentence case at step 5 already; the word fit is for uppercase lines (as poster.tsx).
  const length = lengthClass(title);
  const fits = length !== 'long' && wordClass(title) === 'long';
  const cited = evidenceByIds(work.evidence, input);
  const citedId = (id: string) => own(`cited-${id}`);
  const facts = caseFacts(work, cited);
  const cover = readyImage(work.cover, input);
  // The work's own images after the cover, numbered on from Fig. 1, each
  // holding its place as the kit's box while its image is unavailable.
  const plates = (work.media ?? []).flatMap((placement) => {
    if (placement.asset === work.cover?.asset) return [];
    const placed = placedImage(placement, input);
    return placed ? [{ placement, placed }] : [];
  });
  const firstPlate = cover ? 2 : 1;
  const study = work.caseStudy;
  const parts = partsOf(input, () => pageOutline(input));
  const next = outline.next;
  const back =
    (place && pageOutline(input).sections.find((entry) => entry.id === place.section.id)?.href) ??
    outline.home;
  return (
    <div className="ss ss--case">
      <Masthead input={input} />
      <Position prefix={prefix} />
      <main id={input.ids.main} className="ss-main" tabIndex={-1}>
        <article className="ss-case" aria-labelledby={own('title')} lang={work.lang}>
          <div className="ss-grid">
            <p className="ss-crumb" data-type-role="body-compact">
              <a href={back}>{place?.title ?? <Words lang={lang}>Work</Words>}</a>
              {place && place.position > 0 ? (
                <span className="ss-num">
                  <Words lang={lang}>
                    {`No. ${formatNumber(place.position, input.portfolio.locale)} of ${formatNumber(place.total, input.portfolio.locale)}, case study`}
                  </Words>
                </span>
              ) : null}
            </p>
          </div>
          <div className="ss-grid ss-poster__grid ss-case__poster">
            {/* The h1 is the work's own title, its authored aside included and
                nothing the page derives: "(software, 2022–now)" stands beside it
                on the poster line, outside the heading (ci:variants, case-study:
                the title the one h1). */}
            <div
              className="ss-poster__line"
              data-length={length}
              data-word={fits ? 'long' : undefined}
              style={length !== 'long' ? (wordFit(title) as CSSProperties) : undefined}
            >
              <h1 className="ss-case__title" id={own('title')}>
                <span className="ss-poster__text" data-type-role="display">
                  {title}
                </span>
                {authoredAside ? (
                  <>
                    {' '}
                    <Paren signal className="ss-poster__aside">
                      {authoredAside}
                    </Paren>
                  </>
                ) : null}
              </h1>
              {!authoredAside && derived ? (
                <>
                  {' '}
                  <Paren signal className="ss-poster__aside">
                    {derived}
                  </Paren>
                </>
              ) : null}
            </div>
            <div className="ss-poster__left">
              {present(work.summary) ? (
                <p className="ss-poster__lede" data-type-role="quote">
                  <Phrase source={work.summary} input={input} />
                </p>
              ) : null}
              {work.links?.length ? (
                <p className="ss-links ss-case__links" data-type-role="body">
                  {work.links.map((link) => (
                    <a key={link.url} href={hrefFor(link.url, input)}>
                      {link.label ?? link.platform ?? link.url}
                      <Out href={link.url} />
                    </a>
                  ))}
                </p>
              ) : null}
            </div>
            {facts.length > 0 ? (
              <section className="ss-case__facts" aria-labelledby={own('facts')}>
                <h2 className="ss-hidden" id={own('facts')}>
                  <Words lang={lang}>Facts</Words>
                </h2>
                <dl className="ss-dl" data-type-role="body-compact">
                  {facts.map((fact, index) => (
                    <div key={`${fact.term}-${index}`}>
                      <dt>
                        <Words lang={lang}>{fact.term}</Words>
                      </dt>
                      <dd className={fact.numeric ? 'ss-num' : undefined}>
                        {fact.term === 'Medium' || fact.term === 'Period' ? (
                          <Words lang={lang}>{fact.value}</Words>
                        ) : (
                          fact.value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </div>
          {cover ? (
            <div className="ss-grid">
              <figure className="ss-case__figure">
                <Img
                  placed={{ ...cover, caption: undefined }}
                  input={input}
                  sizes="(max-width: 48rem) 100vw, 66vw"
                  eager
                />
                <figcaption data-type-role="body-compact">
                  <span className="ss-strong">
                    <Words lang={lang}>Fig. 1</Words>
                  </span>
                  {/* The owner's caption for the cover where there is one; else what it is. */}
                  <span>
                    {coverCaption(work) ?? (
                      <>
                        {title}
                        <Words lang={lang}>, cover.</Words>
                      </>
                    )}
                  </span>
                </figcaption>
              </figure>
            </div>
          ) : null}
          {present(work.description) ? (
            <section className="ss-grid ss-overview" aria-labelledby={own('overview')}>
              <h2 className="ss-hidden" id={own('overview')}>
                <Words lang={lang}>Overview</Words>
              </h2>
              <Prose source={work.description} input={input} className="ss-overview__text" />
            </section>
          ) : null}
          {outline.parts.length > 0 ? (
            <section className="ss-grid ss-case__spec" aria-labelledby={own('parts')}>
              <header className="ss-head">
                <h2 className="ss-head__title" id={own('parts')} data-type-role="title">
                  <Words lang={lang}>The case</Words>{' '}
                  <Paren signal>
                    <Words lang={lang}>
                      {`${formatNumber(outline.parts.length, input.portfolio.locale)} ${outline.parts.length === 1 ? 'part' : 'parts'}`}
                    </Words>
                  </Paren>
                </h2>
              </header>
              <ol className="ss-spec">
                {outline.parts.map((part, index) => (
                  <li key={part.key} className="ss-spec__row" id={part.anchor}>
                    <span
                      className="ss-spec__no ss-num"
                      data-type-role="numeric"
                      aria-hidden="true"
                    >
                      {formatNumber(index + 1, input.portfolio.locale)}
                    </span>
                    <h3 className="ss-spec__name" data-type-role="title">
                      <Words lang={lang}>{PART_WORDS[part.key]}</Words>
                    </h3>
                    <PartBody
                      part={part}
                      study={study}
                      input={input}
                      lang={lang}
                      cited={cited}
                      citedId={citedId}
                    />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {plates.length > 0 ? (
            <section className="ss-grid ss-case__plates" aria-labelledby={own('plates')}>
              <header className="ss-head">
                <h2 className="ss-head__title" id={own('plates')} data-type-role="title">
                  <Words lang={lang}>Figures</Words>{' '}
                  <Paren signal>{formatNumber(plates.length, input.portfolio.locale)}</Paren>
                </h2>
              </header>
              {plates.map(({ placement, placed }, index) => {
                const caption = placement.caption ?? placed.alt;
                return (
                  <figure key={index} className="ss-case__figure">
                    <Img placed={placed} input={input} sizes="(max-width: 48rem) 100vw, 66vw" />
                    <figcaption data-type-role="body-compact">
                      <span className="ss-strong">
                        <Words lang={lang}>
                          {`Fig. ${formatNumber(firstPlate + index, input.portfolio.locale)}`}
                        </Words>
                      </span>
                      {present(caption) ? <span>{caption}</span> : null}
                    </figcaption>
                  </figure>
                );
              })}
            </section>
          ) : null}
          {cited.length > 0 ? (
            <section className="ss-grid ss-case__record" aria-labelledby={own('record')}>
              <header className="ss-head">
                <h2 className="ss-head__title" id={own('record')} data-type-role="title">
                  <Words lang={lang}>On the record</Words>{' '}
                  <Paren signal>{formatNumber(cited.length, input.portfolio.locale)}</Paren>
                </h2>
              </header>
              <ul className="ss-case__cited">
                {cited.map((entry) => (
                  <li key={entry.id} id={citedId(entry.id)} lang={entry.lang}>
                    <Cited entry={entry} input={input} lang={lang} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="ss-grid ss-next__frame">
            <nav className="ss-next" aria-labelledby={own('next')}>
              <p className="ss-next__lead" id={own('next')} data-type-role="body-compact">
                <Words lang={lang}>{next ? 'Next case study' : 'Back to the index'}</Words>
              </p>
              <a
                className="ss-next__link"
                data-type-role="display"
                href={next ? next.href : back}
                lang={next?.lang}
                style={
                  wordFit(
                    next ? splitAside(next.title).text : (place?.title ?? 'All work'),
                  ) as CSSProperties
                }
              >
                {next
                  ? splitAside(next.title).text
                  : (place?.title ?? <Words lang={lang}>All work</Words>)}
              </a>
              {!next && place && place.others.length > 0 ? (
                <ul className="ss-next__others" data-type-role="body">
                  {place.others.map((other) => {
                    const when = workWhen(other);
                    const medium = mediumWord(other);
                    return (
                      <li key={other.id} lang={other.lang}>
                        <a
                          href={homeHref(
                            recordAnchor(place.section, other, input) ??
                              `${prefix}${place.section.id}`,
                          )}
                        >
                          {splitAside(other.title).text}
                        </a>
                        {medium || when ? (
                          <span className="ss-muted ss-num" data-type-role="body-compact">
                            {medium ? <Words lang={lang}>{medium}</Words> : null}
                            {medium && when ? ', ' : null}
                            {when?.text}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </nav>
          </div>
        </article>
      </main>
      <IndexSheet input={input} parts={parts} />
      <Colophon input={input} />
    </div>
  );
}

export { CaseStudyPage };
