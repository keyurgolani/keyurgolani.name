import {
  chronologyOf,
  frameAttributes,
  isRoutedWork,
  present,
  type HomePageProps,
} from '@portfolio/kit/sections';
import { routeHref } from '@portfolio/variant-contract';
import { Book as BookPage, Folios, Page } from './chrome';
import { metricParts } from './entries';
import { Picture } from './media';
import { buildBook, listed, spelled, type Book, type BookRecord } from './model/book';
import {
  ANCHORS,
  backHref,
  bookHref,
  chapterHref,
  homeHref,
  idOf,
  joined,
  locatorHref,
  Md,
  Out,
  plain,
  Sub,
  TITLE_FROM,
  titleFrom,
  Unbroken,
  When,
  Words,
  type Input,
} from './text';
import { DropCap } from './chapter';

// Home is the front matter: the title page set from the thesis, facing the
// signature work as its frontispiece, with the imprint along their foot
// (pages i and ii); then the contents facing the preface (iii and iv).

function TitlePage({ input, book, notice }: { input: Input; book: Book; notice?: string }) {
  const { identity } = input.portfolio;
  const { hero, thesisSection, title, subtitle, signature, proof, proofSections } = book.front;
  // A section that prints nowhere but here frames its own records (proofSections).
  const framedProof = new Set(proofSections.flatMap(({ records }) => records.map((r) => r.id)));
  const loose = proof.filter((record) => !framedProof.has(record.id));
  const proofItem = (record: BookRecord) => {
    if (record.type === 'evidence' && record.evidence.type === 'metric') {
      const { figure, rest } = metricParts(record.evidence, input);
      return (
        <li key={record.id}>
          <span className="tp-proof__n" data-type-role="numeric">
            {figure}
          </span>
          <span>
            <Unbroken text={rest} />
          </span>
        </li>
      );
    }
    const e = record.type === 'evidence' ? record.evidence : undefined;
    const at = book.printed.get(record.id);
    // The link is on the record's name; a titled record's words follow it as Markdown:
    // "Shipyard. Thirty teams deploy with it." An untitled one's name is its statement's words.
    const words = e?.statement ?? e?.description;
    const said = e?.title && present(words) ? words : undefined;
    const text =
      record.type === 'work'
        ? record.work.title
        : [e?.title ?? plain(e?.statement), e?.organization].filter(present).join(', ');
    return (
      <li key={record.id}>
        <span className="tp-proof__n" data-type-role="numeric">
          {e?.receivedAt ? <When raw={e.receivedAt} input={input} /> : null}
        </span>
        <span>
          {at ? <a href={locatorHref(input, at)}>{text}</a> : text}
          {said ? (
            <>
              . <Words source={said} input={input} />
            </>
          ) : null}
        </span>
      </li>
    );
  };
  // Where the title came from prints in the colophon (P2-10), and names the thesis's article.
  const thesisFrom = titleFrom(input, book);
  const thesisFromId = idOf(input, TITLE_FROM);
  const first = book.chapters[0];
  const heroFrame = hero ? frameAttributes(hero, input, true) : {};
  const ctas = (hero?.ctas ?? []).filter((cta) => present(cta.label));
  const heading = (
    <>
      <h1 className="tp-title" data-type-role="display">
        {title}
      </h1>
      {present(subtitle) ? (
        <p className="tp-sub" data-type-role="quote">
          {subtitle}
        </p>
      ) : null}
    </>
  );
  const sigAt = signature ? book.printed.get(signature.id) : undefined;
  const sigHref =
    signature && isRoutedWork(signature)
      ? routeHref(input, { route: 'work', slug: signature.slug })
      : undefined;
  return (
    <div
      className={
        signature ? 'ch-spread ch-spread--title' : 'ch-spread ch-spread--title ch-spread--solo'
      }
      id={idOf(input, ANCHORS.title)}
    >
      <Page side="verso">
        {/* The hero's frame is the title block itself, not the spread: a title page, not a poster. */}
        <section className="tp" {...heroFrame}>
          {notice ? (
            <p className="tp-notice" role="status" data-type-role="body">
              {notice} <a href={homeHref(input, ANCHORS.contents)}>The contents</a> list every
              chapter.
            </p>
          ) : null}
          {present(hero?.title) ? <p className="ch-label ch-caps">{hero.title}</p> : null}
          <Sub section={hero} className="ch-label" />
          <p className="tp-author" data-type-role="body">
            {hero?.name ?? identity.name}
          </p>
          {thesisSection ? (
            // The thesis is the book's title: its section's own title prints in the colophon
            // (titleFrom), never on the title page, and names the article from there.
            <article
              className="tp-thesis"
              {...frameAttributes(thesisSection, input, true)}
              aria-labelledby={thesisFrom ? thesisFromId : undefined}
            >
              {heading}
            </article>
          ) : (
            heading
          )}
          <p className="tp-actions" data-type-role="body-compact">
            {first ? (
              <a className="tp-begin" href={chapterHref(input, first)} data-type-role="title">
                Begin reading
              </a>
            ) : null}
            <span className="tp-more">
              <a href={homeHref(input, ANCHORS.contents)}>Contents</a>
              {ctas.map((cta) => (
                <a key={cta.url} href={bookHref(input, book, cta.url)}>
                  {cta.label}
                </a>
              ))}
            </span>
          </p>
        </section>
      </Page>
      {/* With no signature work the title page spans the spread: no empty facing page. */}
      {signature ? (
        <>
          <span className="ch-gutter" aria-hidden="true" />
          <Page side="recto">
            {signature ? (
              <figure className="fp">
                <Picture
                  placement={signature.cover ?? signature.media?.[0]}
                  input={input}
                  className="fp__img"
                  eager
                />
                <figcaption className="fp__cap">
                  <span className="fp__label ch-caps">Frontispiece</span>
                  <span className="fp__t" data-type-role="title">
                    {signature.title}
                  </span>
                  <span className="fp__text" data-type-role="body-compact">
                    {signature.summary ? (
                      <Md source={signature.summary} input={input} inline />
                    ) : null}
                    {signature.role ? ` ${signature.role}` : null}
                    {signature.period?.start ? (
                      <>
                        , since <When raw={signature.period.start} input={input} />
                      </>
                    ) : null}
                    .
                  </span>
                  <span className="fp__go" data-type-role="body-compact">
                    {sigHref ? <a href={sigHref}>Read the case study</a> : null}
                    {sigAt?.chapter ? (
                      <a href={locatorHref(input, sigAt)}>
                        Chapter {sigAt.chapter.n}
                        {book.options.folios ? `, page ${sigAt.page}` : null}
                      </a>
                    ) : null}
                  </span>
                </figcaption>
              </figure>
            ) : null}
          </Page>
        </>
      ) : null}
      <div className="tp-band">
        <div className="tp-band__v">
          {present(hero?.subtagline) ? (
            <p className="tp-now" data-type-role="body">
              {hero.subtagline}
            </p>
          ) : null}
          {thesisFrom ? <Sub section={thesisSection} className="tp-from" /> : null}
          <p className="tp-who" data-type-role="body-compact">
            {[
              identity.tagline,
              identity.location,
              identity.pronouns ? `Pronouns ${identity.pronouns}` : undefined,
            ]
              .filter(present)
              .map((part) => `${part.replace(/\.$/, '')}.`)
              .join(' ')}
          </p>
        </div>
        <div className="tp-band__r">
          {loose.length > 0 ? (
            <ul className="tp-proof" role="list" data-type-role="body-compact">
              {loose.map(proofItem)}
            </ul>
          ) : null}
          {proofSections.map(({ section, records }) => {
            const headId = idOf(input, `${section.id}--proof`);
            const titled = present(section.title);
            return (
              <section
                key={section.id}
                className="tp-proof__frame"
                {...frameAttributes(section, input, true)}
                aria-labelledby={titled ? headId : undefined}
              >
                {titled ? (
                  <p className="tp-proof__h ch-caps" id={headId}>
                    {section.title}
                  </p>
                ) : null}
                <ul className="tp-proof" role="list" data-type-role="body-compact">
                  {proof.filter((record) => records.includes(record)).map(proofItem)}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <Folios verso="i" recto="ii" joined />
    </div>
  );
}

function Contents({ input, book }: { input: Input; book: Book }) {
  const { quote, preface, hero } = book.front;
  const backBits = [
    'About the author',
    book.back.services ? (book.back.services.title ?? 'Engagements') : undefined,
    book.back.alsoBy.length ? `Also by ${input.portfolio.identity.name}` : undefined,
    book.back.uncollected.length || book.back.extras.length ? 'Uncollected' : undefined,
    book.back.parts.some((part) => part.key === 'index') ? 'Index' : undefined,
  ].filter((bit): bit is string => bit !== undefined);
  // The owner's chronology sections the chapters are made from, by their own titles: the
  // book splits their entries across its chapters, so the contents names where they came from.
  const sources = input.portfolio.sections
    .filter((section) => section.kind === 'chronology' && chronologyOf(section, input).length > 0)
    .map((section) => section.title)
    .filter(present);
  const count = book.chapters.length;
  const list = (
    <>
      {/* P2-1: the heading and its line are one head, the list a step below. */}
      <div className="toc__head">
        <h2 className="toc__h" id={idOf(input, 'ch--contents-h')} data-type-role="headline">
          Contents
        </h2>
        {sources.length > 0 ? (
          <p className="toc__from" data-type-role="body-compact">
            {spelled(count).replace(/^./, (c) => c.toUpperCase())}{' '}
            {count === 1 ? 'chapter' : 'chapters'}
            {/* P2-17: the owner named the chapters, so there is no derivation to name. */}
            {book.derivedFrom === 'owner' ? '.' : `, from ${listed(sources)}.`}
          </p>
        ) : null}
      </div>
      <ol className="toc" role="list">
        {preface ? (
          <li className="toc__fm">
            <a href={`#${idOf(input, ANCHORS.preface)}`} data-type-role="title">
              {present(preface.title) ? preface.title : 'Preface'}
            </a>
            {book.options.folios ? (
              <span className="toc__pg" data-type-role="numeric">
                iv
              </span>
            ) : null}
          </li>
        ) : null}
        {book.chapters.map((chapter) => {
          const parts = chapter.parts
            .slice(1)
            .map((part) => part.title)
            .filter(present);
          const shown =
            parts.length > 7
              ? `${parts.slice(0, 6).join(', ')}, and ${spelled(parts.length - 6)} more`
              : listed(parts);
          const pages = chapter.lastPage - chapter.firstPage + 1;
          return (
            <li key={chapter.slug} className="toc__ch" data-n={chapter.n} data-ink={chapter.ink}>
              <a className="toc__a" href={chapterHref(input, chapter)}>
                <span className="toc__n" aria-hidden="true">
                  {chapter.n}
                </span>
                <span className="toc__t" data-type-role="headline">
                  <span className="ch-sr">Chapter {chapter.n}: </span>
                  {chapter.title}
                </span>
                {book.options.folios ? (
                  <span className="toc__pg" data-type-role="numeric">
                    <span className="ch-sr">page </span>
                    {chapter.firstPage}
                  </span>
                ) : null}
              </a>
              <p className="toc__yr" data-type-role="body-compact">
                {joined(
                  [chapter.span, listed(chapter.roles)].filter(present).map((part) => (
                    <span key={part} className="toc__run">
                      {part}.
                    </span>
                  )),
                  ' ',
                )}
              </p>
              {chapter.teaser ? (
                <p className="toc__teaser" data-type-role="body-compact">
                  {chapter.teaser}
                </p>
              ) : null}
              {shown ? (
                <p className="toc__in" data-type-role="body-compact">
                  {shown}.
                </p>
              ) : null}
              <span className="toc__ticks" aria-hidden="true">
                {Array.from({ length: pages }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </li>
          );
        })}
        <li className="toc__fm toc__fm--back">
          <a href={backHref(input)} data-type-role="title">
            Back matter
          </a>
          {book.options.folios ? (
            <span className="toc__pg" data-type-role="numeric">
              {book.backStart}
            </span>
          ) : null}
          <p className="toc__yr" data-type-role="body-compact">
            {listed(backBits)}.
          </p>
        </li>
      </ol>
    </>
  );
  // P1-5: with no epigraph and no preface, the contents is set across both pages, never
  // beside a blank one.
  const wide = !quote && !preface;
  return (
    <section
      className={
        wide ? 'ch-spread ch-spread--contents ch-spread--wide' : 'ch-spread ch-spread--contents'
      }
      id={idOf(input, ANCHORS.contents)}
      aria-labelledby={idOf(input, 'ch--contents-h')}
    >
      {wide ? (
        <div className="fl">{list}</div>
      ) : (
        <>
          <Page side="verso">{list}</Page>
          <span className="ch-gutter" aria-hidden="true" />
          <Page side="recto">
            {quote ? (
              <article className="epi" {...frameAttributes(quote, input, true)}>
                {present(quote.title) ? <p className="ch-label ch-caps">{quote.title}</p> : null}
                <Sub section={quote} className="ch-label" />
                <figure>
                  <blockquote data-type-role="quote">
                    <p>{quote.text}</p>
                  </blockquote>
                  {quote.attribution || quote.source ? (
                    <figcaption data-type-role="body-compact">
                      {quote.attribution}
                      {quote.attribution && quote.source ? ', ' : null}
                      {quote.source ? (
                        <cite>
                          <Out url={quote.sourceUrl} input={input}>
                            {quote.source}
                          </Out>
                        </cite>
                      ) : null}
                    </figcaption>
                  ) : null}
                </figure>
              </article>
            ) : null}
            {preface ? (
              <article
                className="pf"
                {...frameAttributes(preface, input, true)}
                aria-labelledby={idOf(input, ANCHORS.preface)}
              >
                <h2 className="pf__h" id={idOf(input, ANCHORS.preface)} data-type-role="headline">
                  {present(preface.title) ? preface.title : 'Preface'}
                </h2>
                <Sub section={preface} />
                {present(hero?.tagline) ? (
                  <p className="pf__lead" data-type-role="quote">
                    {hero.tagline}
                  </p>
                ) : null}
                <DropCap source={preface.body} input={input} className="pf__text" />
              </article>
            ) : null}
          </Page>
        </>
      )}
      <Folios verso="iii" recto="iv" joined={wide} />
    </section>
  );
}

export function HomePage({ input, notice }: HomePageProps) {
  const book = buildBook(input);
  return (
    <BookPage input={input} book={book} here={{ view: 'home' }} ink={0}>
      <TitlePage input={input} book={book} notice={notice?.text} />
      <Contents input={input} book={book} />
    </BookPage>
  );
}
