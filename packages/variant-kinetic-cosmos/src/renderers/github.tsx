import type { Github } from '@portfolio/schema';
import {
  formatFigure,
  githubSnapshot,
  Heading,
  present,
  renderContext,
  Ui,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { ArcBodies, Planets } from '../bodies';
import { Phrase } from '../parts';

// The github section in Kinetic Cosmos (redesign, stream E): the
// snapshot's totals as planets, a body a figure with its plate; the pinned
// repositories as bodies on an arc, each hung on a leader above its plate;
// then the profile and the day the snapshot was taken. No contribution
// calendar: that form is Spatial Bento's. Nothing
// fetches: it's the section's snapshot from input.derived, and without one
// the profile link alone shows.

/** A link only to an https address: snapshot data names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The UTC day of an ISO time, written out in English. */
function dayText(at: string): { iso: string; text: string } | undefined {
  const day = new Date(at);
  if (Number.isNaN(day.getTime())) return undefined;
  return {
    iso: day.toISOString().slice(0, 10),
    text: new Intl.DateTimeFormat('en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(day),
  };
}

export function GithubBody({ section, input, level }: SectionRendererProps<Github>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const data = ready?.value;
  const figures: Array<readonly [string, number]> = [];
  if (data) {
    if (data.contributionsLastYear !== null)
      figures.push(['Contributions in the last year', data.contributionsLastYear]);
    if (section.showTotalStars !== false && data.totalStarsReceived !== null) {
      figures.push(['Stars received', data.totalStarsReceived]);
    }
    figures.push(['Repositories', data.totalRepos]);
  }
  const excluded = new Set(section.excludeRepos ?? []);
  const repos =
    section.showPinnedRepos === false
      ? []
      : (data?.pinnedRepos ?? []).filter((repo) => !excluded.has(repo.name));
  const day = ready ? dayText(ready.derivedAt) : undefined;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  return (
    <div className="kc-github">
      {figures.length > 0 ? (
        <Planets
          className="kc-planets--row"
          items={figures.map(([label, value]) => ({
            key: label,
            value: formatFigure(value, ctx),
            magnitude: value,
            plate: <Ui ctx={ctx}>{label}</Ui>,
          }))}
        />
      ) : null}
      <ArcBodies
        className="kc-moons--repos"
        items={repos.map((repo) => {
          const href = safeHref(repo.url);
          return {
            key: repo.name,
            plate: (
              <>
                <Heading level={ctx.itemLevel} className="kc-repo__name">
                  {href ? <a href={href}>{repo.name}</a> : repo.name}
                </Heading>
                {present(repo.description) ? (
                  <p className="kc-repo__description">{repo.description}</p>
                ) : null}
                <Phrase
                  className="kc-repo__facts"
                  role="label"
                  parts={[
                    'language' in repo && typeof repo.language === 'string'
                      ? repo.language
                      : undefined,
                    <span key="stars">
                      {formatFigure(repo.stars, ctx)}{' '}
                      <Ui ctx={ctx}>{repo.stars === 1 ? 'star' : 'stars'}</Ui>
                    </span>,
                    <span key="forks">
                      {formatFigure(repo.forks, ctx)}{' '}
                      <Ui ctx={ctx}>{repo.forks === 1 ? 'fork' : 'forks'}</Ui>
                    </span>,
                  ]}
                />
              </>
            ),
          };
        })}
      />
      <p className="kc-github__profile">
        <a href={profile}>
          <Ui ctx={ctx}>All repositories on GitHub</Ui>
        </a>
        {day ? (
          <>
            {' '}
            <span className="kc-github__as-of" data-type-role="label">
              <Ui ctx={ctx}>As of</Ui>{' '}
              <time dateTime={day.iso} lang={ctx.uiLang}>
                {day.text}
              </time>
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}
