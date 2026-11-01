import type { Section } from '@portfolio/schema';
import type { SectionRendererProps } from '@portfolio/kit/sections';
import { formatNumber, githubView } from '../model';
import { Out, uiLang, Words } from '../parts';

// GitHub (brief §5.2): a totals sentence that honours the section's show*
// flags, contribution rays drawn from the snapshot's calendar (one ray per
// week, its length the week's contributions; aria-hidden, since the
// sentence says what they show), and the pinned repositories as rows. All
// from the publish-frozen snapshot, never a fetch.

type Github = Extract<Section, { kind: 'github' }>;

export function GithubRenderer({ section, input }: SectionRendererProps<Github>) {
  const lang = uiLang(input.portfolio.locale);
  const view = githubView(section, input);
  if (!view) {
    return (
      <p className="ag-row__sum" data-type-role="body-compact">
        <a href={`https://github.com/${encodeURIComponent(section.username)}`}>
          <Words lang={lang}>On GitHub as </Words>
          {section.username}
          <Out href="https://github.com/" />
        </a>
      </p>
    );
  }
  const peak = Math.max(1, ...view.weeks);
  const width = view.weeks.length * 6;
  return (
    <>
      <p className="ag-gh__totals" data-type-role="title">
        <Words lang={lang}>{view.totals}</Words>
      </p>
      {view.weeks.length > 0 ? (
        <svg
          className="ag-rays"
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {view.weeks.map((count, index) => {
            const length = count === 0 ? 2 : 6 + (94 * count) / peak;
            return (
              <rect
                key={index}
                className={count === 0 ? 'ag-ray ag-ray--none' : 'ag-ray'}
                x={index * 6 + 1}
                y={100 - length}
                width="4"
                height={length}
                rx="2"
              />
            );
          })}
        </svg>
      ) : null}
      {view.repos.length > 0 ? (
        <ul className="ag-rows ag-repos" role="list">
          {view.repos.map((repo) => (
            <li key={repo.name} className="ag-row ag-repo">
              <p className="ag-row__title" data-type-role="title">
                {repo.url ? (
                  <a href={repo.url}>
                    {repo.name}
                    <Out href={repo.url} />
                  </a>
                ) : (
                  repo.name
                )}
              </p>
              {repo.description ? (
                <p className="ag-row__sum" data-type-role="body-compact">
                  {repo.description}
                </p>
              ) : null}
              <p className="ag-row__foot" data-type-role="caption">
                {repo.language ? <span>{repo.language}</span> : null}
                <span className="ag-num">
                  <Words lang={lang}>
                    {`${formatNumber(repo.stars, input.portfolio.locale)} ${repo.stars === 1 ? 'star' : 'stars'}`}
                  </Words>
                </span>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="ag-row__foot" data-type-role="caption">
        <a href={view.profileUrl}>
          <Words lang={lang}>Everything on GitHub</Words>
          <Out href={view.profileUrl} />
        </a>
      </p>
    </>
  );
}
