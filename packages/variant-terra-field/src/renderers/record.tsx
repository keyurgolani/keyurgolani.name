import { looseDateOrder, newestFirst, type ChronologyEntry } from '@portfolio/schema';
import {
  chronologyOf,
  formatFigure,
  githubSnapshot,
  Heading,
  hrefFor,
  PeriodText,
  present,
  recordAnchor,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { folds, said } from '../model';
import { Line, Out, Words } from '../parts';

/** An entry that hasn't ended: no end date, or one the schema reads as present. */
const isCurrent = (entry: ChronologyEntry) =>
  entry.period.end === undefined || looseDateOrder(entry.period.end) === Number.POSITIVE_INFINITY;

// The record and the practice, ruled on paper (brief §5.5): the chronology
// as a ruled list, when, who and where, what it involved; skills as text
// columns with hairlines between them; tools as a ruled stack; services as
// offers, each a captioned plate. The GitHub snapshot is a dot calendar,
// hidden from assistive technology, with its facts in the caption beside
// it, and its pinned repositories ruled under it.

export function ChronologyBody({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  const where = (entry: ChronologyEntry) =>
    [entry.organization, entry.location].filter(present).join(', ') || undefined;
  const row = (entry: ChronologyEntry) => {
    const list = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
    return (
      <li key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
        <p className="tf-chron__when tf-compact tf-num">
          <PeriodText period={entry.period} ctx={ctx} />
        </p>
        <div className="tf-chron__who">
          <Heading level={ctx.itemLevel} className="tf-title">
            {entry.title}
          </Heading>
          {where(entry) ? (
            <p className="tf-compact tf-second">
              {entry.organizationUrl ? (
                <Out href={hrefFor(entry.organizationUrl, input)}>{where(entry)}</Out>
              ) : (
                where(entry)
              )}
            </p>
          ) : null}
          {said(entry.field) ? <p className="tf-compact tf-muted">{entry.field}</p> : null}
        </div>
        {present(entry.description) || list.length > 0 || entry.skills?.length ? (
          <div className="tf-chron__what">
            {present(entry.description) ? (
              <RichText source={entry.description} input={input} />
            ) : null}
            {list.length > 0 ? (
              <ul className="tf-dashes tf-compact" role="list">
                {list.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
            {entry.skills?.length ? (
              <p className="tf-compact tf-muted">{entry.skills.join(', ')}</p>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };
  // The home outline (Design gate 8, S-1): the current roles stay open, the ended ones fold
  // under a disclosure inside the section, which a fragment link, print and no script open.
  // Every current entry (no end, or "present") stays open, newest first, whatever order the
  // owner wrote; only the ended ones fold, in theirs (design re-check MF-4). With none current,
  // the newest by period is the open one.
  const current = newestFirst(entries.filter(isCurrent));
  const open = current.length > 0 ? current : newestFirst(entries).slice(0, 1);
  const earlier = entries.filter((entry) => !open.includes(entry));
  // A section of studies is already one fold of the full record; only the roles fold their past.
  const folding = !folds(section, input) && open.length > 0 && earlier.length > 0;
  return (
    <>
      <ol className="tf-chron" role="list">
        {(folding ? open : entries).map(row)}
      </ol>
      {folding ? (
        <details className="tf-fold tf-chron__earlier" data-record="">
          <summary className="tf-fold__summary">
            <span className="tf-title">
              <span className="tf-num">{earlier.length}</span>{' '}
              <Words lang={ctx.uiLang}>
                {earlier.every((entry) => entry.kind === 'role')
                  ? earlier.length === 1
                    ? 'earlier role'
                    : 'earlier roles'
                  : earlier.length === 1
                    ? 'earlier entry'
                    : 'earlier entries'}
              </Words>
            </span>
          </summary>
          <div className="tf-fold__body">
            <ol className="tf-chron" role="list">
              {earlier.map(row)}
            </ol>
          </div>
        </details>
      ) : null}
    </>
  );
}

/** A practice group's shape, as the schema gives skills, tools, and services. */
interface Group {
  readonly name?: string;
  readonly description?: string;
  readonly items: readonly (string | ToolItem | OfferItem)[];
}
interface ToolItem {
  readonly name: string;
  readonly version?: string;
  readonly url?: string;
}
interface OfferItem {
  readonly name: string;
  readonly description?: string;
  readonly pricing?: string;
  readonly url?: string;
  readonly highlights?: readonly string[];
}

const nameOf = (item: string | ToolItem | OfferItem) =>
  typeof item === 'string' ? item : item.name;

export function PracticeBody({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'practice'>>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  if (section.part === 'thesis') {
    return present(practice?.thesis) ? (
      <div className="tf-standalone">
        <RichText source={practice.thesis} className="tf-quote" input={input} />
      </div>
    ) : null;
  }
  const groups = (practice?.[section.part] ?? []) as readonly Group[];
  if (section.part === 'skills') {
    return (
      <div className="tf-skills" data-count={Math.min(groups.length, 4)}>
        {groups.map((group, index) => (
          <div key={index} className="tf-skill">
            {said(group.name) ? (
              <Heading level={ctx.itemLevel} className="tf-title tf-skill__name">
                {group.name}
              </Heading>
            ) : null}
            {said(group.description) ? (
              <p className="tf-caption tf-second">{group.description}</p>
            ) : null}
            <ul className="tf-compact" role="list">
              {group.items.map((item, i) => (
                <li key={i}>{nameOf(item)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  if (section.part === 'tools') {
    return (
      <dl className="tf-stack">
        {groups.map((group, index) => (
          <div key={index}>
            <dt className="tf-title">{said(group.name) ? group.name : null}</dt>
            <dd>
              <ul className="tf-inline tf-compact" role="list">
                {group.items.map((item, i) => {
                  const tool = typeof item === 'string' ? { name: item } : (item as ToolItem);
                  return (
                    <li key={i}>
                      {tool.url ? (
                        <Out href={hrefFor(tool.url, input)}>{tool.name}</Out>
                      ) : (
                        tool.name
                      )}
                      {said(tool.version) ? (
                        <span className="tf-muted tf-num"> {tool.version}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  // Services: each offer a captioned plate on paper.
  const offers = groups.flatMap((group) => group.items as readonly OfferItem[]);
  return (
    <ul className="tf-offers" role="list" data-count={Math.min(offers.length, 2)}>
      {offers.map((offer, index) => (
        <li key={index} className="tf-offer">
          <Heading level={ctx.itemLevel} className="tf-title">
            {offer.name}
          </Heading>
          {present(offer.description) ? (
            <RichText source={offer.description} className="tf-compact tf-second" input={input} />
          ) : null}
          {offer.highlights?.length ? (
            <ul className="tf-ruled tf-compact" role="list">
              {offer.highlights.filter(present).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          {said(offer.pricing) ? <p className="tf-caption">{offer.pricing}</p> : null}
          {offer.url ? (
            <p className="tf-compact">
              <Out href={hrefFor(offer.url, input)}>
                <Words lang={ctx.uiLang}>Ask about it</Words>
              </Out>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** A link only to an https address: snapshot data names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The dot calendar's geometry: one column a week, seven rows. */
const DOT = 10;

export function GithubBody({ section, input, level }: SectionRendererProps<SectionOf<'github'>>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  const days =
    ready && section.showContributionGraph !== false
      ? ready.value.contributionCalendar.slice(-364)
      : [];
  const facts: [string, number][] = [];
  if (ready) {
    const repos = ready.value.totalRepos;
    facts.push([repos === 1 ? 'repository' : 'repositories', repos]);
    if (section.showTotalStars !== false && ready.value.totalStarsReceived !== null) {
      facts.push(['stars received', ready.value.totalStarsReceived]);
    }
    if (ready.value.contributionsLastYear !== null) {
      facts.push(['contributions in the last year', ready.value.contributionsLastYear]);
    } else if (days.length > 0) {
      // The calendar is hidden from assistive technology, so its caption carries what it shows.
      facts.push(['contributions in the calendar', days.reduce((sum, day) => sum + day.count, 0)]);
    }
  }
  const weeks = Math.ceil(days.length / 7);
  const excluded = new Set(section.excludeRepos ?? []);
  const repos =
    ready && section.showPinnedRepos !== false
      ? ready.value.pinnedRepos.filter((repo) => !excluded.has(repo.name)).slice(0, 6)
      : [];
  return (
    <div className="tf-gh">
      <figure className="tf-gh__field">
        {days.length > 0 ? (
          <svg
            className="tf-gh__dots"
            viewBox={`0 0 ${weeks * DOT} ${7 * DOT}`}
            aria-hidden="true"
            focusable="false"
          >
            {days.map((day, index) => (
              <circle
                key={day.date}
                className={`l${Math.max(0, Math.min(4, day.level))}`}
                cx={Math.floor(index / 7) * DOT + DOT / 2}
                cy={(index % 7) * DOT + DOT / 2}
                r={DOT * 0.34}
              />
            ))}
          </svg>
        ) : null}
        <figcaption className="tf-compact">
          {facts.length > 0 ? (
            <span className="tf-gh__facts">
              {facts.map(([label, value], index) => (
                <span key={label}>
                  {index > 0 ? ', ' : null}
                  <span className="tf-num tf-strong">{formatFigure(value, ctx)}</span>{' '}
                  <Words lang={ctx.uiLang}>{label}</Words>
                </span>
              ))}
            </span>
          ) : null}{' '}
          <Out href={profile}>{section.username}</Out>
          {ready ? (
            <>
              {', '}
              <Words lang={ctx.uiLang}>as of</Words>{' '}
              <time dateTime={ready.derivedAt.slice(0, 10)}>{ready.derivedAt.slice(0, 10)}</time>
            </>
          ) : null}
        </figcaption>
      </figure>
      {repos.length > 0 ? (
        <ul className="tf-repos" role="list">
          {repos.map((repo) => {
            const href = safeHref(repo.url);
            return (
              <li key={repo.name}>
                <Heading level={ctx.itemLevel} className="tf-title">
                  {href ? <Out href={href}>{repo.name}</Out> : repo.name}
                </Heading>
                {said(repo.description) ? (
                  <p className="tf-compact tf-second">{repo.description}</p>
                ) : null}
                <Line
                  className="tf-compact tf-muted"
                  parts={[
                    repo.language,
                    repo.stars > 0 ? (
                      <span className="tf-num">
                        {formatFigure(repo.stars, ctx)}{' '}
                        <Words lang={ctx.uiLang}>{repo.stars === 1 ? 'star' : 'stars'}</Words>
                      </span>
                    ) : null,
                  ]}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
