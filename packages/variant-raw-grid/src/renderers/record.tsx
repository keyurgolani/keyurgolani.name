import type { CSSProperties } from 'react';
import type { ChronologyEntry } from '@portfolio/schema';
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
import { keepTail, longestToken } from '../model';
import { Checks, Chips, Fit, Line, Out, Words } from '../parts';
import { peerFit } from './works';
import { RuledTable } from './ruled-table';

// The record: the chronology as a ruled table (study tables say Degree),
// the practice as tape-tab skill rows with outline chips, tool lists in
// cells, and services as offer stickers; the GitHub snapshot as figure
// cells beside its pinned repositories, each a sticker.

export function ChronologyBody({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  const study = entries.length > 0 && entries.every((entry) => entry.kind === 'study');
  const where = (entry: ChronologyEntry) =>
    [entry.organization, entry.location].filter(present).join(', ') || undefined;
  return (
    <RuledTable
      rows={entries}
      variant={study ? 'study' : 'roles'}
      caption={section.title ?? 'Chronology'}
      uiLang={ctx.uiLang}
      rowId={(entry) => recordAnchor(section, entry, input)}
      rowLang={(entry) => entry.lang}
      columns={[
        {
          key: 'when',
          head: 'When',
          className: 'rg-t-date',
          cell: (entry) => <PeriodText period={entry.period} ctx={ctx} />,
        },
        {
          key: 'what',
          head: study ? 'Degree' : 'Role',
          cell: (entry) => (
            <>
              <Heading level={ctx.itemLevel} className="rg-t-title">
                {entry.title}
              </Heading>
              {where(entry) ? (
                <p className="rg-meta">
                  {entry.organizationUrl ? (
                    <Out href={hrefFor(entry.organizationUrl, input)}>{where(entry)}</Out>
                  ) : (
                    where(entry)
                  )}
                </p>
              ) : null}
              {present(entry.field) ? <p className="rg-meta">{entry.field}</p> : null}
            </>
          ),
        },
        {
          key: 'notes',
          head: study ? 'Notes' : 'What it involved',
          cell: (entry) => {
            const list = [...(entry.highlights ?? []), ...(entry.achievements ?? [])];
            if (!present(entry.description) && list.length === 0 && !entry.skills?.length)
              return null;
            return (
              <>
                {present(entry.description) ? (
                  <RichText source={entry.description} input={input} />
                ) : null}
                <Checks items={list} />
                {entry.skills?.length ? <p className="rg-meta">{entry.skills.join(', ')}</p> : null}
              </>
            );
          },
        },
      ]}
    />
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
      <div className="rg-cell rg-about__text">
        <RichText source={practice.thesis} input={input} />
      </div>
    ) : null;
  }
  const groups = (practice?.[section.part] ?? []) as readonly Group[];
  if (section.part === 'skills') {
    return (
      <div className="rg-cell rg-skills">
        {groups.map((group, index) => (
          <div key={index} className="rg-skill">
            {present(group.name) ? (
              <Heading level={ctx.itemLevel} className="rg-skill__tab">
                <Fit text={group.name!} />
              </Heading>
            ) : null}
            {present(group.description) ? (
              <p className="rg-skill__desc">{group.description}</p>
            ) : null}
            <Chips items={group.items.map(nameOf)} />
          </div>
        ))}
      </div>
    );
  }
  if (section.part === 'tools') {
    // Peers at one step: every head is fitted by the longest word across them all.
    const chars = Math.max(
      0,
      ...groups.map((group) => (present(group.name) ? longestToken(group.name) : 0)),
    );
    return (
      <>
        {groups.map((group, index) => (
          <div key={index} className="rg-cell rg-tools">
            {present(group.name) ? (
              <Heading level={ctx.itemLevel} className="rg-tools__k">
                <span className="rg-name" style={{ '--layout-name-chars': chars } as CSSProperties}>
                  {group.name}
                </span>
              </Heading>
            ) : null}
            {present(group.description) ? (
              <p className="rg-skill__desc">{group.description}</p>
            ) : null}
            <ul role="list">
              {group.items.map((item, i) => {
                const tool = typeof item === 'string' ? { name: item } : (item as ToolItem);
                return (
                  <li key={i}>
                    <span>
                      {tool.url ? (
                        <Out href={hrefFor(tool.url, input)}>{tool.name}</Out>
                      ) : (
                        tool.name
                      )}
                    </span>
                    {present(tool.version) ? <span className="rg-num">{tool.version}</span> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </>
    );
  }
  // Services: each offer a sticker card on the bare board, its group's name its meta line, as
  // a work card's line says its role.
  const offers = groups.flatMap((group) =>
    (group.items as readonly OfferItem[]).map((offer) => ({ ...offer, group: group.name })),
  );
  return (
    <div className="rg-bay">
      <ul
        className="rg-board"
        role="list"
        data-count={Math.min(offers.length, 4)}
        {...(offers.length === 2 ? { style: peerFit(offers.map((offer) => offer.name)) } : {})}
      >
        {offers.map((offer, index) => (
          <li key={index} className="rg-slot" data-size={index === 0 ? 'l' : 's'}>
            <article className="rg-card">
              <div className="rg-card__body">
                {present(offer.group) ? <p className="rg-meta">{offer.group}</p> : null}
                <Heading level={ctx.itemLevel} className="rg-card__title">
                  <span
                    className="rg-name"
                    {...(offers.length === 2
                      ? {}
                      : {
                          style: {
                            '--layout-name-chars': longestToken(keepTail(offer.name)),
                          } as CSSProperties,
                        })}
                  >
                    {keepTail(offer.name)}
                  </span>
                </Heading>
                {present(offer.description) ? (
                  <RichText source={offer.description} className="rg-card__sum" input={input} />
                ) : null}
                <Checks items={offer.highlights} />
                {present(offer.pricing) ? <p className="rg-meta">{offer.pricing}</p> : null}
                {offer.url ? (
                  <div className="rg-card__links">
                    <Out className="rg-case" href={hrefFor(offer.url, input)}>
                      <Words lang={ctx.uiLang}>Ask about it</Words>
                    </Out>
                  </div>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
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

export function GithubBody({ section, input, level }: SectionRendererProps<SectionOf<'github'>>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  const figures: [string, number][] = [];
  if (ready) {
    figures.push(['Repositories', ready.value.totalRepos]);
    if (section.showTotalStars !== false && ready.value.totalStarsReceived !== null) {
      figures.push(['Stars received', ready.value.totalStarsReceived]);
    }
    if (ready.value.contributionsLastYear !== null) {
      figures.push(['Contributions in the last year', ready.value.contributionsLastYear]);
    }
  }
  // The year as squares, a picture of the contributions figure beside it: decoration, hidden.
  const calendar = ready ? ready.value.contributionCalendar.slice(-371) : [];
  const excluded = new Set(section.excludeRepos ?? []);
  const repos =
    ready && section.showPinnedRepos !== false
      ? ready.value.pinnedRepos.filter((repo) => !excluded.has(repo.name))
      : [];
  return (
    <>
      {calendar.length > 0 ? (
        <div className="rg-cell rg-heat" aria-hidden="true">
          {calendar.map((day) => (
            <i key={day.date} data-l={day.level} />
          ))}
        </div>
      ) : null}
      <div className="rg-cell rg-gh">
        {figures.length > 0 ? (
          <dl className="rg-gh__figs">
            {figures.map(([label, value]) => (
              <div key={label}>
                <dt>
                  <Words lang={ctx.uiLang}>{label}</Words>
                </dt>
                <dd className="rg-fact__n">{formatFigure(value, ctx)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="rg-meta">
          <Out href={profile}>{section.username}</Out>
          {ready ? (
            <>
              {' '}
              <Words lang={ctx.uiLang}>as of</Words>{' '}
              <time dateTime={ready.derivedAt.slice(0, 10)}>{ready.derivedAt.slice(0, 10)}</time>
            </>
          ) : null}
        </p>
      </div>
      {repos.length > 0 ? (
        <div className="rg-bay">
          <ul
            className="rg-board"
            role="list"
            data-count={Math.min(repos.length, 4)}
            {...(repos.length === 2 ? { style: peerFit(repos.map((repo) => repo.name)) } : {})}
          >
            {repos.map((repo, index) => {
              const href = safeHref(repo.url);
              return (
                <li key={repo.name} className="rg-slot" data-size={index === 0 ? 'l' : 's'}>
                  <article className="rg-card">
                    <div className="rg-card__body">
                      <Heading level={ctx.itemLevel} className="rg-card__title">
                        <span
                          className="rg-name"
                          {...(repos.length === 2
                            ? {}
                            : {
                                style: {
                                  '--layout-name-chars': longestToken(repo.name),
                                } as CSSProperties,
                              })}
                        >
                          {href ? (
                            <a className="rg-stretch" href={href}>
                              {repo.name}
                            </a>
                          ) : (
                            repo.name
                          )}
                        </span>
                      </Heading>
                      {present(repo.description) ? (
                        <p className="rg-card__sum">{repo.description}</p>
                      ) : null}
                      <Line
                        className="rg-meta"
                        parts={[
                          repo.language,
                          repo.stars > 0 ? (
                            <span className="rg-star">
                              ★ {formatFigure(repo.stars, ctx)}
                              <span className="rg-hidden">
                                <Words lang={ctx.uiLang}> stars</Words>
                              </span>
                            </span>
                          ) : null,
                        ]}
                      />
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
