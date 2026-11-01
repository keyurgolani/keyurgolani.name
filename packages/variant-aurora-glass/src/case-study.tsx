import type { ReactNode } from 'react';
import type { Evidence } from '@portfolio/schema';
import {
  evidenceByIds,
  hrefFor,
  pageOutline,
  recordAnchor,
  type CaseStudyPageProps,
  type CaseStudyPart,
} from '@portfolio/kit/sections';
import { Enhancement } from '@portfolio/kit/enhancements';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Chrome } from './chrome/capsule';
import { IndexDialog } from './chrome/index-dialog';
import { openingHeading } from './hero';
import { bandsOf, caseFacts, caseHome, formatNumber, present, rangeOf, yearOf } from './model';
import { Img, Out, ownId, Phrase, Prose, readyImage, Tracks, uiLang, When, Words } from './parts';
import { Footer } from './renderers/horizon';
import { Sky } from './sky';
import { Pane } from './surfaces/pane';
import { Sheet } from './surfaces/sheet';
import { Shingle } from './surfaces/shingle';

// A work's own page (brief §5.2, step 10; S4): the case study as one more
// view through the same glass. The opening is the home's shingle again: the
// case pane, its crumb, the title as the display line inside the one h1,
// the summary, the owner's part in it and its links, with the fact sheet (a
// `dl`, S4) in the pane's foot where the home has its tiles; the cover is
// the sheet laid across the pane's end edge. Below, the case is one pane
// split into lites by mullions that show the sky, as every home band is:
// What it is, Before (the challenge and its context), the owner's part and
// its limits side by side, Choices (each with what it was chosen instead
// of), What changed (the outcomes and the evidence, a press quote shingled
// across it as a sheet and an award as a chip), and Looking back. Only the
// parts the owner wrote render. The page closes on the next case, else the
// related one by the tool they share, and the way back to all the work.

type Study = CaseStudyPageProps['work']['caseStudy'];

/** The parts' words, the composition's: the case reads as the owner's account, in the order it happened. */
const HEADS = {
  what: 'What it is',
  before: 'Before',
  role: 'My part',
  constraints: 'Within these limits',
  decisions: 'Choices',
  changed: 'What changed',
  reflection: 'Looking back',
} as const;

function Lite({
  id,
  head,
  lang,
  level = 3,
  className,
  children,
}: {
  id: string;
  head: string;
  lang: 'en' | undefined;
  level?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  const Heading = `h${level}` as 'h3';
  return (
    <section className={`ag-lite ag-sec ${className ?? ''}`.trim()} aria-labelledby={`${id}--h`}>
      <header className="ag-sec__head">
        <Heading className="ag-sec__title" id={`${id}--h`} data-type-role="title">
          <Words lang={lang}>{head}</Words>
        </Heading>
      </header>
      <div className="ag-sec__body">{children}</div>
    </section>
  );
}

/** The press quote a work cites, shingled across What changed as a sheet. */
function PressSheet({ entry, input }: { entry: Evidence; input: VariantRenderInput }) {
  const words = entry.excerpt ?? entry.statement;
  if (!present(words)) return null;
  const lang = uiLang(input.portfolio.locale);
  return (
    <Sheet as="figure" className="ag-case__press" lang={entry.lang}>
      <blockquote data-type-role="quote">
        <p>
          {'“'}
          <Phrase source={words} input={input} />
          {'”'}
        </p>
      </blockquote>
      <figcaption className="ag-case__press-by" data-type-role="caption">
        {present(entry.author) ? <span className="ag-strong">{entry.author}</span> : null}
        {present(entry.title) && entry.url ? (
          <a href={hrefFor(entry.url, input)}>
            {entry.title}
            <Out href={entry.url} />
          </a>
        ) : present(entry.title) ? (
          <span>{entry.title}</span>
        ) : null}
        {present(entry.publication) ? <span>{entry.publication}</span> : null}
        <When raw={entry.publishedAt} lang={lang} />
      </figcaption>
    </Sheet>
  );
}

function CaseStudyPage({ input, work, outline }: CaseStudyPageProps) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const own = (name: string) => ownId(prefix, `case-${name}`);
  const home = routeHref(input, { route: 'home' });
  const page = pageOutline(input);
  const bands = bandsOf(input, page);
  const place = caseHome(work, input);
  const back = place ? `${home}#${prefix}${place.section.id}` : outline.home;
  const cited = evidenceByIds(work.evidence, input);
  const facts = caseFacts(work, cited);
  const cover = readyImage(work.cover, input);
  const study: Study = work.caseStudy;
  const anchor = (key: CaseStudyPart['key']) =>
    outline.parts.find((part) => part.key === key)?.anchor;
  const press = cited.find(
    (entry) => entry.type === 'press' && present(entry.excerpt ?? entry.statement),
  );
  const awards = cited.filter((entry) => entry.type === 'award' && present(entry.title));
  // Every other record the work cites, as rows in What changed (the content sweep).
  const others = cited.filter((entry) => entry !== press && !awards.includes(entry));
  // Its pictures other than the cover, each with the owner's caption.
  // A picture that isn't ready shows its caption, and with none it isn't listed (low 6).
  const pictures = (work.media ?? []).filter(
    (media) =>
      media.asset !== work.cover?.asset &&
      (readyImage(media, input) !== undefined || present(media.caption)),
  );
  const reach = (work.highlights ?? []).filter(present);
  const before = present(study.challenge) || present(study.context);
  const limits = present(study.role) || present(study.constraints);
  const changed =
    present(study.outcomes) ||
    present(study.evidence) ||
    press ||
    awards.length > 0 ||
    others.length > 0;
  const decisions = study.decisions ?? [];
  const next = outline.next ?? outline.related[0];
  const nextShared = !outline.next ? outline.related[0]?.shared[0] : undefined;
  const nextCover = next?.cover;
  return (
    <div className="ag ag--case">
      <Sky input={input} />
      <Chrome input={input} bands={bands} />
      <main id={input.ids.main} className="ag-main" tabIndex={-1}>
        <article className="ag-case" aria-labelledby={openingHeading(input)} lang={work.lang}>
          <div className="ag-opening-frame">
            <Shingle className="ag-opening ag-case__opening" data-sheet={cover ? 'yes' : 'no'}>
              <Pane frost className="ag-id ag-case__pane">
                <div className="ag-id__top">
                  <nav className="ag-crumb" aria-label="Breadcrumb">
                    <ol role="list" data-type-role="label">
                      <li>
                        <a href={`${home}#${openingHeading(input)}`}>
                          {input.portfolio.identity.name}
                        </a>
                      </li>
                      {place ? (
                        <li>
                          <a href={back}>{place.title}</a>
                        </li>
                      ) : null}
                      <li aria-current="page">{work.title}</li>
                    </ol>
                  </nav>
                  <h1 className="ag-id__h1" id={openingHeading(input)}>
                    <span className="ag-id__line ag-case__title" data-type-role="display">
                      {work.title}
                    </span>
                  </h1>
                </div>
                <div className="ag-id__body">
                  {present(work.summary) ? (
                    <p className="ag-case__sum" data-type-role="title">
                      <Phrase source={work.summary} input={input} />
                    </p>
                  ) : null}
                  {work.links?.length ? (
                    <p className="ag-id__acts">
                      {work.links.map((link, index) => {
                        const href = hrefFor(link.url, input);
                        return (
                          <a
                            key={link.url}
                            className={index === 0 ? 'ag-btn' : 'ag-link'}
                            href={href}
                            data-type-role="label"
                          >
                            {link.label ?? link.platform ?? link.url}
                            <Out href={href} />
                          </a>
                        );
                      })}
                    </p>
                  ) : null}
                </div>
              </Pane>
              {cover ? (
                <Sheet as="figure" className="ag-sig ag-case__cover">
                  <div className="ag-sig__media">
                    <Img
                      placed={{ ...cover, caption: undefined }}
                      input={input}
                      sizes="(min-width: 64rem) 32rem, 100vw"
                      eager
                      className="ag-sig__img"
                    />
                  </div>
                  <figcaption className="ag-sig__body" data-type-role="caption">
                    <span className="ag-sig__kicker">
                      <Words lang={lang}>Cover</Words>
                    </span>
                    {/* The owner's caption alone: the image's alt is read already (low 6). */}
                    {cover.caption ? <> {cover.caption}</> : null}
                  </figcaption>
                </Sheet>
              ) : null}
              {facts.length > 0 ? (
                <section className="ag-facts" aria-labelledby={own('facts')}>
                  <h2 className="ag-hidden" id={own('facts')}>
                    <Words lang={lang}>In brief</Words>
                  </h2>
                  <dl className="ag-facts__list">
                    {facts.map((fact, index) => (
                      <div key={`${fact.term}-${index}`} className="ag-facts__row">
                        <dt data-type-role="label">
                          <Words lang={lang}>{fact.term}</Words>
                        </dt>
                        <dd
                          className={fact.numeric ? 'ag-num' : undefined}
                          data-type-role="body-compact"
                        >
                          {fact.own || fact.term === 'Period' ? (
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
            </Shingle>
          </div>

          <div className="ag-band ag-case__band" id={own('case')}>
            <div className="ag-band__pane">
              <header className="ag-lite ag-band__head">
                <h2 className="ag-band__title" id={own('case--h')} data-type-role="headline">
                  <Words lang={lang}>The case</Words>
                </h2>
                {outline.parts.length > 1 ? (
                  <nav className="ag-band__nav" aria-label="The case">
                    <ul role="list">
                      {[
                        before && (anchor('challenge') ?? anchor('context'))
                          ? { href: anchor('challenge') ?? anchor('context')!, head: HEADS.before }
                          : null,
                        limits && (anchor('role') ?? anchor('constraints'))
                          ? { href: anchor('role') ?? anchor('constraints')!, head: HEADS.role }
                          : null,
                        anchor('decisions')
                          ? { href: anchor('decisions')!, head: HEADS.decisions }
                          : null,
                        changed && (anchor('outcomes') ?? anchor('evidence'))
                          ? {
                              href: anchor('outcomes') ?? anchor('evidence')!,
                              head: HEADS.changed,
                            }
                          : null,
                        anchor('reflection')
                          ? { href: anchor('reflection')!, head: HEADS.reflection }
                          : null,
                      ]
                        .filter((item) => item !== null)
                        .map((item) => (
                          <li key={item.href}>
                            <a href={`#${item.href}`} data-type-role="label">
                              <Words lang={lang}>{item.head}</Words>
                            </a>
                          </li>
                        ))}
                    </ul>
                  </nav>
                ) : null}
              </header>

              {present(work.description) || reach.length > 0 || work.tracks?.length ? (
                <Lite id={own('what')} head={HEADS.what} lang={lang}>
                  {present(work.description) ? (
                    <Prose source={work.description} input={input} />
                  ) : null}
                  {reach.length > 0 ? (
                    <ul className="ag-case__reach" role="list" data-type-role="body-compact">
                      {reach.map((line) => (
                        <li key={line}>
                          <span className="ag-pip" aria-hidden="true" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {work.tracks?.length ? <Tracks tracks={work.tracks} input={input} /> : null}
                </Lite>
              ) : null}

              {pictures.length > 0 ? (
                <Lite
                  id={own('pictures')}
                  head="Pictures"
                  lang={lang}
                  className="ag-case__pictures"
                >
                  <ul className="ag-case__gallery" role="list">
                    {pictures.map((media, index) => {
                      const placed = readyImage(media, input);
                      return (
                        <li key={`${media.asset}-${index}`}>
                          {placed ? (
                            <Img
                              placed={placed}
                              input={input}
                              sizes="(min-width: 64rem) 30rem, 100vw"
                              inline={false}
                              className="ag-case__img"
                            />
                          ) : present(media.caption) ? (
                            <p data-type-role="body-compact">{media.caption}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </Lite>
              ) : null}

              {before ? (
                <Lite
                  id={own('before')}
                  head={HEADS.before}
                  lang={lang}
                  className="ag-case__before"
                >
                  {present(study.challenge) ? (
                    <div id={anchor('challenge')} className="ag-case__lead">
                      <Prose source={study.challenge} input={input} role="title" />
                    </div>
                  ) : null}
                  {present(study.context) ? (
                    <div id={anchor('context')} className="ag-case__aside">
                      <Prose source={study.context} input={input} role="body" />
                    </div>
                  ) : null}
                </Lite>
              ) : null}

              {limits ? (
                <ul className="ag-lites ag-case__limits" role="list">
                  {present(study.role) ? (
                    <li className="ag-lite ag-case__limit" id={anchor('role')}>
                      <h3 data-type-role="label">
                        <Words lang={lang}>{HEADS.role}</Words>
                      </h3>
                      <Prose source={study.role} input={input} />
                    </li>
                  ) : null}
                  {present(study.constraints) ? (
                    <li className="ag-lite ag-case__limit" id={anchor('constraints')}>
                      <h3 data-type-role="label">
                        <Words lang={lang}>{HEADS.constraints}</Words>
                      </h3>
                      <Prose source={study.constraints} input={input} />
                    </li>
                  ) : null}
                </ul>
              ) : null}

              {decisions.length > 0 ? (
                <Lite id={own('choices')} head={HEADS.decisions} lang={lang}>
                  <ol className="ag-rows ag-case__choices" id={anchor('decisions')}>
                    {decisions.map((decision, index) => (
                      <li key={index} className="ag-row ag-choice">
                        <p className="ag-choice__what" data-type-role="title">
                          <Phrase source={decision.decision} input={input} />
                        </p>
                        {present(decision.rationale) ? (
                          <div className="ag-choice__why">
                            <Prose source={decision.rationale} input={input} role="body" />
                          </div>
                        ) : null}
                        {present(decision.alternatives) ? (
                          <p className="ag-choice__instead" data-type-role="body-compact">
                            <span className="ag-choice__label" data-type-role="label">
                              <Words lang={lang}>Instead of</Words>
                            </span>{' '}
                            <Phrase source={decision.alternatives} input={input} />
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </Lite>
              ) : null}

              {changed ? (
                <section
                  className="ag-sec ag-sec--split ag-case__changed"
                  aria-labelledby={`${own('changed')}--h`}
                >
                  <header className="ag-sec__head">
                    <h3
                      className="ag-sec__title"
                      id={`${own('changed')}--h`}
                      data-type-role="title"
                    >
                      <Words lang={lang}>{HEADS.changed}</Words>
                    </h3>
                  </header>
                  {/* The evidence part counts cited records too: with no evidence text, its anchor is the shingle's. */}
                  <div
                    className="ag-case__shingle"
                    data-press={press ? 'yes' : 'no'}
                    id={present(study.evidence) ? undefined : anchor('evidence')}
                  >
                    <div className="ag-lite ag-case__outcome">
                      {present(study.outcomes) ? (
                        <div id={anchor('outcomes')} className="ag-case__lead">
                          <Prose source={study.outcomes} input={input} role="title" />
                        </div>
                      ) : null}
                      {present(study.evidence) ? (
                        <div id={anchor('evidence')}>
                          <Prose source={study.evidence} input={input} />
                        </div>
                      ) : null}
                      {others.length > 0 ? (
                        <ul className="ag-rows ag-case__cited" role="list">
                          {others.map((entry) => {
                            const url =
                              entry.url ?? entry.links?.find((link) => present(link.url))?.url;
                            const name = [entry.title, entry.publication, entry.organization].find(
                              present,
                            );
                            const where = [
                              entry.venue,
                              entry.publication,
                              entry.organization,
                              entry.location,
                            ]
                              .filter(present)
                              .filter((part) => part !== name);
                            return (
                              <li key={entry.id} className="ag-row" lang={entry.lang}>
                                {name ? (
                                  <p className="ag-row__title" data-type-role="title">
                                    {url ? (
                                      <a href={hrefFor(url, input)}>
                                        {name}
                                        <Out href={url} />
                                      </a>
                                    ) : (
                                      name
                                    )}
                                  </p>
                                ) : null}
                                {where.length > 0 ? (
                                  <p className="ag-row__where" data-type-role="caption">
                                    {[...new Set(where)].map((part) => (
                                      <span key={part}>{part}</span>
                                    ))}
                                  </p>
                                ) : null}
                                {present(entry.statement ?? entry.description) ? (
                                  <p className="ag-row__sum" data-type-role="body-compact">
                                    <Phrase
                                      source={(entry.statement ?? entry.description)!}
                                      input={input}
                                    />
                                  </p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {awards.length > 0 ? (
                        <ul className="ag-case__awards" role="list">
                          {awards.map((award) => (
                            <li key={award.id} className="ag-chip" data-type-role="label">
                              {yearOf(award.receivedAt) ? (
                                <span className="ag-num ag-case__year">
                                  {yearOf(award.receivedAt)}
                                </span>
                              ) : null}{' '}
                              {[award.title, award.organization].filter(present).join(', ')}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    {press ? <PressSheet entry={press} input={input} /> : null}
                  </div>
                </section>
              ) : null}

              {present(study.reflection) ? (
                <Lite
                  id={own('reflection')}
                  head={HEADS.reflection}
                  lang={lang}
                  className="ag-case__back"
                >
                  <div id={anchor('reflection')}>
                    <Prose source={study.reflection} input={input} role="quote" />
                  </div>
                </Lite>
              ) : null}
            </div>
          </div>

          <nav className="ag-band ag-case__next" aria-labelledby={own('next')}>
            <h2 className="ag-hidden" id={own('next')}>
              <Words lang={lang}>More work</Words>
            </h2>
            <div className="ag-case__next-row">
              {next ? (
                <Sheet as="div" className="ag-case__next-sheet" lang={next.lang}>
                  {nextCover ? (
                    <div className="ag-sig__media">
                      <Img
                        placed={{ ...nextCover, caption: undefined }}
                        input={input}
                        sizes="(min-width: 64rem) 40rem, 100vw"
                        decorative
                        className="ag-sig__img"
                      />
                    </div>
                  ) : null}
                  <div className="ag-sig__body">
                    <p className="ag-sig__kicker" data-type-role="caption">
                      <Words lang={lang}>
                        {outline.next
                          ? 'Next case study'
                          : nextShared
                            ? `Related work, also made with ${nextShared}`
                            : 'Related work'}
                      </Words>
                    </p>
                    <p className="ag-case__next-title" data-type-role="headline">
                      <a className="ag-stretch" href={next.href}>
                        {next.title}
                      </a>
                    </p>
                  </div>
                </Sheet>
              ) : null}
              {/* All work, with the section's other works as rows beside it (the approval's item 2). */}
              <div className="ag-band__pane ag-case__more">
                <div className="ag-lite ag-case__all">
                  <p className="ag-case__all-title" data-type-role="title">
                    <a href={back}>
                      <Words lang={lang}>All work</Words>
                    </a>
                  </p>
                  {place ? (
                    <p className="ag-case__all-where" data-type-role="body-compact">
                      {place.title}
                      <Words lang={lang}>
                        {`, ${formatNumber(place.count, input.portfolio.locale)} ${place.count === 1 ? 'work' : 'works'}`}
                      </Words>
                    </p>
                  ) : null}
                </div>
                {place && place.others.length > 0 ? (
                  <ul className="ag-lite ag-rows ag-case__others" role="list">
                    {place.others.map((other) => {
                      const anchorId = recordAnchor(place.section, other, input);
                      const when = rangeOf(other.period)?.text;
                      return (
                        <li key={other.id} className="ag-row" lang={other.lang}>
                          <p className="ag-row__title" data-type-role="title">
                            <a href={`${home}#${anchorId ?? `${prefix}${place.section.id}`}`}>
                              {other.title}
                            </a>
                          </p>
                          {present(other.summary) ? (
                            <p className="ag-row__sum" data-type-role="body-compact">
                              <Phrase source={other.summary} input={input} />
                            </p>
                          ) : null}
                          {when ? (
                            <p className="ag-row__date ag-num" data-type-role="caption">
                              {when}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          </nav>
        </article>
      </main>
      <Footer input={input} />
      <IndexDialog input={input} bands={bands} />
      <Enhancement input={input} id="sky" />
    </div>
  );
}

export { CaseStudyPage };
