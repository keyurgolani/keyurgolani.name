import type { ReactNode } from 'react';
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
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { ViewGitHubData } from '@portfolio/schema';
import { dateText, folds, recordState, repoKey, said, shownRepos, type HomeModel } from '../model';
import { Out, StateLine, traceAttrs, Words } from '../parts';

// The record on the wall, in the instrument's own forms. The chronology is
// a log table on declared tracks (when, who and where, what it involved,
// its state lamp), the current entries open and the ended ones behind one
// disclosure inside the panel. The practice is a manifest: each group a
// row, its name on the left track and its items on the right; services are
// cells, like works. The GitHub snapshot is telemetry: the facts as
// numerals, the contribution calendar as a square heatmap (hidden from
// assistive technology, its facts said beside it), a language bar on the
// categorical roles, and the repositories as log rows, each one a record
// correlate can light.

/** An entry that hasn't ended: no end date, or one the schema reads as present. */
export const isCurrent = (entry: ChronologyEntry) =>
  entry.period.end === undefined || looseDateOrder(entry.period.end) === Number.POSITIVE_INFINITY;

type Env = { readonly model: HomeModel };

export function ChronologyBody({
  section,
  input,
  level,
  model,
}: SectionRendererProps<SectionOf<'chronology'>> & Env) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  if (entries.length === 0) return null;
  const where = (entry: ChronologyEntry) =>
    [entry.organization, entry.location].filter(present).join(', ') || undefined;
  const row = (entry: ChronologyEntry) => {
    const anchor = recordAnchor(section, entry, input);
    const list = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
    return (
      <li
        key={entry.id}
        id={anchor}
        lang={entry.lang}
        className="mc-log__row mc-chron__row"
        {...traceAttrs(entry.id, model)}
      >
        <p className="mc-log__date mc-num">
          <PeriodText period={entry.period} ctx={ctx} />
        </p>
        <div className="mc-log__main">
          <Heading level={ctx.itemLevel} className="mc-log__title">
            {entry.title}
          </Heading>
          {where(entry) ? (
            <p className="mc-chron__where">
              {entry.organizationUrl ? (
                <Out href={hrefFor(entry.organizationUrl, input)}>{where(entry)}</Out>
              ) : (
                where(entry)
              )}
            </p>
          ) : null}
          {said(entry.field) ? <p className="mc-log__summary">{entry.field}</p> : null}
          {present(entry.description) ? (
            <RichText source={entry.description} className="mc-log__summary" input={input} />
          ) : null}
          {list.length > 0 ? (
            <ul className="mc-ticks">
              {list.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
          {entry.skills?.length ? <p className="mc-cell__meta">{entry.skills.join(', ')}</p> : null}
        </div>
        <div className="mc-log__meta">
          <StateLine
            id={entry.id}
            lamps={recordState(entry, input)}
            anchored={anchor !== undefined}
            model={model}
            input={input}
          />
        </div>
      </li>
    );
  };
  // The home outline (Design gate rule 8): every current entry stays open, newest first; the
  // ended ones fold under one disclosure inside the panel, in the owner's order. With none
  // current, the newest is the open one. A section of studies is already one fold of the
  // full record, so it lists every entry.
  const current = newestFirst(entries.filter(isCurrent));
  const open = current.length > 0 ? current : newestFirst(entries).slice(0, 1);
  const earlier = entries.filter((entry) => !open.includes(entry));
  const folding = !folds(section, input) && earlier.length > 0;
  const roles = earlier.every((entry) => entry.kind === 'role');
  return (
    <>
      <ol className="mc-log mc-chron">{(folding ? open : entries).map(row)}</ol>
      {folding ? (
        <details className="mc-fold mc-fold--inner" data-mc-fold="">
          <summary className="mc-fold__bar mc-fold__bar--inner">
            <span className="mc-count">
              <span className="mc-num">{earlier.length}</span>{' '}
              <Words lang={model.uiLang}>
                {roles
                  ? earlier.length === 1
                    ? 'earlier role'
                    : 'earlier roles'
                  : earlier.length === 1
                    ? 'earlier entry'
                    : 'earlier entries'}
              </Words>
            </span>
          </summary>
          <ol className="mc-log mc-chron">{earlier.map(row)}</ol>
        </details>
      ) : null}
    </>
  );
}

/** A practice group's shape, as the schema gives skills, tools and services. */
interface Group {
  readonly name?: string;
  readonly description?: string;
  readonly items: readonly (string | Tool | Offer)[];
}
interface Tool {
  readonly name: string;
  readonly version?: string;
  readonly url?: string;
}
interface Offer {
  readonly name: string;
  readonly description?: string;
  readonly pricing?: string;
  readonly url?: string;
  readonly highlights?: readonly string[];
}

export function PracticeBody({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'practice'>>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  if (section.part === 'thesis') {
    // A thesis past the anchor: the owner's words whole, as one statement.
    return present(practice?.thesis) ? (
      <RichText source={practice.thesis} className="mc-prose mc-statement" input={input} />
    ) : null;
  }
  const groups = (practice?.[section.part] ?? []) as readonly Group[];
  if (groups.length === 0) return null;
  if (section.part === 'services') {
    return (
      <>
        {groups.map((group, groupIndex) => (
          <div key={groupIndex} className="mc-group">
            {said(group.name) || said(group.description) ? (
              <p className="mc-group__head">
                {said(group.name) ? <span className="mc-group__name">{group.name}</span> : null}
                {said(group.description) ? (
                  <span className="mc-group__note">{group.description}</span>
                ) : null}
              </p>
            ) : null}
            <Offers offers={group.items as readonly Offer[]} ctx={ctx} />
          </div>
        ))}
      </>
    );
  }
  // Skills and tools: a manifest, the group on the left track, its items on the right.
  return <Manifest groups={groups} ctx={ctx} />;
}

/** A services group's offers as cells: the name, what it is, its points and its terms. */
function Offers({ offers, ctx }: { offers: readonly Offer[]; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <ul className="mc-cells">
      {offers.map((offer, index) => (
        <li key={index}>
          <article className="mc-cell">
            <div className="mc-cell__body">
              <Heading level={ctx.itemLevel} className="mc-cell__title">
                {offer.url ? <Out href={hrefFor(offer.url, input)}>{offer.name}</Out> : offer.name}
              </Heading>
              {present(offer.description) ? (
                <RichText source={offer.description} className="mc-cell__summary" input={input} />
              ) : null}
              {offer.highlights?.filter(present).length ? (
                <ul className="mc-ticks">
                  {offer.highlights.filter(present).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {said(offer.pricing) ? <p className="mc-cell__meta">{offer.pricing}</p> : null}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

/** Skills and tools as a manifest: the group on the left track, its items on the right. */
function Manifest({ groups, ctx }: { groups: readonly Group[]; ctx: RenderContext }) {
  const { input } = ctx;
  return (
    <dl className="mc-manifest">
      {groups.map((group, index) => (
        <div key={index} className="mc-manifest__row">
          <dt className="mc-manifest__name">
            {said(group.name) ? group.name : null}
            {said(group.description) ? (
              <span className="mc-manifest__note">{group.description}</span>
            ) : null}
          </dt>
          <dd>
            <ul className="mc-manifest__items">
              {group.items.map((item, i) => {
                const tool = typeof item === 'string' ? { name: item } : (item as Tool);
                return (
                  <li key={i}>
                    {tool.url ? <Out href={hrefFor(tool.url, input)}>{tool.name}</Out> : tool.name}
                    {said(tool.version) ? (
                      <span className="mc-manifest__version mc-num"> {tool.version}</span>
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

/** A link only to an https address: snapshot data names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The heatmap's geometry: one column a week, seven rows of square cells. */
const CELL = 10;
const GAP = 2;

/** The six categorical roles the language bar and dots take, the rest as Other. */
const CATEGORIES = 6;

export function GithubBody({
  section,
  input,
  level,
  model,
}: SectionRendererProps<SectionOf<'github'>> & Env) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const data = ready?.value as ViewGitHubData | undefined;
  const profile = data?.profileUrl
    ? safeHref(data.profileUrl)
    : `https://github.com/${encodeURIComponent(section.username)}`;
  const days =
    data && section.showContributionGraph !== false ? data.contributionCalendar.slice(-364) : [];
  const weeks = Math.ceil(days.length / 7);
  const facts: { label: string; value: number }[] = [];
  if (data) {
    facts.push({
      label: data.totalRepos === 1 ? 'repository' : 'repositories',
      value: data.totalRepos,
    });
    if (section.showTotalStars !== false && data.totalStarsReceived !== null)
      facts.push({ label: 'stars received', value: data.totalStarsReceived });
    if (data.contributionsLastYear !== null)
      facts.push({ label: 'contributions in the last year', value: data.contributionsLastYear });
    else if (days.length > 0)
      facts.push({
        label: 'contributions in the calendar',
        value: days.reduce((sum, day) => sum + day.count, 0),
      });
  }
  const featured = new Set(section.featuredRepos ?? []);
  const { pinned, recent } = data ? shownRepos(section, data) : { pinned: [], recent: [] };
  // A repository's anchor goes on its first appearance only, so every id is once on the page.
  const anchored = new Set<string>();
  const anchorOf = (name: string) => {
    if (anchored.has(name)) return undefined;
    anchored.add(name);
    return `${input.ids.prefix}${repoKey(name)}`;
  };
  const languages = data?.languageBreakdown ?? [];
  const slots = new Map(
    [...pinned, ...recent]
      .map((repo) => repo.language)
      .concat(languages.map(({ language }) => language))
      .filter((language): language is string => typeof language === 'string')
      .filter((language, index, list) => list.indexOf(language) === index)
      .slice(0, CATEGORIES)
      .map((language, index) => [language, index + 1]),
  );
  const dot = (language: string | null): ReactNode =>
    language ? (
      <span className="mc-gh__lang" data-slot={slots.get(language) ?? 0}>
        {language}
      </span>
    ) : null;
  const repoRow = (
    repo: {
      name: string;
      url: string;
      description: string | null;
      language: string | null;
      stars: number;
    },
    when?: string,
  ) => {
    const href = safeHref(repo.url);
    const key = repoKey(repo.name);
    const id = anchorOf(repo.name);
    return (
      <li
        key={`${repo.name}-${when ?? 'pinned'}`}
        id={id}
        className="mc-log__row mc-gh__repo"
        {...traceAttrs(key, model)}
      >
        {when ? (
          <time className="mc-log__date mc-num" dateTime={when.slice(0, 10)}>
            {dateText(when, input.portfolio.locale)}
          </time>
        ) : (
          <span className="mc-log__date mc-num">
            {repo.stars > 0 ? (
              <>
                {formatFigure(repo.stars, ctx)}{' '}
                <Words lang={model.uiLang}>{repo.stars === 1 ? 'star' : 'stars'}</Words>
              </>
            ) : null}
          </span>
        )}
        <div className="mc-log__main">
          <Heading level={ctx.itemLevel} className="mc-log__title mc-gh__name">
            {href ? <Out href={href}>{repo.name}</Out> : repo.name}
          </Heading>
          {said(repo.description) ? <p className="mc-log__summary">{repo.description}</p> : null}
        </div>
        <div className="mc-log__meta">
          {dot(repo.language)}
          {featured.has(repo.name) ? (
            <span className="mc-lamp" data-lamp="information">
              <Words lang={model.uiLang}>Featured</Words>
            </span>
          ) : null}
          <StateLine id={key} lamps={[]} anchored={id !== undefined} model={model} input={input} />
        </div>
      </li>
    );
  };
  return (
    <div className="mc-gh">
      <div className="mc-gh__telemetry">
        {facts.length > 0 ? (
          <ul className="mc-gh__facts">
            {facts.map(({ label, value }) => (
              <li key={label}>
                <span className="mc-num mc-gh__figure">{formatFigure(value, ctx)}</span>{' '}
                <Words lang={model.uiLang}>{label}</Words>
              </li>
            ))}
          </ul>
        ) : null}
        {days.length > 0 ? (
          <svg
            className="mc-gh__heat"
            viewBox={`0 0 ${weeks * (CELL + GAP) - GAP} ${7 * (CELL + GAP) - GAP}`}
            aria-hidden="true"
            focusable="false"
          >
            {days.map((day, index) => (
              <rect
                key={day.date}
                data-level={Math.max(0, Math.min(4, day.level))}
                x={Math.floor(index / 7) * (CELL + GAP)}
                y={(index % 7) * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
              />
            ))}
          </svg>
        ) : null}
        {section.showLanguageBreakdown && languages.length > 0 ? (
          <div className="mc-gh__langs">
            <p className="mc-gh__bar" aria-hidden="true">
              {languages.map((entry) => (
                <span
                  key={entry.language}
                  data-slot={slots.get(entry.language) ?? 0}
                  style={{ flexGrow: Math.max(entry.share, 0.001) }}
                />
              ))}
            </p>
            <ul className="mc-gh__legend">
              {languages.map((entry) => (
                <li key={entry.language}>
                  {dot(entry.language)}{' '}
                  <span className="mc-num">{Math.round(entry.share * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mc-panel__foot mc-gh__source">
          {profile ? <Out href={profile}>{section.username}</Out> : section.username}
          {ready ? (
            <>
              {' '}
              <Words lang={model.uiLang}>as of</Words>{' '}
              <time className="mc-num" dateTime={ready.derivedAt.slice(0, 10)}>
                {dateText(ready.derivedAt, input.portfolio.locale)}
              </time>
            </>
          ) : null}
        </p>
      </div>
      {pinned.length > 0 ? <ol className="mc-log">{pinned.map((repo) => repoRow(repo))}</ol> : null}
      {recent.length > 0 ? (
        <>
          <p className="mc-gh__sub">
            <Words lang={model.uiLang}>Recently pushed</Words>
          </p>
          <ol className="mc-log">{recent.map((repo) => repoRow(repo, repo.pushedAt))}</ol>
        </>
      ) : null}
    </div>
  );
}
