import type { ReactNode } from 'react';
import type { Github, SectionDerived, ViewGitHubData } from '@portfolio/schema';
import {
  formatFigure,
  Heading,
  present,
  renderContext,
  SectionHeader,
  Ui,
  type RenderContext,
} from '../primitives';
import type { SectionRendererProps } from '../types';
import { githubSnapshot } from '../view';

// The github section (#10, slice 1, item 2): what the section's snapshot
// froze at publish, with the date it froze it, and the profile link. Nothing
// fetches at render time. Without a snapshot, the profile link alone shows,
// labeled with the authored username.

/** What the renderer reads of a GitHub snapshot's data, as the view filtered it. */
type GithubSnapshotData = Pick<
  ViewGitHubData,
  'totalRepos' | 'totalStarsReceived' | 'contributionsLastYear' | 'pinnedRepos'
>;

/** What the section's authored fields ask for. */
export interface GithubSectionFields {
  readonly title?: string;
  readonly subtitle?: string;
  readonly username: string;
  readonly showTotalStars?: boolean;
  readonly showPinnedRepos?: boolean;
  readonly excludeRepos?: readonly string[];
}

/** A link only to an https address: snapshot data names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The UTC day of an ISO time, as `<time>`: the date a snapshot froze its values. */
export function SnapshotDate({ at, ctx }: { at: string; ctx: RenderContext }) {
  const day = new Date(at);
  if (Number.isNaN(day.getTime())) return null;
  const iso = day.toISOString().slice(0, 10);
  const text = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(day);
  return (
    <p className="pf-as-of">
      <Ui ctx={ctx}>As of</Ui>{' '}
      <time dateTime={iso} lang={ctx.uiLang}>
        {text}
      </time>
    </p>
  );
}

/** Each figure the snapshot holds, by its fixed label. */
function Figures({
  data,
  fields,
  ctx,
}: {
  data: GithubSnapshotData;
  fields: GithubSectionFields;
  ctx: RenderContext;
}) {
  const figures: Array<readonly [label: string, value: number]> = [
    ['Repositories', data.totalRepos],
  ];
  if (fields.showTotalStars !== false && data.totalStarsReceived !== null) {
    figures.push(['Stars received', data.totalStarsReceived]);
  }
  if (data.contributionsLastYear !== null) {
    figures.push(['Contributions in the last year', data.contributionsLastYear]);
  }
  return (
    <dl className="pf-figures">
      {figures.map(([label, value]) => (
        <div key={label} className="pf-figure-pair">
          <dt>
            <Ui ctx={ctx}>{label}</Ui>
          </dt>
          <dd>{formatFigure(value, ctx)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The pinned repositories, less the excluded ones, each a link with its description. */
function Repositories({
  data,
  fields,
  ctx,
}: {
  data: GithubSnapshotData;
  fields: GithubSectionFields;
  ctx: RenderContext;
}) {
  const excluded = new Set(fields.excludeRepos ?? []);
  const shown = data.pinnedRepos.filter((repo) => !excluded.has(repo.name));
  if (fields.showPinnedRepos === false || shown.length === 0) return null;
  return (
    <ul className="pf-list" role="list">
      {shown.map((repo) => {
        const href = safeHref(repo.url);
        return (
          <li key={repo.name} className="pf-item">
            <Heading level={ctx.itemLevel} className="pf-item__title">
              {href ? <a href={href}>{repo.name}</a> : repo.name}
            </Heading>
            {present(repo.description) ? <p>{repo.description}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The profile link, labeled with the username as the owner wrote it. */
function ProfileLink({ username }: { username: string }): ReactNode {
  return (
    <p className="pf-github">
      <a href={`https://github.com/${encodeURIComponent(username)}`}>{username}</a>
    </p>
  );
}

/** The section's body from its fields and its snapshot, if it has one. */
export function GithubBody({
  fields,
  snapshot,
  ctx,
}: {
  fields: GithubSectionFields;
  snapshot: SectionDerived | undefined;
  ctx: RenderContext;
}) {
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  return (
    <>
      <SectionHeader section={fields} ctx={ctx} />
      {ready ? (
        <>
          <Figures data={ready.value} fields={fields} ctx={ctx} />
          <Repositories data={ready.value} fields={fields} ctx={ctx} />
          <SnapshotDate at={ready.derivedAt} ctx={ctx} />
        </>
      ) : null}
      <ProfileLink username={fields.username} />
    </>
  );
}

/** A github section: its snapshot's values and their date, else the profile link alone. */
export function GithubSection({ section, input, level }: SectionRendererProps<Github>) {
  const ctx = renderContext(input, section, level);
  return <GithubBody fields={section} snapshot={githubSnapshot(section, input)} ctx={ctx} />;
}
