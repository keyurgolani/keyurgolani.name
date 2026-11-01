import type { ReactNode } from 'react';
import { present, type CaseStudyPageProps } from '@portfolio/kit/sections';
import { Book as BookPage, Folios, Page } from './chrome';
import { chapterHalf, contentsHalf, DropCap, Turnstile, type TurnHalf } from './chapter';
import { documentHref, Picture } from './media';
import { buildBook, headPage, listed, spelled } from './model/book';
import {
  ANCHORS,
  chapterHref,
  idOf,
  locatorHref,
  Md,
  Out,
  cite,
  Unbroken,
  When,
  type Input,
} from './text';

// The case study is a section of its chapter, tipped in at its plate: its leaves are
// numbered from the plate's page, 11a to 11h, so none takes a page of the chapter's own.
// The fact sheet facing the
// plate, the story in two balanced columns with run-in heads, decisions set
// across the gutter (what was decided on the verso, why and instead of what
// on the recto), then what changed, the afterword, and praise for the work.
// Its heads are the book's own words, not the outline's.

const HEADS = {
  challenge: 'The trouble',
  context: 'The setting',
  role: 'My part',
  constraints: 'The limits',
  evidence: 'What changed',
  outcomes: 'What it led to',
} as const;

function RunIn({
  head,
  source,
  input,
  id,
}: {
  head: string;
  source: string | undefined;
  input: Input;
  id: string;
}) {
  if (!present(source)) return null;
  return (
    <section className="ri" id={id} aria-label={head}>
      <h2 className="ri__h" data-type-role="title">
        {head}.
      </h2>{' '}
      <Md source={source} input={input} className="ri__text" role="body" />
    </section>
  );
}

export function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const book = buildBook(input);
  const at = book.printed.get(work.id);
  const chapter = at?.chapter ?? undefined;
  const study = work.caseStudy;
  const anchor = (key: string) =>
    outline.parts.find((part) => part.key === key)?.anchor ?? idOf(input, `${work.id}--${key}`);
  const first = at?.page ?? book.backStart;
  // The plate's own image when there's no cover (its caption is that image's), then the rest.
  const lead = work.cover ? undefined : work.media?.[0];
  const more = (work.media ?? []).filter((placement) => placement !== lead);
  const evidence = (work.evidence ?? []).flatMap((id) => {
    const found = input.portfolio.evidence.find((e) => e.id === id);
    return found ? [found] : [];
  });
  const facts: [string, ReactNode][] = [];
  if (work.role) facts.push(['Role', work.role]);
  if (work.period?.start)
    facts.push(['Since', <When key="s" raw={work.period.start} input={input} />]);
  if (work.tools?.length) facts.push(['Made with', listed(work.tools)]);
  if (work.links?.length)
    facts.push([
      'Links',
      <>
        {work.links.map((link, i) => (
          <span key={link.url}>
            {i > 0 ? ', ' : null}
            <Out url={link.url} input={input}>
              {link.label ?? link.platform ?? link.url}
            </Out>
          </span>
        ))}
      </>,
    ]);
  // P2-D: a fact sheet names each label once, so the citations share one Recognized row.
  if (evidence.length > 0)
    facts.push([
      'Recognized',
      <>
        {evidence.map((e, i) => {
          const where = book.printed.get(e.id);
          return (
            <span key={e.id}>
              {i > 0 ? '; ' : null}
              {e.title ?? e.statement}
              {e.publication || e.venue ? (
                <>
                  , <i>{e.publication ?? e.venue}</i>
                </>
              ) : null}
              {where ? (
                <>
                  , <a href={locatorHref(input, where)}>{cite(book, where)}</a>
                </>
              ) : null}
            </span>
          );
        })}
      </>,
    ]);
  const praise = evidence.filter(
    (e) => present(e.excerpt) || (e.type === 'testimonial' && present(e.statement)),
  );
  const nextPart = chapter
    ? chapter.parts
        .slice(chapter.parts.findIndex((p) => p.key === work.id) + 1)
        .find((p) => p.type === 'plate' || p.type === 'series')
    : undefined;
  const next: TurnHalf | undefined =
    chapter && nextPart
      ? {
          href: chapterHref(input, chapter, nextPart.key),
          dir: `Next in chapter ${spelled(chapter.n)}`,
          title: nextPart.title,
          sub: book.options.folios ? `page ${headPage(nextPart)}` : chapter.title,
        }
      : undefined;
  const story =
    [study.challenge, study.context, study.role, study.constraints].some(present) ||
    present(work.description);
  const after =
    present(study.evidence) ||
    present(study.outcomes) ||
    present(study.reflection) ||
    praise.length > 0;
  return (
    <BookPage input={input} book={book} here={{ view: 'work', chapter }} ink={chapter?.ink ?? 0}>
      <article className="ch-case" aria-labelledby={idOf(input, `${ANCHORS.case}-h`)}>
        <div className="ch-spread ch-spread--casehead" id={idOf(input, ANCHORS.case)}>
          <Page side="verso">
            {chapter && at ? (
              <p className="cs-from ch-caps">
                <a href={locatorHref(input, at)}>
                  Chapter {chapter.n}: {chapter.title}
                  {book.options.folios ? `, page ${at.page}` : null}
                </a>
              </p>
            ) : null}
            <h1 className="cs-title" id={idOf(input, `${ANCHORS.case}-h`)} data-type-role="display">
              {work.title}
            </h1>
            <Md source={work.summary} input={input} className="cs-lede" role="quote" />
            {facts.length > 0 ? (
              <dl className="ch-facts" data-type-role="body-compact">
                {facts.map(([term, value], i) => (
                  <div key={`${term}-${i}`}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </Page>
          <span className="ch-gutter" aria-hidden="true" />
          <Page side="recto">
            {work.cover || work.media?.length ? (
              <figure className="pl">
                <Picture
                  placement={work.cover ?? work.media?.[0]}
                  input={input}
                  className="pl__img"
                  eager
                />
                <figcaption className="pl__cap" data-type-role="caption">
                  {chapter ? <span className="pl__no">Plate {chapter.n}.1</span> : null}{' '}
                  <span>
                    {present(lead?.caption) ? lead.caption : work.title}
                    {present(lead?.caption) && lead.location ? `, ${lead.location}` : null}.
                  </span>
                </figcaption>
              </figure>
            ) : null}
            {more.length > 0 ? (
              // P1-9: the work's other media, each a plate lettered from the insert's own,
              // Plate 3.1a, 3.1b, never a chapter's number; a document links to its file when
              // the view publishes one, its caption the link's text.
              <div className="cs-more">
                {more.map((placement, i) => {
                  const no = chapter ? (
                    <span className="pl__no">
                      Plate {chapter.n}.1{String.fromCharCode(97 + i)}
                    </span>
                  ) : null;
                  const caption = present(placement.caption) ? placement.caption : work.title;
                  if (input.media[placement.asset]?.kind === 'image') {
                    return (
                      <figure key={placement.asset} className="pl pl--more">
                        <Picture placement={placement} input={input} className="pl__img" />
                        <figcaption className="pl__cap" data-type-role="caption">
                          {no}{' '}
                          <span>
                            {caption}
                            {placement.location ? `, ${placement.location}` : null}.
                          </span>
                        </figcaption>
                      </figure>
                    );
                  }
                  const href = documentHref(placement, input);
                  return (
                    <figure key={placement.asset} className="pl pl--doc">
                      <figcaption className="pl__cap" data-type-role="caption">
                        {no} {href ? <a href={href}>{caption}</a> : caption}.
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            ) : null}
            {work.highlights?.length ? (
              <ul className="pl__hl ch-bars" role="list" data-type-role="body-compact">
                {work.highlights.map((h, i) => (
                  <li key={i}>
                    <Unbroken text={h} />
                  </li>
                ))}
              </ul>
            ) : null}
          </Page>
          <Folios verso={`${first}a`} recto={`${first}b`} />
        </div>
        {story ? (
          <div
            className="ch-spread ch-spread--flow ch-spread--prose"
            id={idOf(input, ANCHORS.story)}
          >
            <div className="fl fl--prose">
              <DropCap source={work.description} input={input} className="cs-desc" />
              {(['challenge', 'context', 'role', 'constraints'] as const).map((key) => (
                <RunIn
                  key={key}
                  head={HEADS[key]}
                  source={study[key]}
                  input={input}
                  id={anchor(key)}
                />
              ))}
            </div>
            <Folios verso={`${first}c`} recto={`${first}d`} joined />
          </div>
        ) : null}
        {study.decisions?.length ? (
          <section
            className="ch-spread ch-spread--decisions"
            id={anchor('decisions')}
            aria-labelledby={idOf(input, `${ANCHORS.decisions}-h`)}
          >
            <span className="ch-gutter" aria-hidden="true" />
            <div className="dc__head">
              <h2
                className="dc__h"
                id={idOf(input, `${ANCHORS.decisions}-h`)}
                data-type-role="headline"
              >
                Decisions
              </h2>
            </div>
            <ol className="dc__list" role="list">
              {study.decisions.map((decision, i) => (
                <li key={i} className="dc">
                  <div className="dc__v">
                    <span className="dc__n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <h3 className="dc__t" data-type-role="title">
                      <Md source={decision.decision} input={input} inline />
                    </h3>
                  </div>
                  <div className="dc__r">
                    {present(decision.rationale) ? (
                      <div className="dc__why" data-type-role="body">
                        <b>Why.</b> <Md source={decision.rationale} input={input} inline />
                      </div>
                    ) : null}
                    {present(decision.alternatives) ? (
                      <p className="dc__alt" data-type-role="body-compact">
                        <b>Instead of</b>{' '}
                        <Md
                          source={decision.alternatives.replace(/^(A|An|The)\b/, (word) =>
                            word.toLowerCase(),
                          )}
                          input={input}
                          inline
                        />
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            <Folios verso={`${first}e`} recto={`${first}f`} joined />
          </section>
        ) : null}
        {after ? (
          <div className="ch-spread ch-spread--after" id={idOf(input, ANCHORS.after)}>
            <Page side="verso">
              <RunIn
                head={HEADS.evidence}
                source={study.evidence}
                input={input}
                id={anchor('evidence')}
              />
              <RunIn
                head={HEADS.outcomes}
                source={study.outcomes}
                input={input}
                id={anchor('outcomes')}
              />
            </Page>
            <span className="ch-gutter" aria-hidden="true" />
            <Page side="recto">
              {present(study.reflection) ? (
                <section
                  className="aw"
                  id={anchor('reflection')}
                  aria-labelledby={idOf(input, 'ch--afterword-h')}
                >
                  <h2 className="aw__h ch-caps" id={idOf(input, 'ch--afterword-h')}>
                    Afterword
                  </h2>
                  <Md source={study.reflection} input={input} className="aw__text" role="quote" />
                </section>
              ) : null}
              {praise.map((e) => (
                <figure key={e.id} className="cs-praise">
                  <blockquote data-type-role="quote">
                    <Md source={e.excerpt ?? e.statement} input={input} />
                  </blockquote>
                  <figcaption data-type-role="body-compact">
                    {[e.author ?? e.source?.name, e.publication].filter(Boolean).join(', ')}
                    {e.publishedAt ? (
                      <>
                        , <When raw={e.publishedAt} input={input} />
                      </>
                    ) : null}
                  </figcaption>
                </figure>
              ))}
            </Page>
            <Folios verso={`${first}g`} recto={`${first}h`} />
          </div>
        ) : null}
      </article>
      <Turnstile
        input={input}
        prev={
          chapter
            ? {
                ...chapterHalf(input, chapter, 'Back to the chapter'),
                href: locatorHref(input, at!),
                sub: book.options.folios ? `page ${at!.page}` : `chapter ${chapter.n}`,
              }
            : contentsHalf(input)
        }
        next={next}
      />
    </BookPage>
  );
}
