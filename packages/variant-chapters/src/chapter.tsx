import type { ReactNode } from 'react';
import type { ChronologyEntry } from '@portfolio/schema';
import {
  chronologyOf,
  formatFigure,
  frameAttributes,
  githubSnapshot,
  isRoutedWork,
  present,
  renderContext,
  safeHref,
  type ViewPageProps,
} from '@portfolio/kit/sections';
import { routeHref } from '@portfolio/variant-contract';
import { Book as BookPage, Folios, Page } from './chrome';
import { GroupBlock } from './entries';
import { Picture } from './media';
import {
  buildBook,
  chapterBySlug,
  entryById,
  headPage,
  listed,
  normalOrganization,
  spelled,
  type Book,
  type Chapter,
  type ClosePart,
  type FlowPart,
  type GroupsPart,
  type OpenerPart,
  type PlatePart,
  type SeriesPart,
  type ViewSection,
} from './model/book';
import { moment } from './model/dates';
import {
  ANCHORS,
  backHref,
  chapterHref,
  homeHref,
  idOf,
  locatorHref,
  Md,
  Out,
  cite,
  Sub,
  Unbroken,
  When,
  type Input,
} from './text';

// A chapter is its era's spreads: the opener (the ink numeral, the title,
// the span, In this chapter with page numbers, the drop-capped opening),
// then plates facing their text, the double-page series, group pages, the
// current chapter's Still being written, and the turnstile, whose two
// halves are the two ways on.

/** Each section's frame goes on the first part of a document that shows it. */
export class Frames {
  private readonly done = new Set<string>();
  constructor(private readonly input: Input) {}
  /** The frame's attributes the first time, then none. */
  take(section: ViewSection) {
    if (this.done.has(section.id)) return null;
    this.done.add(section.id);
    return frameAttributes(section, this.input, true);
  }
}

/** A frame wrapper that leaves layout alone, around a part its section is first seen in. */
function Framed({
  attributes,
  children,
}: {
  attributes: ReturnType<Frames['take']>;
  children: ReactNode;
}) {
  return attributes ? (
    <section className="ch-frame" {...attributes}>
      {children}
    </section>
  ) : (
    <>{children}</>
  );
}

/** Characters of a paragraph a three-line drop cap needs below it (F8). */
const CAP_CHARS = 190;
/** Capitals whose open shape leaves a hole beside the cap. */
const OPEN_CAPS = /^[LTPFVWY]/;
/** Capitals that set as a bare bar at three lines, in a sans most of all (P2-7): no cap. */
const BAR_CAPS = /^[IJl1|]/;

/** Markdown whose first paragraph takes a three-line drop cap when it's long enough for one. */
export function DropCap({
  source,
  input,
  className,
}: {
  source: string | undefined;
  input: Input;
  className: string;
}) {
  if (!present(source)) return null;
  const first = source.trim().split(/\n\s*\n/)[0] ?? '';
  const plain = first.replace(/[*_`[\]()#>]/g, '').trim();
  const capped = plain.length >= CAP_CHARS && !BAR_CAPS.test(plain);
  const open = capped && OPEN_CAPS.test(plain);
  return (
    <Md
      source={source}
      input={input}
      role="body"
      className={[className, capped ? 'ch-cap' : '', open ? 'ch-cap--open' : '']
        .filter(Boolean)
        .join(' ')}
    />
  );
}

const yearsOf = (entry: ChronologyEntry, input: Input) => {
  const start = moment(entry.period.start, 'start', input.env.now);
  const end = entry.period.end ? moment(entry.period.end, 'end', input.env.now) : undefined;
  if (!start) return '';
  if (!entry.period.end) return `${start.year} to now`;
  return end && end.year !== start.year ? `${start.year} to ${end.year}` : String(start.year);
};

/** The chronology section that lists an entry first. */
const sectionOfEntry = (input: Input, entry: ChronologyEntry) =>
  input.portfolio.sections.find(
    (section) =>
      section.kind === 'chronology' && chronologyOf(section, input).some((e) => e.id === entry.id),
  );

/**
 * Whether a side thread's own words already say where it grew from, its parent's title or
 * organization, so the book doesn't say it again (P1-8).
 */
function namesParent(description: string | undefined, parent: ChronologyEntry): boolean {
  const words = (description ?? '').toLowerCase();
  const organization = normalOrganization(parent.organization);
  // The organization's own name, or its first word when that's a name ("Solstice").
  const first = organization?.split(/\s+/)[0];
  return [parent.title, organization, first && first.length >= 4 ? first : undefined].some(
    (name) => present(name) && words.includes(name.toLowerCase()),
  );
}

function Opener({
  input,
  book,
  chapter,
  part,
  frames,
}: {
  input: Input;
  book: Book;
  chapter: Chapter;
  part: OpenerPart;
  frames: Frames;
}) {
  const single = chapter.entries.length === 1 ? chapter.entries[0] : undefined;
  const roleLine = single
    ? [listed(chapter.roles), listed(chapter.locations)]
        .filter(present)
        .map((p) => `${p}.`)
        .join(' ')
    : chapter.locations.length > 0
      ? `${listed(chapter.locations)}.`
      : '';
  const map = chapter.parts.slice(1);
  const highlights = chapter.entries.flatMap((e) => [
    ...(e.highlights ?? []),
    ...(e.achievements ?? []),
  ]);
  const skills = [...new Set(chapter.entries.flatMap((e) => e.skills ?? []))];
  const capAt = chapter.entries.findIndex((entry) => present(entry.description));
  const entryFrame = (entry: ChronologyEntry) => {
    const section = sectionOfEntry(input, entry);
    return section ? frames.take(section) : null;
  };
  const singleFrame = single ? entryFrame(single) : null;
  return (
    <section className="ch-spread ch-spread--opener" id={idOf(input, part.key)}>
      <Page side="verso">
        <p className="op-num" aria-hidden="true">
          {chapter.n}
        </p>
        <h1 className="op-title">
          <span className="ch-sr">Chapter {chapter.n}: </span>
          <span className="op-title__t" data-type-role="headline">
            {chapter.title}
          </span>
        </h1>
        {present(chapter.span) ? (
          <p className="op-span" data-type-role="quote">
            {chapter.span}
          </p>
        ) : null}
        {chapter.teaser ? (
          <p className="op-teaser" data-type-role="body">
            {chapter.teaser}
          </p>
        ) : null}
        {roleLine ? (
          <p className="op-roles" data-type-role="body-compact">
            {roleLine}
          </p>
        ) : null}
        {map.length > 0 ? (
          <nav className="op-map" aria-label="In this chapter">
            <p className="op-map__h ch-caps">In this chapter</p>
            <ol role="list" data-type-role="body-compact">
              {map.map((p) => (
                <li key={p.key}>
                  <a href={`#${idOf(input, p.key)}`}>{p.title}</a>
                  {book.options.folios ? (
                    <span className="op-map__pg" data-type-role="numeric">
                      {headPage(p)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </Page>
      <span className="ch-gutter" aria-hidden="true" />
      <Page side="recto">
        {single ? (
          singleFrame ? (
            <article className="op-text" {...singleFrame}>
              <DropCap source={single.description} input={input} className="op-desc" />
            </article>
          ) : (
            <div className="op-text">
              <DropCap source={single.description} input={input} className="op-desc" />
            </div>
          )
        ) : (
          <div className="op-text op-text--entries">
            {chapter.entries.map((entry, index) => {
              const frame = entryFrame(entry);
              const cap = index === capAt;
              const body = (
                <>
                  <h2 className="op-entry__t" data-type-role="title">
                    {[entry.title, entry.field].filter(Boolean).join(', ')}
                  </h2>
                  <p className="op-entry__m" data-type-role="body-compact">
                    {[entry.organization, entry.location].filter(Boolean).join(', ')}.{' '}
                    <span className="ch-nobreak">{yearsOf(entry, input)}</span>
                  </p>
                  {cap ? (
                    <DropCap source={entry.description} input={input} className="op-desc" />
                  ) : (
                    <Md source={entry.description} input={input} className="op-desc" role="body" />
                  )}
                </>
              );
              return frame ? (
                <article key={entry.id} className="op-entry" {...frame}>
                  {body}
                </article>
              ) : (
                <div key={entry.id} className="op-entry">
                  {body}
                </div>
              );
            })}
          </div>
        )}
        {highlights.length > 0 ? (
          <ul className="op-hl ch-bars" role="list" data-type-role="body-compact">
            {highlights.map((h, i) => (
              <li key={i}>
                <Unbroken text={h} />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="op-foot">
          {chapter.side.map((side) => {
            const parent = entryById(input, side.branchesFrom);
            const frame = (() => {
              const section = sectionOfEntry(input, side);
              return section ? frames.take(section) : null;
            })();
            const line = (
              <p className="op-along" data-type-role="body-compact">
                <b>Alongside.</b>{' '}
                {[side.title, side.organization, side.location].filter(present).join(', ')}
                {side.period.start ? (
                  <>
                    , since <When raw={side.period.start} input={input} />
                  </>
                ) : null}
                . {side.description ? <Md source={side.description} input={input} inline /> : null}
                {parent && !namesParent(side.description, parent)
                  ? ` It grew out of the work as ${parent.title}.`
                  : null}
              </p>
            );
            return frame ? (
              <article key={side.id} className="op-side" {...frame}>
                {line}
              </article>
            ) : (
              <div key={side.id}>{line}</div>
            );
          })}
          {skills.length > 0 ? (
            <p className="op-skills" data-type-role="body-compact">
              <b>Working in</b> {listed(skills)}.
            </p>
          ) : null}
        </div>
      </Page>
      <Folios verso={part.page} recto={part.page + 1} />
    </section>
  );
}

function Plate({
  input,
  book,
  chapter,
  part,
  frames,
}: {
  input: Input;
  book: Book;
  chapter: Chapter;
  part: PlatePart;
  frames: Frames;
}) {
  const { work } = part;
  const frame = frames.take(part.section);
  // With no cover, the plate is the work's first image, and its caption is that image's own.
  const own = work.cover ? undefined : work.media?.[0];
  const caseHref = isRoutedWork(work)
    ? routeHref(input, { route: 'work', slug: work.slug })
    : undefined;
  const headId = idOf(input, `${work.id}--title`);
  const since = work.period?.start ? (
    <>
      , since <When raw={work.period.start} input={input} />
    </>
  ) : work.releasedAt ? (
    <>
      , released <When raw={work.releasedAt} input={input} />
    </>
  ) : null;
  const image = (
    <figure className="pl">
      <Picture placement={work.cover ?? work.media?.[0]} input={input} className="pl__img" />
      <figcaption className="pl__cap" data-type-role="caption">
        <span className="pl__no">Plate {part.plate}</span>{' '}
        <span>
          {present(own?.caption) ? (
            <>
              {own.caption}
              {own.location ? `, ${own.location}` : null}
            </>
          ) : (
            <>
              {work.title}
              {since}
            </>
          )}
          .
        </span>
      </figcaption>
    </figure>
  );
  const seeAlso = (work.evidence ?? []).flatMap((id) => {
    const evidence = input.portfolio.evidence.find((e) => e.id === id);
    const at = book.printed.get(id);
    return evidence && at ? [{ evidence, at }] : [];
  });
  const ctx = renderContext(input, part.section, 2);
  const facts: [string, ReactNode][] = [];
  if (work.artist) facts.push(['By', work.artist]);
  if (work.role) facts.push(['Role', work.role]);
  if (work.organization) facts.push(['For', work.organization]);
  if (work.period?.start)
    facts.push(['Since', <When key="s" raw={work.period.start} input={input} />]);
  if (work.releasedAt)
    facts.push([
      'Released',
      <>
        <When raw={work.releasedAt} input={input} />
        {work.label ? `, ${work.label}` : null}
      </>,
    ]);
  if (work.tools?.length) facts.push(['Made with', listed(work.tools)]);
  const filed = [...new Set([...(work.tags ?? []), ...(own?.tags ?? [])])];
  if (filed.length) facts.push(['Filed under', listed(filed)]);
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
  const lede =
    part.section.subtitle && part.section.kind === 'works' && part.section.items.length === 1
      ? part.section.subtitle
      : work.summary;
  const text = (
    <>
      {frame && present(part.section.title) && part.section.title !== work.title ? (
        <p className="ch-label ch-caps">{part.section.title}</p>
      ) : null}
      <h2 className="pl__t" id={headId} data-type-role="headline">
        {work.title}
      </h2>
      {present(lede) ? <Md source={lede} input={input} className="pl__lede" role="quote" /> : null}
      <Md source={work.description} input={input} className="pl__desc" role="body" />
      {work.tracks?.length ? (
        <ol className="pl__tracks" data-type-role="body-compact">
          {work.tracks.map((track, i) => (
            <li key={i}>
              <span>{track.title}</span>
              {track.durationSeconds ? (
                <span className="pl__dur" data-type-role="numeric">
                  {Math.floor(track.durationSeconds / 60)}:
                  {String(Math.round(track.durationSeconds % 60)).padStart(2, '0')}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
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
      {facts.length > 0 ? (
        <dl className="ch-facts" data-type-role="body-compact">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {seeAlso.length > 0 ? (
        <p className="pl__xref" data-type-role="body-compact">
          <b>See also</b>{' '}
          {seeAlso.map(({ evidence, at }, i) => (
            <span key={evidence.id}>
              {i > 0 ? '; ' : null}
              {evidence.title ?? evidence.statement}
              {evidence.publication || evidence.venue ? (
                <>
                  , <i>{evidence.publication ?? evidence.venue}</i>
                </>
              ) : null}
              ,{' '}
              <a href={at.chapter === chapter ? `#${idOf(input, at.key)}` : locatorHref(input, at)}>
                {book.options.folios ? `page ${formatFigure(at.page, ctx)}` : cite(book, at)}
              </a>
            </span>
          ))}
          .
        </p>
      ) : null}
      {caseHref ? (
        <p className="pl__case" data-type-role="title">
          <a href={caseHref}>Read the case study</a>
        </p>
      ) : null}
    </>
  );
  const recto = part.imageSide === 'recto';
  return (
    <Framed attributes={frame}>
      <article
        className={`ch-spread ch-spread--plate${recto ? ' ch-spread--plate-recto' : ''}`}
        id={idOf(input, part.key)}
        aria-labelledby={headId}
      >
        <Page side="verso">{recto ? text : image}</Page>
        <span className="ch-gutter" aria-hidden="true" />
        <Page side="recto">{recto ? image : text}</Page>
        <Folios verso={part.page} recto={part.page + 1} />
      </article>
    </Framed>
  );
}

function Series({ input, part, frames }: { input: Input; part: SeriesPart; frames: Frames }) {
  const headId = idOf(input, `${part.work.id}--title`);
  const images = (part.work.media ?? []).filter(
    (placement) =>
      Object.hasOwn(input.media, placement.asset) && input.media[placement.asset]!.kind === 'image',
  );
  const subtitle = part.section.subtitle ?? part.work.summary;
  return (
    <Framed attributes={frames.take(part.section)}>
      <article
        className="ch-spread ch-spread--series"
        id={idOf(input, part.key)}
        aria-labelledby={headId}
      >
        <div className="sr__head">
          <h2 className="sr__t" id={headId} data-type-role="headline">
            {part.title}
          </h2>
          {present(subtitle) ? (
            <Md source={subtitle} input={input} className="sr__sub" role="quote" />
          ) : null}
        </div>
        <div className="sr__row">
          {images.map((placement, i) => (
            <figure key={placement.asset} className="sr__fig">
              <Picture placement={placement} input={input} className="pl__img" />
              <figcaption className="pl__cap" data-type-role="caption">
                <span className="pl__no">Plate {part.plates[i]}</span> {placement.caption}
                {placement.location || placement.takenAt ? (
                  <span className="sr__where">
                    {placement.caption ? '. ' : null}
                    {placement.location}
                    {placement.location && placement.takenAt ? ', ' : null}
                    {placement.takenAt ? <When raw={placement.takenAt} input={input} /> : null}
                  </span>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
        <Folios verso={part.page} recto={part.page + 1} joined />
      </article>
    </Framed>
  );
}

function Groups({
  input,
  part,
  frames,
}: {
  input: Input;
  part: GroupsPart | FlowPart;
  frames: Frames;
}) {
  if (part.type === 'flow') {
    return (
      <div className="ch-spread ch-spread--flow" id={idOf(input, part.key)}>
        <div className="fl">
          <GroupBlock
            group={part.group}
            input={input}
            framed={frames.take(part.group.section) !== null}
          />
        </div>
        <Folios verso={part.page} recto={part.page + 1} joined />
      </div>
    );
  }
  return (
    <div className="ch-spread ch-spread--groups" id={idOf(input, part.key)}>
      <Page side="verso">
        {part.verso.map((group) => (
          <GroupBlock
            key={group.section.id}
            group={group}
            input={input}
            framed={frames.take(group.section) !== null}
          />
        ))}
      </Page>
      <span className="ch-gutter" aria-hidden="true" />
      <Page side="recto">
        {part.recto.map((group) => (
          <GroupBlock
            key={group.section.id}
            group={group}
            input={input}
            framed={frames.take(group.section) !== null}
          />
        ))}
      </Page>
      <Folios verso={part.page} recto={part.page + 1} />
    </div>
  );
}

function Close({
  input,
  book,
  part,
  frames,
}: {
  input: Input;
  book: Book;
  part: ClosePart;
  frames: Frames;
}) {
  const { now, focus, github } = book.close;
  const snapshot = github ? githubSnapshot(github, input) : undefined;
  const data = snapshot?.state === 'ready' ? snapshot.value : undefined;
  const counted = snapshot?.state === 'ready' ? snapshot.derivedAt.slice(0, 10) : undefined;
  const ctx = renderContext(input, github ?? { id: 'close' }, 2);
  const profile = github
    ? safeHref(`https://github.com/${encodeURIComponent(github.username)}`)
    : undefined;
  const headId = idOf(input, `${ANCHORS.close}-h`);
  return (
    <section
      className="ch-spread ch-spread--close"
      id={idOf(input, part.key)}
      aria-labelledby={headId}
    >
      <Page side="verso">
        <h2 className="cl__t" id={headId} data-type-role="headline">
          Still being written
        </h2>
        {now ? (
          <article className="cl__now" {...(frames.take(now) ?? {})}>
            <p className="cl__asof" data-type-role="body-compact">
              {now.title ?? 'Now'}
              {now.asOf ? (
                <>
                  , as of <When raw={now.asOf} input={input} />
                </>
              ) : null}
            </p>
            <Sub section={now} />
            <Md source={now.body} input={input} className="cl__body" role="body" />
          </article>
        ) : null}
        {focus ? (
          <article className="cl__focus" {...(frames.take(focus) ?? {})}>
            {present(focus.title) ? (
              <h3 className="cl__h" data-type-role="title">
                {focus.title}
              </h3>
            ) : null}
            <Sub section={focus} />
            <ul className="ch-bars" role="list" data-type-role="body">
              {focus.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </article>
        ) : null}
      </Page>
      <span className="ch-gutter" aria-hidden="true" />
      <Page side="recto">
        {github ? (
          <article className="cl__gh" {...(frames.take(github) ?? {})}>
            <h3 className="cl__h" data-type-role="title">
              {github.title ?? 'GitHub'}
            </h3>
            <Sub section={github} />
            <p className="cl__ghtext" data-type-role="body">
              <a href={profile}>@{github.username}</a>
              {data ? (
                <>
                  {' '}
                  keeps {formatFigure(data.totalRepos, ctx)} public repositories
                  {data.totalStarsReceived !== null
                    ? `, which have received ${formatFigure(data.totalStarsReceived, ctx)} stars`
                    : null}
                  {data.contributionsLastYear !== null
                    ? `, with ${formatFigure(data.contributionsLastYear, ctx)} contributions in the last year`
                    : null}
                  . Counted on <When raw={counted} input={input} />.
                </>
              ) : null}
            </p>
            {data && data.pinnedRepos.length > 0 ? (
              <ol className="cl__repos" role="list">
                {data.pinnedRepos.map((repo) => (
                  <li key={repo.name}>
                    <h4 className="it__t" data-type-role="title">
                      <Out url={repo.url} input={input}>
                        {repo.name}
                      </Out>
                    </h4>
                    {present(repo.description) ? (
                      <p className="it__text" data-type-role="body-compact">
                        {repo.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </article>
        ) : null}
      </Page>
      <Folios verso={part.page} recto={part.page + 1} />
    </section>
  );
}

export interface TurnHalf {
  readonly href: string;
  readonly dir: string;
  readonly n?: number;
  readonly title: string;
  readonly sub?: string;
  readonly ink?: number;
}

/** The last spread: its two halves are the two ways on. */
export function Turnstile({
  input,
  prev,
  next,
}: {
  input: Input;
  prev?: TurnHalf;
  next?: TurnHalf;
}) {
  const half = (t: TurnHalf | undefined, side: 'prev' | 'next') =>
    t ? (
      <a className={`ts__a ts__a--${side}`} href={t.href} data-ink={t.ink}>
        <span className="ts__dir ch-caps">{t.dir}</span>
        {t.n !== undefined ? (
          <span className="ts__n" aria-hidden="true">
            {t.n}
          </span>
        ) : null}
        <span className="ts__t" data-type-role="headline">
          {t.title}
        </span>
        {t.sub ? (
          <span className="ts__sub" data-type-role="body-compact">
            {t.sub}
          </span>
        ) : null}
      </a>
    ) : null;
  return (
    <nav
      className="ch-spread ch-spread--turn"
      id={idOf(input, ANCHORS.turn)}
      aria-label="Turn the page"
    >
      <div className="ch-page ch-page--verso">{half(prev, 'prev')}</div>
      <span className="ch-gutter" aria-hidden="true" />
      <div className="ch-page ch-page--recto">{half(next, 'next')}</div>
    </nav>
  );
}

export const chapterHalf = (input: Input, chapter: Chapter, dir: string): TurnHalf => ({
  href: chapterHref(input, chapter),
  dir,
  n: chapter.n,
  title: chapter.title,
  sub: chapter.years,
  ink: chapter.ink,
});

export const contentsHalf = (input: Input): TurnHalf => ({
  href: homeHref(input, ANCHORS.contents),
  dir: 'Back to',
  title: 'The contents',
  sub: 'Title page, contents and preface',
});

export const backHalf = (input: Input): TurnHalf => ({
  href: backHref(input),
  dir: 'Turn to',
  title: 'Back matter',
  sub: 'About the author and the index',
});

/** The parts of a chapter, in order, each with its frame where its section is first seen. */
export function ChapterParts({
  input,
  book,
  chapter,
  frames,
}: {
  input: Input;
  book: Book;
  chapter: Chapter;
  frames: Frames;
}) {
  return (
    <>
      {chapter.parts.map((part) => {
        switch (part.type) {
          case 'opener':
            return (
              <Opener
                key={part.key}
                input={input}
                book={book}
                chapter={chapter}
                part={part}
                frames={frames}
              />
            );
          case 'plate':
            return (
              <Plate
                key={part.key}
                input={input}
                book={book}
                chapter={chapter}
                part={part}
                frames={frames}
              />
            );
          case 'series':
            return <Series key={part.key} input={input} part={part} frames={frames} />;
          case 'groups':
          case 'flow':
            return <Groups key={part.key} input={input} part={part} frames={frames} />;
          case 'close':
            return <Close key={part.key} input={input} book={book} part={part} frames={frames} />;
        }
      })}
    </>
  );
}

/** Whether the chapter view's slug names a chapter, for composePages' unknown-view note. */
export const knownChapter = (input: Input, params: Readonly<Record<string, string>>) =>
  chapterBySlug(buildBook(input), params.chapter) !== undefined;

export function ChapterPage({ input, params }: ViewPageProps) {
  const book = buildBook(input);
  const chapter = chapterBySlug(book, params.chapter)!;
  const i = book.chapters.indexOf(chapter);
  const before = book.chapters[i - 1];
  const after = book.chapters[i + 1];
  const frames = new Frames(input);
  return (
    <BookPage input={input} book={book} here={{ view: 'chapter', chapter }} ink={chapter.ink}>
      <ChapterParts input={input} book={book} chapter={chapter} frames={frames} />
      <Turnstile
        input={input}
        prev={before ? chapterHalf(input, before, 'Previous chapter') : contentsHalf(input)}
        next={after ? chapterHalf(input, after, 'Next chapter') : backHalf(input)}
      />
    </BookPage>
  );
}

export { spelled };
