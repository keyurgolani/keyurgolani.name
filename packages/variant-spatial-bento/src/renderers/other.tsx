import type { ContributionDay } from '@portfolio/schema';
import {
  formatFigure,
  githubSnapshot,
  Heading,
  MediaFigure,
  present,
  renderContext,
  RichText,
  Ui,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Facts, LinkRow, placed, TileHead } from '../parts';

// The GitHub band and the custom tile. GitHub is the section's frozen
// snapshot and nothing fetched: its figures under the kit's fixed labels, a
// heatmap of the contribution calendar, and the pinned repositories in
// columns. A custom section is its prose and its items.

/** A link only to an https address: snapshot data names GitHub's own pages. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/** The calendar's weeks, Sunday first, padded so the first week starts on its weekday. */
function weeksOf(days: readonly ContributionDay[]) {
  const first = days[0] ? new Date(`${days[0].date}T00:00:00Z`).getUTCDay() : 0;
  const cells: (ContributionDay | null)[] = [...Array<null>(first).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7);
  const months: { week: number; name: string }[] = [];
  let last = -1;
  cells.forEach((day, index) => {
    if (!day) return;
    const month = Number(day.date.slice(5, 7));
    if (month !== last && index % 7 === 0) {
      months.push({
        week: Math.floor(index / 7),
        name: MONTH.format(new Date(`${day.date}T00:00:00Z`)),
      });
      last = month;
    } else if (last === -1) {
      last = month;
    }
  });
  return { cells, weeks, months };
}

function Heatmap({ days, ctx }: { days: readonly ContributionDay[]; ctx: RenderContext }) {
  const { cells, weeks, months } = weeksOf(days);
  return (
    <div className="sb-heat" data-weeks={weeks} aria-hidden="true">
      <ol className="sb-heat__months" lang={ctx.uiLang}>
        {months.slice(1).map(({ week, name }) => (
          <li key={`${week}-${name}`} style={{ gridColumnStart: week + 1 }}>
            {name}
          </li>
        ))}
      </ol>
      <ol className="sb-heat__cells">
        {cells.map((day, index) => (
          <li
            key={index}
            data-level={day ? day.level : undefined}
            data-empty={day ? undefined : ''}
          />
        ))}
      </ol>
    </div>
  );
}

/** The heatmap's key, fewer to more, as decoration beside the sentence the totals make. */
function Legend({ ctx }: { ctx: RenderContext }) {
  return (
    <p className="sb-heat__legend" aria-hidden="true" lang={ctx.uiLang}>
      <span>Fewer</span>
      <span className="sb-heat__key">
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} data-level={level} />
        ))}
      </span>
      <span>More</span>
    </p>
  );
}

export function Github({ section, input, level }: SectionRendererProps<SectionOf<'github'>>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const data = ready?.value;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  const excluded = new Set(section.excludeRepos ?? []);
  const repos =
    data && section.showPinnedRepos !== false
      ? data.pinnedRepos.filter((repo) => !excluded.has(repo.name))
      : [];
  // The totals as one sentence, each figure set firm: never a row of big numbers over labels.
  const contributions = data?.contributionsLastYear ?? null;
  const stars = section.showTotalStars !== false ? (data?.totalStarsReceived ?? null) : null;
  const totals = data
    ? [
        contributions !== null ? (
          <>
            <data className="sb-strong" value={contributions}>
              {formatFigure(contributions, ctx)}
            </data>{' '}
            <Ui ctx={ctx}>contributions in the last year</Ui>
          </>
        ) : null,
        stars !== null ? (
          <>
            <data className="sb-strong" value={stars}>
              {formatFigure(stars, ctx)}
            </data>{' '}
            <Ui ctx={ctx}>{'stars received across'}</Ui>{' '}
            <data className="sb-strong" value={data.totalRepos}>
              {formatFigure(data.totalRepos, ctx)}
            </data>{' '}
            <Ui ctx={ctx}>repositories</Ui>
          </>
        ) : (
          <>
            <data className="sb-strong" value={data.totalRepos}>
              {formatFigure(data.totalRepos, ctx)}
            </data>{' '}
            <Ui ctx={ctx}>repositories</Ui>
          </>
        ),
      ].filter((part) => part !== null)
    : [];
  const asOf = ready ? new Date(ready.derivedAt) : undefined;
  return (
    <>
      <TileHead
        title={section.title}
        subtitle={section.subtitle}
        level={level}
        aside={
          <p className="sb-github__profile">
            <a href={profile} data-outbound="">
              {section.username}
            </a>
          </p>
        }
      />
      {totals.length > 0 || (data && data.contributionCalendar.length > 0) ? (
        <div className="sb-github__totals">
          {totals.length > 0 ? (
            <p className="sb-github__sentence">
              {totals.map((part, index) => (
                <span key={index}>
                  {index > 0 ? ', ' : null}
                  {part}
                </span>
              ))}
              .
            </p>
          ) : null}
          {data && data.contributionCalendar.length > 0 ? <Legend ctx={ctx} /> : null}
        </div>
      ) : null}
      {data && data.contributionCalendar.length > 0 ? (
        <Heatmap days={data.contributionCalendar} ctx={ctx} />
      ) : null}
      {repos.length > 0 ? (
        <ul className="sb-repos" role="list">
          {repos.map((repo) => {
            const href = safeHref(repo.url);
            return (
              <li key={repo.name}>
                <Heading level={ctx.itemLevel} className="sb-strong">
                  {href ? (
                    <a href={href} data-outbound="">
                      {repo.name}
                    </a>
                  ) : (
                    repo.name
                  )}
                </Heading>
                {present(repo.description) ? <p className="sb-quiet">{repo.description}</p> : null}
                <Facts
                  className="sb-label"
                  parts={[
                    repo.language,
                    <>
                      {formatFigure(repo.stars, ctx)} <Ui ctx={ctx}>stars</Ui>
                    </>,
                    <>
                      {formatFigure(repo.forks, ctx)} <Ui ctx={ctx}>forks</Ui>
                    </>,
                  ]}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {asOf && !Number.isNaN(asOf.getTime()) ? (
        <p className="sb-label sb-github__asof">
          <Ui ctx={ctx}>As of</Ui>{' '}
          <time dateTime={asOf.toISOString().slice(0, 10)} lang={ctx.uiLang}>
            {DAY.format(asOf)}
          </time>
        </p>
      ) : null}
    </>
  );
}

export function Custom({ section, input, level }: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      {present(section.body) ? (
        <RichText source={section.body} input={input} className="sb-prose" />
      ) : null}
      {section.items?.length ? (
        <ul className="sb-ruled sb-custom" role="list">
          {section.items.map((item, index) => {
            const image = placed(item.media?.[0], ctx);
            return (
              <li key={index}>
                {image ? (
                  <MediaFigure placed={image} ctx={ctx} sizes="(min-width: 64rem) 40vw, 100vw" />
                ) : null}
                <Heading level={ctx.itemLevel} className="sb-strong">
                  {item.title}
                </Heading>
                {present(item.summary) ? (
                  <RichText source={item.summary} input={input} className="sb-quiet" />
                ) : null}
                <LinkRow links={item.links} ctx={ctx} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
