import {
  chronologyOf,
  githubSnapshot,
  safeHref,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { formatNumber, listAnd, present, squash } from '../model';
import { Phrase, Prose, Span, uiLang, urlHref, Words } from '../parts';
import { Entries, Entry, Facts } from './entry';

// The record's history and practice (brief §5.7, step 5): the chronology as
// entries with their period and place on the facts track; the practice's
// thesis as prose, its skills, tools and services as entries; GitHub as one
// sentence of figures and the pinned repositories as entries. Every link a
// snapshot carries is checked as https before it's an href.

const deeper = (level: number) => Math.min(6, level + 1) as 3 | 4 | 5 | 6;

export function ChronologyRenderer({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  return (
    <Entries>
      {chronologyOf(section, input).map((entry) => {
        const lines = (
          entry.highlights?.length ? entry.highlights : (entry.achievements ?? [])
        ).filter(present);
        const title =
          entry.kind === 'study' && present(entry.field)
            ? `${squash(entry.title)}, ${squash(entry.field)}`
            : squash(entry.title);
        return (
          <Entry
            key={entry.id}
            title={title}
            level={deeper(level)}
            lang={entry.lang}
            meta={
              <Facts
                parts={[
                  <Span key="p" period={entry.period} input={input} />,
                  present(entry.location) ? squash(entry.location) : null,
                ]}
              />
            }
          >
            {present(entry.organization) ? (
              <p className="sg-rec__muted">
                {entry.organizationUrl ? (
                  <a href={urlHref(entry.organizationUrl, input)}>{squash(entry.organization)}</a>
                ) : (
                  squash(entry.organization)
                )}
              </p>
            ) : null}
            {present(entry.description) ? (
              <p className="sg-rec__muted">
                <Phrase source={entry.description} input={input} />
              </p>
            ) : null}
            {lines.length > 0 ? (
              <ul className="sg-rec__list" role="list">
                {lines.map((line) => (
                  <li key={line}>{squash(line)}</li>
                ))}
              </ul>
            ) : null}
            {entry.skills?.some(present) ? (
              <p className="sg-rec__muted">{listAnd(entry.skills.filter(present).map(squash))}</p>
            ) : null}
          </Entry>
        );
      })}
    </Entries>
  );
}

export function PracticeRenderer({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'practice'>>) {
  const practice = input.portfolio.practice;
  if (!practice) return null;
  switch (section.part) {
    case 'thesis':
      return present(practice.thesis) ? (
        <Prose source={practice.thesis} input={input} className="sg-rec__prose" />
      ) : null;
    case 'skills':
      return (
        <Entries>
          {(practice.skills ?? []).map((group, i) => (
            <Entry
              key={`${i}-${group.name ?? ''}`}
              title={present(group.name) ? squash(group.name) : undefined}
              level={deeper(level)}
              meta={present(group.description) ? squash(group.description) : undefined}
            >
              <p className="sg-rec__muted">{group.items.filter(present).map(squash).join(', ')}</p>
            </Entry>
          ))}
        </Entries>
      );
    case 'tools':
      return (
        <Entries>
          {(practice.tools ?? []).map((group, i) => (
            <Entry
              key={`${i}-${group.name ?? ''}`}
              title={present(group.name) ? squash(group.name) : undefined}
              level={deeper(level)}
              meta={present(group.description) ? squash(group.description) : undefined}
            >
              <p className="sg-rec__muted">
                {group.items.map((tool, j) => (
                  <span key={`${j}-${tool.name}`}>
                    {j > 0 ? ', ' : null}
                    {tool.url ? (
                      <a href={urlHref(tool.url, input)}>{squash(tool.name)}</a>
                    ) : (
                      squash(tool.name)
                    )}
                    {present(tool.version) ? ` ${squash(tool.version)}` : null}
                  </span>
                ))}
              </p>
            </Entry>
          ))}
        </Entries>
      );
    case 'services':
      return (
        <Entries>
          {(practice.services ?? []).flatMap((group, i) =>
            group.items.map((service, j) => (
              <Entry
                key={`${i}-${j}-${service.name}`}
                title={squash(service.name)}
                href={service.url ? urlHref(service.url, input) : undefined}
                level={deeper(level)}
                meta={
                  present(service.pricing) || present(group.name) ? (
                    <Facts
                      parts={[
                        present(group.name) ? squash(group.name) : null,
                        present(service.pricing) ? squash(service.pricing) : null,
                      ]}
                    />
                  ) : undefined
                }
              >
                {present(service.description) ? (
                  <p className="sg-rec__muted">
                    <Phrase source={service.description} input={input} />
                  </p>
                ) : null}
                {service.highlights?.length ? (
                  <ul className="sg-rec__list" role="list">
                    {service.highlights.filter(present).map((line) => (
                      <li key={line}>{squash(line)}</li>
                    ))}
                  </ul>
                ) : null}
              </Entry>
            )),
          )}
        </Entries>
      );
    default:
      return null;
  }
}

/** GitHub's figures as one sentence, for the record's one voice. */
function figures(
  input: VariantRenderInput,
  data: {
    totalRepos?: number | null;
    totalStarsReceived?: number | null;
    contributionsLastYear?: number | null;
  },
) {
  const locale = input.portfolio.locale;
  const parts = [
    typeof data.totalRepos === 'number'
      ? `${formatNumber(data.totalRepos, locale)} public repositories`
      : null,
    typeof data.totalStarsReceived === 'number'
      ? `${formatNumber(data.totalStarsReceived, locale)} stars received`
      : null,
    typeof data.contributionsLastYear === 'number'
      ? `${formatNumber(data.contributionsLastYear, locale)} contributions in the last year`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? `${listAnd(parts)}.` : undefined;
}

export function GithubRenderer({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'github'>>) {
  const lang = uiLang(input.portfolio.locale);
  const snapshot = githubSnapshot(section, input);
  const profile = `https://github.com/${encodeURIComponent(section.username.trim())}`;
  const handle = `@${section.username.trim()}`;
  if (!snapshot || snapshot.state !== 'ready') {
    return (
      <p className="sg-rec__line">
        <a href={profile}>
          {handle} <Words lang={lang}>on GitHub</Words>
        </a>
      </p>
    );
  }
  const data = snapshot.value;
  const sentence = figures(input, data);
  const home = safeHref(data.profileUrl ?? '') ?? profile;
  return (
    <>
      <p className="sg-rec__line">
        {sentence ? (
          <>
            <Words lang={lang}>{sentence}</Words>{' '}
          </>
        ) : null}
        <a href={home}>
          {handle} <Words lang={lang}>on GitHub</Words>
        </a>
      </p>
      {data.pinnedRepos.length > 0 ? (
        <Entries>
          {data.pinnedRepos.map((repo) => (
            <Entry
              key={repo.url}
              title={repo.name}
              href={safeHref(repo.url)}
              level={deeper(level)}
              meta={
                <Facts
                  parts={[
                    repo.language ?? null,
                    <Words key="s" lang={lang}>
                      {`${formatNumber(repo.stars, input.portfolio.locale)} ${repo.stars === 1 ? 'star' : 'stars'}`}
                    </Words>,
                  ]}
                />
              }
            >
              {present(repo.description) ? (
                <p className="sg-rec__muted">{repo.description}</p>
              ) : null}
            </Entry>
          ))}
        </Entries>
      ) : null}
    </>
  );
}
