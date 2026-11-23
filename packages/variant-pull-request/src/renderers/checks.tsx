import type { ReactNode } from 'react';
import type { Evidence, Section } from '@portfolio/schema';
import {
  DateText,
  evidenceOf,
  formatFigure,
  githubSnapshot,
  hrefFor,
  MediaFigure,
  placedMedia,
  present,
  recordAnchor,
  renderContext,
  RichText,
  safeHref,
  type RenderContext,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { checkOf, plainText, type Source } from '../model';
import { recordHref, reviewOf, Tick, uiLangOf, Words, type Review } from '../parts';

// The checks (issue #270, behaviour 5): each piece of evidence, and the
// GitHub snapshot, as a passing check. Its summary is the tick, its check
// name (`<type>/<id>`), its claim, its figure, and Passed; opening it shows
// the rest of the record and its sources: its own links, whoever it names,
// the works that cite it (their files), and the records whose highlights
// state its figure (their commits).

/** The figure or the fact a check shows beside its claim. */
function valueOf(entry: Evidence, ctx: RenderContext): string | undefined {
  if (entry.metric?.value !== undefined)
    return `${formatFigure(entry.metric.value, ctx)}${present(entry.metric.unit) ? ` ${entry.metric.unit}` : ''}`;
  if (present(entry.metric?.unit)) return entry.metric.unit;
  return [
    entry.venue,
    entry.organization,
    entry.publication,
    entry.number,
    entry.locationLabel,
  ].find(present);
}

/** Its claim: its title, else its statement's words, else what its metric counts. */
const claimOf = (entry: Evidence) =>
  entry.title ??
  (present(entry.statement) ? plainText(entry.statement) : (entry.metric?.unit ?? entry.id));

function Field({
  name,
  lang,
  children,
}: {
  name: string;
  lang: 'en' | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>
        <Words lang={lang}>{name}</Words>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function SourceItem({
  source,
  input,
  review,
}: {
  source: Source;
  input: VariantRenderInput;
  review: Review;
}) {
  const href =
    source.kind === 'url' || source.kind === 'link' || source.kind === 'source'
      ? source.href
        ? hrefFor(source.href, input)
        : undefined
      : recordHref(input, { id: source.id }, review);
  const file =
    source.kind === 'work' ? review.files.find((each) => each.id === source.id) : undefined;
  const label = file ? file.path : source.label;
  return (
    <li data-source={source.kind}>
      {href ? (
        <a href={href}>{file || source.kind === 'commit' ? <code>{label}</code> : label}</a>
      ) : (
        label
      )}
      {file ? <span className="pr-sr"> ({source.label})</span> : null}
      {source.kind === 'commit' ? <span className="pr-quiet"> {source.label}</span> : null}
      {present(source.quote) ? (
        source.kind === 'url' ? (
          <span className="pr-quiet"> {source.quote}</span>
        ) : (
          <q className="pr-src__q">{source.quote}</q>
        )
      ) : null}
    </li>
  );
}

/** Everything a record holds that its summary doesn't show, by field. */
function Body({
  entry,
  ctx,
  input,
  lang,
}: {
  entry: Evidence;
  ctx: RenderContext;
  input: VariantRenderInput;
  lang: 'en' | undefined;
}) {
  const avatar = entry.source?.avatar ? placedMedia(entry.source.avatar, ctx) : undefined;
  const list = (items: readonly string[] | undefined) => (items ?? []).filter(present);
  const dated = (
    [
      ['Published:', entry.publishedAt],
      ['Presented:', entry.presentedAt],
      ['Received:', entry.receivedAt],
      ['Filed:', entry.filedAt],
      ['Granted:', entry.grantedAt],
      ['As of:', entry.asOf],
    ] as const
  ).filter(([, raw]) => raw !== undefined && String(raw) !== '');
  return (
    <>
      {entry.title !== undefined && present(entry.statement) ? (
        entry.type === 'testimonial' ? (
          <blockquote className="pr-quote">
            <RichText source={entry.statement} input={input} />
          </blockquote>
        ) : (
          <RichText source={entry.statement} input={input} className="pr-prose" />
        )
      ) : null}
      {present(entry.description) ? (
        <RichText source={entry.description} input={input} className="pr-prose" />
      ) : null}
      {present(entry.abstract) ? (
        <RichText source={entry.abstract} input={input} className="pr-prose" />
      ) : null}
      {present(entry.excerpt) ? (
        <blockquote className="pr-quote">
          <RichText source={entry.excerpt} input={input} />
        </blockquote>
      ) : null}
      {(entry.highlights ?? []).length > 0 ? (
        <ul className="pr-figs" role="list">
          {(entry.highlights ?? []).map((item, i) => (
            <li key={i}>
              <b>{item.label}</b> <span>{item.sub}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="pr-trailers">
        {entry.source ? (
          <Field name="Source:" lang={lang}>
            {avatar ? <MediaFigure placed={avatar} ctx={ctx} className="pr-logo" /> : null}
            {entry.source.url ? (
              <a href={hrefFor(entry.source.url, input)}>{entry.source.name}</a>
            ) : (
              entry.source.name
            )}
            {[entry.source.role, entry.source.organization].filter(present).map((part, i) => (
              <span key={i}>, {part}</span>
            ))}
          </Field>
        ) : null}
        {present(entry.citation) ? (
          <Field name="Citation:" lang={lang}>
            {entry.citation}
          </Field>
        ) : list(entry.authors).length > 0 ? (
          <Field name="Authors:" lang={lang}>
            {list(entry.authors).join(', ')}
          </Field>
        ) : null}
        {present(entry.venue) ? (
          <Field name="Venue:" lang={lang}>
            {entry.venue}
          </Field>
        ) : null}
        {present(entry.publication) ? (
          <Field name="Publication:" lang={lang}>
            {entry.publication}
          </Field>
        ) : null}
        {present(entry.author) ? (
          <Field name="Author:" lang={lang}>
            {entry.author}
          </Field>
        ) : null}
        {present(entry.organization) ? (
          <Field name="Organization:" lang={lang}>
            {entry.organization}
          </Field>
        ) : null}
        {present(entry.location) ? (
          <Field name="Location:" lang={lang}>
            {entry.location}
          </Field>
        ) : null}
        {present(entry.locationLabel) ? (
          <Field name="Where:" lang={lang}>
            {entry.locationLabel}
          </Field>
        ) : null}
        {present(entry.number) ? (
          <Field name="Number:" lang={lang}>
            {entry.number}
          </Field>
        ) : null}
        {list(entry.inventors).length > 0 ? (
          <Field name="Inventors:" lang={lang}>
            {list(entry.inventors).join(', ')}
          </Field>
        ) : null}
        {present(entry.assignee) ? (
          <Field name="Assignee:" lang={lang}>
            {entry.assignee}
          </Field>
        ) : null}
        {list(entry.awards).length > 0 ? (
          <Field name="Awards:" lang={lang}>
            {list(entry.awards).join(', ')}
          </Field>
        ) : null}
        {list(entry.categories).length > 0 ? (
          <Field name="Categories:" lang={lang}>
            {list(entry.categories).join(', ')}
          </Field>
        ) : null}
        {present(entry.doi) ? (
          <Field name="DOI:" lang={lang}>
            <code>{entry.doi}</code>
          </Field>
        ) : null}
        {dated.map(([name, raw]) => (
          <Field key={name} name={name} lang={lang}>
            <DateText raw={String(raw)} ctx={ctx} />
          </Field>
        ))}
        {[
          ['pdfUrl', 'PDF', entry.pdfUrl],
          ['slidesUrl', 'Slides', entry.slidesUrl],
          ['videoUrl', 'Video', entry.videoUrl],
        ].flatMap(([key, name, url]) =>
          url ? (
            <Field key={key} name={`${name}:`} lang={lang}>
              <a href={hrefFor(url, input)}>{url}</a>
            </Field>
          ) : (
            []
          ),
        )}
      </dl>
    </>
  );
}

/** Whether a record holds anything its summary doesn't show, so its check opens. */
function hasDetail(entry: Evidence): boolean {
  const lists = [entry.authors, entry.inventors, entry.awards, entry.categories, entry.highlights];
  return (
    (entry.title !== undefined && present(entry.statement)) ||
    [
      entry.description,
      entry.abstract,
      entry.excerpt,
      entry.citation,
      entry.venue,
      entry.publication,
      entry.author,
      entry.organization,
      entry.location,
      entry.locationLabel,
      entry.number,
      entry.assignee,
      entry.doi,
      entry.pdfUrl,
      entry.slidesUrl,
      entry.videoUrl,
      entry.publishedAt,
      entry.presentedAt,
      entry.receivedAt,
      entry.filedAt,
      entry.grantedAt,
      entry.asOf,
    ].some((field) => field !== undefined && present(String(field))) ||
    entry.source !== undefined ||
    lists.some((list) => (list ?? []).length > 0)
  );
}

/** One piece of evidence as a check. */
export function CheckItem({
  entry,
  section,
  input,
  review,
  ctx,
  lang,
}: {
  entry: Evidence;
  section: Section;
  input: VariantRenderInput;
  review: Review;
  ctx: RenderContext;
  lang: 'en' | undefined;
}) {
  const check = checkOf(entry, input.portfolio);
  const value = valueOf(entry, ctx);
  const claim = claimOf(entry);
  const sources = check.sources.map((source) =>
    source.kind === 'url' && present(entry.buttonText)
      ? {
          ...source,
          label: entry.buttonText,
          ...(present(entry.urlLabel) ? { quote: entry.urlLabel } : {}),
        }
      : source,
  );
  const summary = (
    <>
      <Tick />
      <span className="pr-check__t">{claim}</span>
      <span className="pr-check__meta">
        <code className="pr-check__n">{check.name}</code>
        {present(value) && value !== claim ? <span className="pr-check__v">{value}</span> : null}
        <span className="pr-check__ok">
          <Words lang={lang}>Passed</Words>
        </span>
      </span>
    </>
  );
  return (
    <li
      className="pr-check"
      id={recordAnchor(section, entry, input)}
      data-type={entry.type}
      lang={entry.lang}
    >
      {sources.length > 0 || hasDetail(entry) ? (
        <details className="pr-check__d">
          <summary className="pr-check__s">{summary}</summary>
          <div className="pr-check__b">
            <Body entry={entry} ctx={ctx} input={input} lang={lang} />
            {sources.length > 0 ? (
              <>
                <p className="pr-src__h">
                  <Words lang={lang}>{sources.length === 1 ? 'Source' : 'Sources'}</Words>
                </p>
                <ul className="pr-src" role="list">
                  {sources.map((source, i) => (
                    <SourceItem key={i} source={source} input={input} review={review} />
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="pr-check__s">{summary}</p>
      )}
    </li>
  );
}

export const Checks: SectionRenderer<SectionOf<'evidence'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const review = reviewOf(input);
  const lang = uiLangOf(input);
  return (
    <ol className="pr-checks" role="list">
      {evidenceOf(section, input).map((entry) => (
        <CheckItem
          key={entry.id}
          entry={entry}
          section={section}
          input={input}
          review={review}
          ctx={ctx}
          lang={lang}
        />
      ))}
    </ol>
  );
};

/**
 * The GitHub snapshot as a check: what it froze and when, the pinned
 * repositories as a listing, and the profile. With no snapshot, the profile
 * link alone, as a check that hasn't run.
 */
export const Snapshot: SectionRenderer<SectionOf<'github'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const lang = uiLangOf(input);
  const snapshot = githubSnapshot(section, input);
  const profile = `https://github.com/${section.username}`;
  const ready = snapshot?.state === 'ready' ? snapshot.value : undefined;
  const figures = ready
    ? [
        { value: ready.totalRepos, words: 'repositories' },
        ready.totalStarsReceived !== null
          ? { value: ready.totalStarsReceived, words: 'stars' }
          : undefined,
        ready.contributionsLastYear !== null
          ? { value: ready.contributionsLastYear, words: 'contributions in the last year' }
          : undefined,
      ].filter((figure): figure is { value: number; words: string } => figure !== undefined)
    : [];
  const featured = section.featuredRepos ?? [];
  const repos = ready
    ? [...ready.pinnedRepos].sort(
        (a, b) => Number(featured.includes(b.name)) - Number(featured.includes(a.name)),
      )
    : [];
  return (
    <ol className="pr-checks" role="list">
      <li className="pr-check" data-type="github" data-state={ready ? 'passed' : 'skipped'}>
        <details className="pr-check__d">
          <summary className="pr-check__s">
            {ready ? <Tick /> : <span className="pr-ring" aria-hidden="true" />}
            <span className="pr-check__t">
              <span aria-hidden="true">github.com/</span>
              {section.username}
            </span>
            <span className="pr-check__meta">
              <code className="pr-check__n">snapshot/github</code>
              {figures.length > 0 ? (
                <span className="pr-check__v">
                  {formatFigure(figures[0]!.value, ctx)}{' '}
                  <Words lang={lang}>{figures[0]!.words}</Words>
                </span>
              ) : null}
              <span className="pr-check__ok">
                <Words lang={lang}>{ready ? 'Passed' : 'Skipped'}</Words>
              </span>
            </span>
          </summary>
          <div className="pr-check__b">
            {ready ? (
              <>
                <ul className="pr-figs" role="list">
                  {figures.map((figure, i) => (
                    <li key={i}>
                      <b>{formatFigure(figure.value, ctx)}</b>{' '}
                      <Words lang={lang}>{figure.words}</Words>
                    </li>
                  ))}
                </ul>
                {repos.length > 0 ? (
                  <ul className="pr-repos" role="list">
                    {repos.map((repo) => {
                      const href = safeHref(repo.url);
                      return (
                        <li key={repo.name}>
                          <code>{href ? <a href={href}>{repo.name}</a> : repo.name}</code>
                          {present(repo.language) ? (
                            <span className="pr-quiet"> {repo.language}</span>
                          ) : null}
                          <span className="pr-quiet">
                            {' '}
                            <span aria-hidden="true">{'★'} </span>
                            {formatFigure(repo.stars, ctx)}
                            <span className="pr-sr">
                              {' '}
                              <Words lang={lang}>stars</Words>
                            </span>
                          </span>
                          {present(repo.description) ? <p>{repo.description}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </>
            ) : null}
            <p className="pr-src__h">
              <Words lang={lang}>Source</Words>
            </p>
            <ul className="pr-src" role="list">
              <li data-source="url">
                <a href={hrefFor(profile, input)}>github.com/{section.username}</a>
              </li>
            </ul>
          </div>
        </details>
      </li>
    </ol>
  );
};
