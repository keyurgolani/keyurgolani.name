import { present, type ViewPageProps } from '@portfolio/kit/sections';
import { Book as BookPage, Folios, Page } from './chrome';
import { chapterHalf, contentsHalf, Frames, Turnstile } from './chapter';
import { GroupBlock } from './entries';
import {
  buildBook,
  listed,
  type Book,
  type BackPart,
  type Locator,
  type Term,
  type ViewSection,
} from './model/book';
import { ANCHORS, cite, idOf, locatorHref, Md, Out, plain, Sub, type Input } from './text';

// The back matter: About the author and the owner's fun facts, the
// engagements, Also by, the Uncollected pages (records with no date to
// place them, and sections with no time), then the index: works by kind,
// then every skill and tool by letter, with page locators.

const PART_TITLES: Record<BackPart['key'], string> = {
  about: 'About the author',
  engagements: 'Engagements',
  'also-by': 'Also by',
  uncollected: 'Uncollected',
  index: 'Index',
};

/** A locator in the index: its page, or with folios off its chapter's number (B for the back matter). */
function Loc({ input, book, at }: { input: Input; book: Book; at: Locator }) {
  const folio = book.options.folios;
  return (
    <a
      className="ix__pg"
      href={locatorHref(input, at)}
      aria-label={
        folio ? `page ${at.page}${at.chapter ? `, chapter ${at.chapter.n}` : ''}` : cite(book, at)
      }
    >
      {folio ? at.page : (at.chapter?.n ?? 'B')}
    </a>
  );
}

/** A term's locators as the index prints them: with folios off, one per chapter. */
const byChapter = (book: Book, locators: readonly Locator[]) =>
  book.options.folios
    ? locators
    : locators.filter((at, i) => locators.findIndex((other) => other.chapter === at.chapter) === i);

/** A section with nowhere else in the book: its title, body, and items. */
function Extra({ section, input, frames }: { section: ViewSection; input: Input; frames: Frames }) {
  const attributes = frames.take(section) ?? {};
  const body = 'body' in section && typeof section.body === 'string' ? section.body : undefined;
  const items = section.kind === 'custom' ? (section.items ?? []) : [];
  return (
    <section className="gp" {...attributes}>
      {present(section.title) ? (
        <h3 className="gp__t" data-type-role="title">
          {section.title}
        </h3>
      ) : null}
      <Sub section={section} />
      <Md source={body} input={input} className="it__text" role="body-compact" />
      {items.length > 0 ? (
        <ul className="gp__list" role="list">
          {items.map((item, i) => (
            <li key={i} className="it">
              <h4 className="it__t" data-type-role="title">
                <Out url={item.links?.[0]?.url} input={input}>
                  {item.title}
                </Out>
              </h4>
              <Md source={item.summary} input={input} className="it__text" role="body-compact" />
              {item.media?.some((placement) => present(placement.caption)) ? (
                <p className="it__meta" data-type-role="body-compact">
                  {listed(
                    item.media.flatMap((placement) =>
                      present(placement.caption) ? [placement.caption] : [],
                    ),
                  )}
                  .
                </p>
              ) : null}
              {item.links?.length ? (
                <p className="it__links" data-type-role="body-compact">
                  {item.links.map((link) => (
                    <Out key={link.url} url={link.url} input={input}>
                      {link.label ?? link.url}
                    </Out>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A figure as the book sets one: its number bound to its unit ("~52 min"). */
const figureOf = (label: string) => label.replace(/(\d)\s?([A-Za-z])/g, '$1\u00a0$2');

/** A letter-run headword: a term, an author's group, or both, with the group's members. */
interface Headword {
  readonly name: string;
  readonly term?: Term;
  description?: string;
  readonly members: Term[];
}

function Index({ input, book, frames }: { input: Input; book: Book; frames: Frames }) {
  const { skills, tools, terms, kinds } = book.back;
  const outer = skills ? frames.take(skills) : tools ? frames.take(tools) : null;
  const inner = skills && tools ? frames.take(tools) : null;
  // A section's frame is a section, never a div: the index wraps its skills' frame, its
  // terms the tools' when both are there.
  const Outer = outer ? 'section' : 'div';
  // P1-7: the author's own groups are headwords in the letter run, each with its description
  // and its members under it with their pages, so a "see Reliability" lands on an entry. A
  // group that's also a term is one entry.
  const practice = input.portfolio.practice;
  const byName = new Map(terms.map((term) => [term.name, term]));
  const heads = new Map<string, Headword>(
    terms.map((term) => [term.name, { name: term.name, term, members: [] }]),
  );
  for (const group of [
    ...(skills ? (practice?.skills ?? []) : []),
    ...(tools ? (practice?.tools ?? []) : []),
  ]) {
    if (!present(group.name)) continue;
    const head = heads.get(group.name) ?? { name: group.name, members: [] };
    if (present(group.description) && !head.description) head.description = group.description;
    for (const item of group.items) {
      const member = byName.get((typeof item === 'string' ? item : item.name).trim());
      if (member && member.name !== group.name && !head.members.includes(member))
        head.members.push(member);
    }
    heads.set(group.name, head);
  }
  const Terms = inner ? 'section' : 'div';
  const letters = new Map<string, Headword[]>();
  for (const head of [...heads.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  )) {
    const letter = head.name[0]!.toLocaleUpperCase('en');
    letters.set(letter, [...(letters.get(letter) ?? []), head]);
  }
  const locs = (term: Term) =>
    byChapter(book, term.locators).map((at, i) => (
      <span key={at.page}>
        {i > 0 ? ', ' : ' '}
        <Loc input={input} book={book} at={at} />
      </span>
    ));
  const page = book.back.parts.find((p) => p.key === 'index')!.page;
  const headId = idOf(input, `${ANCHORS.index}-h`);
  return (
    <section
      className="ch-spread ch-spread--flow ch-spread--index"
      id={idOf(input, ANCHORS.index)}
      aria-labelledby={headId}
    >
      <Outer className="fl ix" {...(outer ?? {})}>
        <h2 className="gp__t" id={headId} data-type-role="headline">
          Index
        </h2>
        <p className="gp__sub" data-type-role="body-compact">
          Works by kind, then{' '}
          {listed([
            ...(skills ? [present(skills.title) ? skills.title : 'skills'] : []),
            ...(tools ? [present(tools.title) ? tools.title : 'tools'] : []),
          ]) || 'the skills and tools the book names'}
          . {book.options.folios ? 'Numbers are pages' : 'Numbers are chapters'}; a skill with none
          is listed under its group.
        </p>
        <Sub section={skills} />
        <Sub section={tools} />
        <div className="ix__kinds">
          {kinds.map(({ kind, entries }) => (
            <div key={kind} className="ix__kind">
              <h3 className="ix__k ch-caps">{kind}</h3>
              <ul role="list" data-type-role="body-compact">
                {entries.map(({ record, at }) => (
                  <li key={record.id}>
                    <span>
                      {record.type === 'work'
                        ? record.work.title
                        : (record.evidence.title ?? plain(record.evidence.statement))}
                    </span>{' '}
                    <Loc input={input} book={book} at={at} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Terms className="ix__terms" {...(inner ?? {})}>
          {[...letters].map(([letter, group]) => (
            <div key={letter} className="ix__letter">
              <h3 className="ix__l" data-type-role="title">
                {letter}
              </h3>
              <ul role="list" data-type-role="body-compact">
                {group.map(({ name, term, description, members }) => (
                  <li key={name} className={members.length > 0 ? 'ix__head' : undefined}>
                    <span>{name}</span>
                    {term?.version ? <span className="ix__see"> ({term.version})</span> : null}
                    {term && term.locators.length > 0 ? (
                      locs(term)
                    ) : term && members.length === 0 && term.groups.some((g) => g !== name) ? (
                      <span className="ix__see">
                        {' '}
                        see {listed(term.groups.filter((g) => g !== name))}
                      </span>
                    ) : null}
                    {present(description) ? (
                      <span className="ix__desc">
                        , <i>{description}</i>
                      </span>
                    ) : null}
                    {members.length > 0 ? (
                      <ul className="ix__sub" role="list">
                        {members.map((member) => (
                          <li key={member.name}>
                            <span>{member.name}</span>
                            {member.version ? (
                              <span className="ix__see"> ({member.version})</span>
                            ) : null}
                            {locs(member)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Terms>
      </Outer>
      <Folios verso={page} recto={page + 1} joined />
    </section>
  );
}

export function BackMatterPage({ input }: ViewPageProps) {
  const book = buildBook(input);
  const frames = new Frames(input);
  const { identity } = input.portfolio;
  const { about, services, alsoBy, uncollected, extras, parts } = book.back;
  const start = book.backStart;
  const hero = book.front.hero;
  // The engagements by the author's own groups, each under its name and description.
  const serviceGroups = input.portfolio.practice?.services ?? [];
  const alsoSections = [...new Set(alsoBy.map(({ section }) => section))];
  const last = book.chapters.at(-1);
  const pageOf = (key: BackPart['key']) => parts.find((p) => p.key === key)?.page;
  return (
    <BookPage input={input} book={book} here={{ view: 'back' }} ink={0}>
      <section
        className="ch-spread ch-spread--opener ch-spread--back"
        id={idOf(input, ANCHORS.back)}
      >
        <Page side="verso">
          <h1 className="op-title">
            <span className="op-kicker ch-caps">After the last chapter</span>
            <span className="op-title__t" data-type-role="headline">
              Back matter
            </span>
          </h1>
          <nav className="op-map" aria-label="In the back matter">
            <ol role="list" data-type-role="body-compact">
              {parts.map((p) => (
                <li key={p.key}>
                  <a href={`#${idOf(input, `ch--${p.key}`)}`}>
                    {p.key === 'engagements' && services?.title
                      ? services.title
                      : p.key === 'also-by'
                        ? `Also by ${identity.name}`
                        : PART_TITLES[p.key]}
                  </a>
                  {book.options.folios ? (
                    <span className="op-map__pg" data-type-role="numeric">
                      {p.page}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </nav>
        </Page>
        <span className="ch-gutter" aria-hidden="true" />
        <Page side="recto">
          <section id={idOf(input, ANCHORS.about)} aria-labelledby={idOf(input, 'ch--about-h')}>
            <h2 className="gp__t" id={idOf(input, 'ch--about-h')} data-type-role="title">
              About the author
            </h2>
            <p className="ab" data-type-role="body">
              <b>{identity.name}</b>
              {identity.pronouns ? ` (${identity.pronouns})` : null}.{' '}
              {[identity.tagline, identity.location, hero?.subtagline]
                .filter(present)
                .map((part) => `${part.replace(/\.$/, '')}.`)
                .join(' ')}
            </p>
            {about ? (
              <article className="ab__facts" {...(frames.take(about) ?? {})}>
                {present(about.title) ? (
                  <h3 className="cl__h" data-type-role="title">
                    {about.title}
                  </h3>
                ) : null}
                <Sub section={about} />
                <ul className="ch-bars" role="list" data-type-role="body-compact">
                  {about.items.map((fact, i) => (
                    <li key={i}>{fact}</li>
                  ))}
                </ul>
              </article>
            ) : null}
          </section>
        </Page>
        <Folios verso={start} recto={start + 1} />
      </section>
      {pageOf('engagements') || pageOf('also-by') || pageOf('uncollected') ? (
        <div className="ch-spread ch-spread--groups">
          <Page side="verso">
            {services ? (
              <section
                className="gp"
                id={idOf(input, ANCHORS.engagements)}
                aria-labelledby={idOf(input, 'ch--engagements-h')}
              >
                <article {...(frames.take(services) ?? {})}>
                  <h2
                    className="gp__t"
                    id={idOf(input, 'ch--engagements-h')}
                    data-type-role="title"
                  >
                    {services.title ?? 'Engagements'}
                  </h2>
                  {present(services.subtitle) ? (
                    <p className="gp__sub" data-type-role="body-compact">
                      {services.subtitle}
                    </p>
                  ) : null}
                  {serviceGroups.map((group, g) => (
                    <div key={g}>
                      {present(group.name) ? (
                        <p className="ch-label ch-caps">{group.name}</p>
                      ) : null}
                      {present(group.description) ? (
                        <p className="gp__sub" data-type-role="body-compact">
                          {group.description}
                        </p>
                      ) : null}
                      <ol className="gp__list" role="list">
                        {group.items.map((item) => (
                          <li key={item.name} className="it">
                            <h3 className="it__t" data-type-role="title">
                              <Out url={item.url} input={input}>
                                {item.name}
                              </Out>
                            </h3>
                            <Md
                              source={item.description}
                              input={input}
                              className="it__text"
                              role="body-compact"
                            />
                            {item.highlights?.length ? (
                              // An engagement's deliverables, a line each (P1-8).
                              <ul className="ch-bars" role="list" data-type-role="body-compact">
                                {item.highlights.map((h, i) => (
                                  <li key={i}>{h}</li>
                                ))}
                              </ul>
                            ) : null}
                            {present(item.pricing) ? (
                              <p className="it__meta" data-type-role="body-compact">
                                {item.pricing.replace(/\.$/, '')}.
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </article>
              </section>
            ) : null}
          </Page>
          <span className="ch-gutter" aria-hidden="true" />
          <Page side="recto">
            {alsoBy.length > 0 ? (
              <section
                className="gp"
                id={idOf(input, ANCHORS.alsoBy)}
                aria-labelledby={idOf(input, 'ch--also-h')}
              >
                <h2 className="gp__t" id={idOf(input, 'ch--also-h')} data-type-role="title">
                  Also by {identity.name}
                </h2>
                {alsoSections.map((section) => (
                  <article key={section.id} {...(frames.take(section) ?? {})}>
                    {present(section.title) ? (
                      <p className="ch-label ch-caps">{section.title}</p>
                    ) : null}
                    <Sub section={section} />
                    <ol className="gp__list" role="list">
                      {alsoBy
                        .filter((entry) => entry.section === section)
                        .map(({ evidence: e }) => (
                          <li key={e.id} className="it" id={idOf(input, e.id)}>
                            <h3 className="it__t" data-type-role="title">
                              <Out url={e.url} input={input}>
                                {e.title ?? e.statement}
                              </Out>
                            </h3>
                            <Md
                              source={e.description}
                              input={input}
                              className="it__text"
                              role="body-compact"
                            />
                            {e.categories?.length || e.locationLabel ? (
                              <p className="it__meta" data-type-role="body-compact">
                                {/* Kind, topic and place: one comma run (P1-8). */}
                                {[e.categories?.length ? listed(e.categories) : '', e.locationLabel]
                                  .filter(present)
                                  .map((part) => part.replace(/\.$/, ''))
                                  .join(', ')}
                                .
                              </p>
                            ) : null}
                            {e.highlights?.length ? (
                              // Figures as At a glance sets them: the figure, then its label, a line each.
                              <ul
                                className="it__figs ch-bars"
                                role="list"
                                data-type-role="body-compact"
                              >
                                {e.highlights.map((h, i) => (
                                  <li key={i}>
                                    <b className="it__fig ch-nobreak">{figureOf(h.label)}</b>{' '}
                                    {h.sub}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {e.url ? (
                              <p className="it__links" data-type-role="body-compact">
                                <Out url={e.url} input={input}>
                                  {e.buttonText ?? 'Visit'}
                                </Out>
                                {present(e.urlLabel) ? (
                                  <span className="it__url"> {e.urlLabel}</span>
                                ) : null}
                              </p>
                            ) : null}
                          </li>
                        ))}
                    </ol>
                  </article>
                ))}
              </section>
            ) : null}
            {uncollected.length > 0 || extras.length > 0 ? (
              <section
                className="gp"
                id={idOf(input, ANCHORS.uncollected)}
                aria-labelledby={idOf(input, 'ch--unc-h')}
              >
                <h2 className="gp__t" id={idOf(input, 'ch--unc-h')} data-type-role="title">
                  Uncollected
                </h2>
                <p className="gp__sub" data-type-role="body-compact">
                  Work with no date to place it in a chapter.
                </p>
                {uncollected.map((group) => (
                  <GroupBlock
                    key={group.section.id}
                    group={group}
                    input={input}
                    framed={frames.take(group.section) !== null}
                    depth={3}
                  />
                ))}
                {extras.map((section) => (
                  <Extra key={section.id} section={section} input={input} frames={frames} />
                ))}
              </section>
            ) : null}
          </Page>
          <Folios verso={start + 2} recto={start + 3} />
        </div>
      ) : null}
      {book.back.parts.some((part) => part.key === 'index') ? (
        <Index input={input} book={book} frames={frames} />
      ) : null}
      <Turnstile
        input={input}
        prev={last ? chapterHalf(input, last, 'Previous chapter') : undefined}
        next={contentsHalf(input)}
      />
    </BookPage>
  );
}
