import type { Github } from '@portfolio/schema';
import {
  fetchGitHubData,
  type ContributionDay,
  type GitHubData,
  type PinnedRepo,
  type RecentlyActiveRepo,
} from '@portfolio/kit/github';
import { formatCompactNumber, formatRelativeTime } from '@portfolio/kit';
import { SectionFrame } from '../primitives/section-frame';

export async function GithubRenderer({ section }: { section: Github }) {
  const data = await fetchGitHubData({
    username: section.username,
    showContributionGraph: section.showContributionGraph,
    showPinnedRepos: section.showPinnedRepos,
    showTotalStars: section.showTotalStars,
    showLanguageBreakdown: section.showLanguageBreakdown,
    showRecentlyActive: section.showRecentlyActive,
    recentlyActiveLimit: section.recentlyActiveLimit,
    featuredRepos: section.featuredRepos,
    excludeRepos: section.excludeRepos,
  });

  if (!data) {
    return (
      <SectionFrame section={section} fallbackTitle="GitHub" gradientTitle>
        <p className="kc-empty">
          GitHub stats unavailable.{' '}
          <a href={`https://github.com/${section.username}`} target="_blank" rel="noopener noreferrer">
            @{section.username}
          </a>
        </p>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame section={section} fallbackTitle="GitHub" gradientTitle>
      <GitHubStats data={data} section={section} />
      {section.showContributionGraph !== false && data.contributionCalendar.length > 0 ? (
        <ContributionHeatmap days={data.contributionCalendar} />
      ) : null}
      {section.showPinnedRepos !== false && data.pinnedRepos.length > 0 ? (
        <PinnedReposGrid repos={data.pinnedRepos} />
      ) : null}
      {section.showRecentlyActive !== false && data.recentlyActive.length > 0 ? (
        <RecentlyActiveList repos={data.recentlyActive} />
      ) : null}
      {section.showLanguageBreakdown && data.languageBreakdown.length > 0 ? (
        <LanguageBar entries={data.languageBreakdown} />
      ) : null}
      <p className="kc-github__profile">
        <a href={data.profileUrl} target="_blank" rel="noopener noreferrer">
          @{data.username}
        </a>
      </p>
    </SectionFrame>
  );
}

function GitHubStats({ data, section }: { data: GitHubData; section: Github }) {
  const cells: Array<{ label: string; value: string }> = [];
  cells.push({ label: 'Repos', value: formatCompactNumber(data.totalRepos) });
  if (section.showTotalStars !== false) {
    cells.push({ label: 'Stars', value: formatCompactNumber(data.totalStarsReceived) });
  }
  if (data.contributionsLastYear != null) {
    cells.push({
      label: 'Contributions, past year',
      value: formatCompactNumber(data.contributionsLastYear),
    });
  }
  return (
    <div className="kc-github__stats">
      {cells.map((c) => (
        <div key={c.label} className="kc-card kc-github__stat">
          <span className="kc-github__stat-value">{c.value}</span>
          <span className="kc-github__stat-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function ContributionHeatmap({ days }: { days: ContributionDay[] }) {
  const weeks: ContributionDay[][] = [];
  let current: ContributionDay[] = [];
  for (const day of days) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length) weeks.push(current);

  return (
    <div
      className="kc-card kc-github__heatmap"
      role="img"
      aria-label="GitHub contributions over the past year"
    >
      <div className="kc-github__heatmap-grid">
        {weeks.map((week, wi) => (
          <div key={wi} className="kc-github__heatmap-week">
            {week.map((day) => (
              <span
                key={day.date}
                className="kc-github__heatmap-cell"
                data-level={day.level}
                title={`${day.count} contribution${day.count === 1 ? '' : 's'} on ${day.date}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PinnedReposGrid({ repos }: { repos: PinnedRepo[] }) {
  return (
    <div className="kc-github__pinned">
      {repos.map((repo) => (
        <article key={repo.url} className="kc-card kc-card--hoverable kc-github__pin">
          <a className="kc-github__pin-name" href={repo.url} target="_blank" rel="noopener noreferrer">
            {repo.name}
          </a>
          {repo.description ? <p className="kc-github__pin-desc">{repo.description}</p> : null}
          <p className="kc-github__pin-meta">
            {repo.language ? (
              <span className="kc-github__pin-lang">
                <span
                  className="kc-github__pin-dot"
                  style={repo.languageColor ? { backgroundColor: repo.languageColor } : undefined}
                  aria-hidden="true"
                />
                {repo.language}
              </span>
            ) : null}
            {repo.stars > 0 ? <span>★ {formatCompactNumber(repo.stars)}</span> : null}
            {repo.forks > 0 ? <span>⑂ {formatCompactNumber(repo.forks)}</span> : null}
          </p>
        </article>
      ))}
    </div>
  );
}

function RecentlyActiveList({ repos }: { repos: RecentlyActiveRepo[] }) {
  return (
    <ul className="kc-card kc-github__recent">
      {repos.map((repo) => (
        <li key={repo.url} className="kc-github__recent-row">
          <a className="kc-github__recent-name" href={repo.url} target="_blank" rel="noopener noreferrer">
            {repo.name}
          </a>
          <span className="kc-github__recent-pushed">{formatRelativeTime(repo.pushedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function LanguageBar({ entries }: { entries: GitHubData['languageBreakdown'] }) {
  const top = entries.slice(0, 6);
  return (
    <div className="kc-card kc-github__lang">
      <div className="kc-github__lang-bar" aria-hidden="true">
        {top.map((entry) => (
          <span
            key={entry.language}
            className="kc-github__lang-segment"
            style={{
              width: `${(entry.share * 100).toFixed(2)}%`,
              backgroundColor: entry.color ?? 'currentColor',
            }}
          />
        ))}
      </div>
      <ul className="kc-github__lang-legend">
        {top.map((entry) => (
          <li key={entry.language} className="kc-github__lang-item">
            <span
              className="kc-github__lang-dot"
              style={entry.color ? { backgroundColor: entry.color } : undefined}
              aria-hidden="true"
            />
            <span>{entry.language}</span>
            <span className="kc-github__lang-share">{(entry.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
