import type { Github } from '@portfolio/schema';
import { fetchGitHubData, type ContributionDay, type GitHubData, type PinnedRepo, type RecentlyActiveRepo } from '@portfolio/kit/github';
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
      <SectionFrame section={section} fallbackTitle="GitHub">
        <p className="editorial-github__unavailable">
          GitHub stats unavailable.{' '}
          <a
            href={`https://github.com/${section.username}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{section.username}
          </a>
        </p>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame section={section} fallbackTitle="GitHub">
      <GithubStats data={data} section={section} />
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

      <p className="editorial-github__profile">
        <a href={data.profileUrl} target="_blank" rel="noopener noreferrer">
          @{data.username}
        </a>
      </p>
    </SectionFrame>
  );
}

function GithubStats({ data, section }: { data: GitHubData; section: Github }) {
  const cells: Array<{ label: string; value: string }> = [];
  cells.push({ label: 'Repositories', value: formatCompactNumber(data.totalRepos) });
  if (section.showTotalStars !== false) {
    cells.push({ label: 'Stars received', value: formatCompactNumber(data.totalStarsReceived) });
  }
  if (data.starsGiven != null) {
    cells.push({ label: 'Stars given', value: formatCompactNumber(data.starsGiven) });
  }
  if (data.contributionsLastYear != null) {
    cells.push({
      label: 'Contributions, past year',
      value: formatCompactNumber(data.contributionsLastYear),
    });
  }

  return (
    <dl className="editorial-github__stats">
      {cells.map((cell) => (
        <div key={cell.label} className="editorial-github__stat">
          <dt className="editorial-github__stat-value">{cell.value}</dt>
          <dd className="editorial-github__stat-label">{cell.label}</dd>
        </div>
      ))}
    </dl>
  );
}

function PinnedReposGrid({ repos }: { repos: PinnedRepo[] }) {
  return (
    <ul className="editorial-github__pinned">
      {repos.map((repo) => (
        <li key={repo.url} className="editorial-github__pin">
          <a className="editorial-github__pin-name" href={repo.url} target="_blank" rel="noopener noreferrer">
            {repo.name}
          </a>
          {repo.description ? (
            <p className="editorial-github__pin-desc">{repo.description}</p>
          ) : null}
          <p className="editorial-github__pin-meta">
            {repo.language ? (
              <span className="editorial-github__pin-lang">
                <span
                  className="editorial-github__pin-lang-dot"
                  style={repo.languageColor ? { backgroundColor: repo.languageColor } : undefined}
                  aria-hidden="true"
                />
                {repo.language}
              </span>
            ) : null}
            <span className="editorial-github__pin-counts">
              {repo.stars > 0 ? `★ ${formatCompactNumber(repo.stars)}` : null}
              {repo.forks > 0 ? `  ⑂ ${formatCompactNumber(repo.forks)}` : null}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function ContributionHeatmap({ days }: { days: ContributionDay[] }) {
  // Bucket into weeks (7-day columns), oldest first.
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
    <div className="editorial-github__heatmap" role="img" aria-label="GitHub contributions over the past year">
      {weeks.map((week, wi) => (
        <div key={wi} className="editorial-github__heatmap-week">
          {week.map((day) => (
            <span
              key={day.date}
              className="editorial-github__heatmap-cell"
              data-level={day.level}
              title={`${day.count} contribution${day.count === 1 ? '' : 's'} on ${day.date}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function RecentlyActiveList({ repos }: { repos: RecentlyActiveRepo[] }) {
  return (
    <ul className="editorial-github__recent">
      {repos.map((repo) => (
        <li key={repo.url} className="editorial-github__recent-row">
          <a
            className="editorial-github__recent-name"
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {repo.name}
          </a>
          {repo.description ? (
            <p className="editorial-github__recent-desc">{repo.description}</p>
          ) : null}
          <p className="editorial-github__recent-meta">
            {repo.language ? (
              <span className="editorial-github__recent-lang">
                <span
                  className="editorial-github__recent-lang-dot"
                  style={repo.languageColor ? { backgroundColor: repo.languageColor } : undefined}
                  aria-hidden="true"
                />
                {repo.language}
              </span>
            ) : null}
            <span className="editorial-github__recent-pushed">
              {formatRelativeTime(repo.pushedAt)}
            </span>
            {repo.stars > 0 ? (
              <span className="editorial-github__recent-stars">
                ★ {formatCompactNumber(repo.stars)}
              </span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

function LanguageBar({ entries }: { entries: GitHubData['languageBreakdown'] }) {
  const top = entries.slice(0, 6);
  return (
    <div className="editorial-github__languages">
      <div className="editorial-github__lang-bar" aria-hidden="true">
        {top.map((entry) => (
          <span
            key={entry.language}
            className="editorial-github__lang-segment"
            style={{
              width: `${(entry.share * 100).toFixed(2)}%`,
              backgroundColor: entry.color ?? 'currentColor',
            }}
          />
        ))}
      </div>
      <ul className="editorial-github__lang-legend">
        {top.map((entry) => (
          <li key={entry.language} className="editorial-github__lang-item">
            <span
              className="editorial-github__lang-dot"
              style={entry.color ? { backgroundColor: entry.color } : undefined}
              aria-hidden="true"
            />
            <span className="editorial-github__lang-name">{entry.language}</span>
            <span className="editorial-github__lang-share">{(entry.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
