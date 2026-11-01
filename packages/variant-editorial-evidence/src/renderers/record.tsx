import { Fragment, type ReactNode } from 'react';
import type { ChronologyEntry } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  formatFigure,
  formatNames,
  githubSnapshot,
  Heading,
  MaybeLink,
  PeriodText,
  present,
  recordAnchor,
  renderContext,
  RichText,
  worksByIds,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { figureKey } from '../figures';
import { plateId } from '../model';
import { Caption, homeRegion, joined, Row, Rows, Words } from '../parts';
import type { Env } from '../env';

// The record: the history, the craft, and the public code. A chronology is
// a ruled run of rows, the period ending each title's line, with what was
// made there, what it branched from, and its skills as a sentence in the
// margin. Skills and tools are a ruled two-column list, never chips.
// Services are offers. A GitHub snapshot is a numbered figure of its
// calendar, with its figures in the caption and its pinned repositories as
// rows.

type Props<K extends 'chronology' | 'practice' | 'github'> = SectionRendererProps<SectionOf<K>> & {
  readonly env: Env;
};

/** The works an entry made, each a link to where the page shows it. */
function MadeHere({ entry, ctx, env }: { entry: ChronologyEntry; ctx: RenderContext; env: Env }) {
  const { input } = ctx;
  const works = worksByIds(entry.works, input);
  if (works.length === 0) return null;
  return (
    <p>
      <b>
        <Words input={input}>Made here</Words>
      </b>{' '}
      {works.map((work, index) => {
        const href = env.model.plates.has(work.id)
          ? homeRegion(input, plateId(input, work))
          : anchorSection(work, input)
            ? homeRegion(input, `${input.ids.prefix}${work.id}`)
            : undefined;
        return (
          <span key={work.id} lang={work.lang}>
            {index > 0 ? ', ' : null}
            {href ? <a href={href}>{work.title}</a> : work.title}
          </span>
        );
      })}
    </p>
  );
}

export function ChronologyBody({ section, input, level, env }: Props<'chronology'>) {
  const ctx = renderContext(input, section, level);
  const entries = chronologyOf(section, input);
  const byId = new Map(input.portfolio.chronology.map((entry) => [entry.id, entry]));
  return (
    <Rows ordered>
      {entries.map((entry) => {
        const from = entry.branchesFrom ? byId.get(entry.branchesFrom) : undefined;
        const into = entry.mergesInto ? byId.get(entry.mergesInto) : undefined;
        const list = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
        const note: ReactNode[] = [
          // Only when it made something the page shows: an empty note is no job for the margin.
          worksByIds(entry.works, input).length > 0 ? (
            <MadeHere key="made" entry={entry} ctx={ctx} env={env} />
          ) : null,
          from ? (
            <p key="from">
              <b>
                <Words input={input}>Branches from</Words>
              </b>{' '}
              {joined([from.title, from.organization])}
            </p>
          ) : null,
          into ? (
            <p key="into">
              <b>
                <Words input={input}>Merges into</Words>
              </b>{' '}
              {joined([into.title, into.organization])}
            </p>
          ) : null,
          entry.skills?.length ? <p key="skills">{formatNames(entry.skills, ctx)}.</p> : null,
        ].filter((part) => part !== null);
        // With nothing else for the margin, the entry's description is its note (G2: Education),
        // but only beside a list it leaves in the text column, never an empty row body.
        const margined = note.length === 0 && list.length > 0 && present(entry.description);
        return (
          <Row
            key={entry.id}
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
            level={ctx.itemLevel}
            title={entry.title}
            end={entry.period ? <PeriodText period={entry.period} ctx={ctx} /> : undefined}
            sub={
              entry.organization || entry.location || entry.field ? (
                <span>
                  {joined([
                    entry.field,
                    present(entry.organization) ? (
                      <MaybeLink url={entry.organizationUrl} ctx={ctx}>
                        {entry.organization}
                      </MaybeLink>
                    ) : null,
                    entry.location,
                  ])}
                </span>
              ) : undefined
            }
            note={
              note.length > 0 ? (
                note
              ) : margined ? (
                <RichText source={entry.description!} input={input} />
              ) : undefined
            }
            attributes={{
              'data-chronology-kind': entry.kind,
              'data-thread': entry.thread,
            }}
          >
            {present(entry.description) && !margined ? (
              <RichText source={entry.description} className="ee-prose" input={input} />
            ) : null}
            {list.length > 0 ? (
              <ul className="ee-highlights" role="list">
                {list.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
          </Row>
        );
      })}
    </Rows>
  );
}

export function PracticeBody({ section, input, level, env }: Props<'practice'>) {
  const ctx = renderContext(input, section, level);
  const practice = input.portfolio.practice;
  switch (section.part) {
    case 'thesis':
      return present(practice?.thesis) ? (
        env.place === 'opening' && env.model.thesis ? (
          <>
            <Heading
              level={level}
              className={`ee-thesis__title${env.model.thesis.whole ? ' ee-thesis__title--whole' : ''}`}
            >
              <RichText source={env.model.thesis.headline} inline input={input} />
            </Heading>
            {env.model.thesis.standfirst ? (
              <p className="ee-thesis__stand" data-type-role="quote">
                <RichText source={env.model.thesis.standfirst} inline input={input} />
              </p>
            ) : null}
          </>
        ) : (
          <RichText source={practice.thesis} className="ee-standfirst" input={input} />
        )
      ) : null;
    case 'skills':
      return practice?.skills ? (
        <dl className="ee-pairs ee-pairs--groups">
          {practice.skills.map((group, index) => (
            <div key={index}>
              <dt>
                {present(group.name) ? group.name : formatNames(group.items.slice(0, 1), ctx)}
              </dt>
              <dd>
                {formatNames(group.items, ctx)}
                {present(group.description) ? (
                  <small data-type-role="body-compact">{group.description}</small>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null;
    case 'tools':
      return practice?.tools ? (
        <dl className="ee-pairs ee-pairs--groups">
          {practice.tools.map((group, index) => (
            <div key={index}>
              <dt>{present(group.name) ? group.name : group.items[0]?.name}</dt>
              <dd>
                {/* One run of text, so the list wraps as a sentence, never a comma to a line. */}
                <span>
                  {group.items.map((item, itemIndex) => (
                    <Fragment key={itemIndex}>
                      {itemIndex > 0
                        ? itemIndex === group.items.length - 1
                          ? group.items.length > 2
                            ? ', and '
                            : ' and '
                          : ', '
                        : null}
                      <MaybeLink url={item.url} ctx={ctx}>
                        {item.name}
                      </MaybeLink>
                      {present(item.version) ? ` ${item.version}` : null}
                    </Fragment>
                  ))}
                </span>
                {present(group.description) ? (
                  <small data-type-role="body-compact">{group.description}</small>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null;
    case 'services':
      return practice?.services ? (
        <ul className="ee-offers" role="list">
          {practice.services
            .flatMap((group) => group.items)
            .map((item, index) => (
              <li key={index} className={index === 0 ? 'ee-offer ee-offer--lead' : 'ee-offer'}>
                <Heading level={ctx.itemLevel} className="ee-offer__name">
                  <MaybeLink url={item.url} ctx={ctx}>
                    {item.name}
                  </MaybeLink>
                </Heading>
                {present(item.pricing) ? (
                  <p className="ee-offer__price" data-type-role="body-compact">
                    {item.pricing}
                  </p>
                ) : null}
                {present(item.description) ? (
                  <RichText source={item.description} className="ee-prose" input={input} />
                ) : null}
                {item.highlights?.length ? (
                  <ul className="ee-highlights" role="list">
                    {item.highlights.filter(present).map((highlight, highlightIndex) => (
                      <li key={highlightIndex}>{highlight}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null;
  }
}

/** A link only to an https address: snapshot data names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

const CELL = 14;
const GAP = 3;
const PITCH = CELL + GAP;
const LABEL = 18;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The contribution calendar, a week a column, drawn from the snapshot's days. */
function Calendar({
  days,
  label,
}: {
  days: readonly { date: string; count: number; level: number }[];
  label: string;
}) {
  const first = new Date(`${days[0]!.date}T00:00:00Z`);
  const offset = first.getUTCDay();
  const weeks = Math.ceil((days.length + offset) / 7);
  const width = weeks * PITCH - GAP;
  const height = LABEL + 7 * PITCH - GAP;
  const months: { x: number; text: string }[] = [];
  let lastMonth = -1;
  days.forEach((day, index) => {
    const month = Number(day.date.slice(5, 7)) - 1;
    const week = Math.floor((index + offset) / 7);
    if (month !== lastMonth && (index + offset) % 7 === 0) {
      months.push({ x: week * PITCH, text: MONTHS[month]! });
      lastMonth = month;
    }
  });
  return (
    <svg
      className="ee-cal__svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      {months.map((month) => (
        <text key={`${month.x}-${month.text}`} x={month.x} y={LABEL - 6} className="ee-cal__month">
          {month.text}
        </text>
      ))}
      {days.map((day, index) => {
        const cell = index + offset;
        return (
          <rect
            key={day.date}
            x={Math.floor(cell / 7) * PITCH}
            y={LABEL + (cell % 7) * PITCH}
            width={CELL}
            height={CELL}
            className={`ee-cal__day ee-cal__day--${day.level}`}
          />
        );
      })}
    </svg>
  );
}

const dayText = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
const monthText = (iso: string) =>
  new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

export function GithubBody({ section, input, level, env }: Props<'github'>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  const data = ready?.value;
  const days = data?.contributionCalendar ?? [];
  const excluded = new Set(section.excludeRepos ?? []);
  const repos = (data?.pinnedRepos ?? []).filter((repo) => !excluded.has(repo.name));
  const figures = data
    ? [
        `${formatFigure(data.totalRepos, ctx)} repositories`,
        data.totalStarsReceived !== null
          ? `${formatFigure(data.totalStarsReceived, ctx)} stars received`
          : null,
        data.contributionsLastYear !== null
          ? `${formatFigure(data.contributionsLastYear, ctx)} contributions in the last year`
          : null,
      ].filter((part): part is string => part !== null)
    : [];
  const range =
    days.length > 0 ? `${monthText(days[0]!.date)} to ${monthText(days.at(-1)!.date)}` : undefined;
  const number = env.model.figures.get(figureKey(section.id));
  return (
    <div className="ee-github">
      {days.length > 0 ? (
        <figure className="ee-cal">
          <div
            className="ee-cal__scroll"
            role="region"
            tabIndex={0}
            aria-label={`Contributions by day, ${range}`}
          >
            <Calendar
              days={days}
              label={`${figures.at(-1) ?? 'Contributions'}, by day, ${range}.`}
            />
          </div>
          <figcaption>
            <Caption
              title={
                <>
                  <Words input={input}>Contributions by day</Words>, {range}
                </>
              }
              index={
                number !== undefined ? <Words input={input}>{`Fig. ${number}`}</Words> : undefined
              }
            >
              {figures.length > 0 ? (
                <p>
                  <Words input={input}>{`${formatNames(figures, ctx)}.`}</Words>
                </p>
              ) : null}
            </Caption>
          </figcaption>
        </figure>
      ) : figures.length > 0 ? (
        <p className="ee-github__figures">
          <Words input={input}>{`${formatNames(figures, ctx)}.`}</Words>
        </p>
      ) : null}
      {repos.length > 0 ? (
        <Rows>
          {repos.map((repo) => {
            const href = safeHref(repo.url);
            return (
              <Row
                key={repo.name}
                level={ctx.itemLevel}
                title={href ? <a href={href}>{repo.name}</a> : repo.name}
                end={joined([
                  <Words key="s" input={input}>{`${formatFigure(repo.stars, ctx)} stars`}</Words>,
                  repo.language,
                ])}
                note={present(repo.description) ? <p>{repo.description}</p> : undefined}
              />
            );
          })}
        </Rows>
      ) : null}
      <p className="ee-github__source" data-type-role="body-compact">
        <a href={profile}>{section.username}</a>
        {ready ? (
          <>
            {'. '}
            <Words input={input}>A snapshot from</Words>{' '}
            <time dateTime={ready.derivedAt.slice(0, 10)}>{dayText(ready.derivedAt)}</time>
            {', '}
            <Words input={input}>not a live feed.</Words>
          </>
        ) : null}
      </p>
    </div>
  );
}
