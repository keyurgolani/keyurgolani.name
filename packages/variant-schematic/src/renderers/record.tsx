import {
  githubSnapshot,
  hrefFor,
  safeHref,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import {
  entriesOf,
  githubRepos,
  penTrace,
  present,
  revisionsOf,
  sheetSet,
  weeklySums,
} from '../model';
import { Caption, figure, Phrase, Port, Prose, Span, Ui, When, words } from '../parts';

// The record's forms (brief §5.4, step 7): chronology as a revision block,
// counting down, with "branches from rev nn"; practice as a general note
// (the thesis), a bill of materials (skills), a parts list (tools) and work
// orders (services); GitHub as a parts index with its pen trace, the weekly
// sums of the snapshot's calendar, the busiest week stated from the data.

export function ChronologyRenderer({
  section,
  input,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const { t, lang } = words(input);
  const entries = entriesOf(section, input);
  const revs = revisionsOf(entries);
  const study = entries.every((entry) => entry.kind === 'study');
  return (
    <table className="sx-table sx-revs">
      <thead data-type-role="label">
        <tr>
          <th scope="col">
            <Ui lang={lang}>{t.rev}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.period}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.description}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{study ? t.place : t.thread}</Ui>
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const list = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
          const from = entry.branchesFrom ? revs.get(entry.branchesFrom) : undefined;
          const place = study ? entry.location : entry.thread;
          const skills = (entry.skills ?? []).filter(present);
          return (
            <tr key={entry.id} lang={entry.lang}>
              <td className="sx-rev" data-type-role="numeric">
                {revs.get(entry.id)}
              </td>
              <td className="sx-nowrap" data-type-role="body-compact">
                <Span period={entry.period} input={input} />
              </td>
              <td>
                <p className="sx-row-title" data-type-role="body">
                  {entry.title}
                  {present(entry.field) ? ` ${entry.field}` : null}
                  {present(entry.organization) ? (
                    <>
                      {', '}
                      {entry.organizationUrl ? (
                        <Port href={hrefFor(entry.organizationUrl, input)}>
                          {entry.organization}
                        </Port>
                      ) : (
                        entry.organization
                      )}
                    </>
                  ) : null}
                </p>
                {present(entry.description) ? (
                  <Prose source={entry.description} input={input} className="sx-row-body" />
                ) : null}
                {list.length ? (
                  <ul className="sx-row-list" data-type-role="body-compact">
                    {list.map((item, i) => (
                      <li key={i}>
                        <Phrase source={item} input={input} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* The skills a revision drew on, as a parts call-out under its list. */}
                {skills.length ? (
                  <p className="sx-row-body" data-type-role="body-compact">
                    <span className="sx-field-name" data-type-role="label">
                      <Ui lang={lang}>{t.skills}</Ui>
                    </span>{' '}
                    {skills.join(', ')}
                  </p>
                ) : null}
              </td>
              <td data-type-role="body-compact">
                {present(place) ? place : null}
                {/* Past a study table the place column is the thread, so the location sits under it. */}
                {!study && present(entry.location) ? (
                  <span className="sx-row-body sx-muted">{entry.location}</span>
                ) : null}
                {from ? (
                  <span className="sx-branch" data-type-role="label">
                    <Ui lang={lang}>{t.branchesFrom(from)}</Ui>
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PracticeRenderer({ section, input }: SectionRendererProps<SectionOf<'practice'>>) {
  const { t, lang } = words(input);
  const practice = input.portfolio.practice;
  if (section.part === 'thesis') {
    return present(practice?.thesis) ? (
      <div className="sx-general">
        <Prose source={practice.thesis} input={input} />
      </div>
    ) : null;
  }
  if (section.part === 'services') {
    // Each work order carries its group's name, when the group has one, on the group's first order.
    const items = (practice?.services ?? []).flatMap((group) =>
      group.items.map((item, i) => ({ item, group: i === 0 ? group.name : undefined })),
    );
    return (
      <ol className="sx-orders" role="list">
        {items.map(({ item, group }, i) => (
          <li key={i} className="sx-order">
            {present(group) ? (
              <p className="sx-order__group" data-type-role="label">
                {group}
              </p>
            ) : null}
            <p className="sx-order__head">
              <span data-type-role="numeric">WO-{i + 1}</span>{' '}
              <span data-type-role="title">
                {item.url ? <Port href={hrefFor(item.url, input)}>{item.name}</Port> : item.name}
              </span>
            </p>
            <dl data-type-role="body-compact">
              {present(item.description) ? (
                <>
                  <dt data-type-role="label">
                    <Ui lang={lang}>{t.scope}</Ui>
                  </dt>
                  <dd>
                    <Phrase source={item.description} input={input} />
                  </dd>
                </>
              ) : null}
              {item.highlights?.length ? (
                <>
                  <dt data-type-role="label">
                    <Ui lang={lang}>{t.deliverables}</Ui>
                  </dt>
                  <dd>{item.highlights.filter(present).join('; ')}</dd>
                </>
              ) : null}
              {present(item.pricing) ? (
                <>
                  <dt data-type-role="label">
                    <Ui lang={lang}>{t.terms}</Ui>
                  </dt>
                  <dd>{item.pricing}</dd>
                </>
              ) : null}
            </dl>
          </li>
        ))}
      </ol>
    );
  }
  const skills = section.part === 'skills';
  const groups = (skills ? practice?.skills : practice?.tools) ?? [];
  return (
    <table className="sx-table sx-bom">
      <thead data-type-role="label">
        <tr>
          <th scope="col">
            <Ui lang={lang}>{t.item}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{t.group}</Ui>
          </th>
          <th scope="col">
            <Ui lang={lang}>{skills ? t.contents : t.partsWithVersion}</Ui>
          </th>
          <th scope="col" className="sx-num">
            <Ui lang={lang}>{t.qty}</Ui>
          </th>
        </tr>
      </thead>
      <tbody data-type-role="body-compact">
        {groups.map((group, i) => (
          <tr key={i}>
            <td className="sx-rev" data-type-role="numeric">
              {i + 1}
            </td>
            <th scope="row">
              {present(group.name) ? <span className="sx-row-title">{group.name}</span> : null}
              {present(group.description) ? (
                <span className="sx-row-body">{group.description}</span>
              ) : null}
            </th>
            <td>
              {skills
                ? (group.items as readonly string[]).join(', ')
                : (group.items as readonly { name: string; url?: string; version?: string }[]).map(
                    (tool, j) => (
                      <span key={j}>
                        {j > 0 ? ', ' : ''}
                        {tool.url ? (
                          <Port href={hrefFor(tool.url, input)}>{tool.name}</Port>
                        ) : (
                          tool.name
                        )}
                        {present(tool.version) ? (
                          <span className="sx-muted" data-type-role="numeric">
                            {' '}
                            {tool.version}
                          </span>
                        ) : null}
                      </span>
                    ),
                  )}
            </td>
            <td className="sx-num" data-type-role="numeric">
              {group.items.length}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GithubRenderer({ section, input }: SectionRendererProps<SectionOf<'github'>>) {
  const { t, lang } = words(input);
  const snapshot = githubSnapshot(section, input);
  const profile = `https://github.com/${section.username}`;
  if (!snapshot || snapshot.state !== 'ready') {
    return (
      <p data-type-role="body">
        <Port href={hrefFor(profile, input)}>github.com/{section.username}</Port>
      </p>
    );
  }
  const data = snapshot.value;
  const repos = githubRepos(section, input) ?? [];
  const pushed = new Map(data.recentlyActive.map((repo) => [repo.name, repo.pushedAt]));
  const weeks = weeklySums(data.contributionCalendar);
  const trace =
    section.showContributionGraph !== false && weeks.length >= 2 ? penTrace(weeks) : undefined;
  const fig = sheetSet(input).viewOf.get(section.id)?.fig;
  const days = data.contributionCalendar;
  return (
    <div className="sx-gh">
      <p className="sx-gh__totals" data-type-role="body">
        <b data-type-role="numeric">{figure(data.totalRepos, input)}</b>{' '}
        <Ui lang={lang}>{t.repositories}</Ui>,{' '}
        <b data-type-role="numeric">{figure(data.totalStarsReceived, input)}</b>{' '}
        <Ui lang={lang}>{t.starsReceived}</Ui>
        {typeof data.contributionsLastYear === 'number' ? (
          <>
            , <b data-type-role="numeric">{figure(data.contributionsLastYear, input)}</b>{' '}
            <Ui lang={lang}>{t.contributions}</Ui>
          </>
        ) : null}
        .{' '}
        {safeHref(data.profileUrl) ? (
          <Port href={hrefFor(data.profileUrl, input)}>github.com/{data.username}</Port>
        ) : null}
      </p>
      {repos.length ? (
        <table className="sx-table sx-parts">
          <thead data-type-role="label">
            <tr>
              <th scope="col">
                <Ui lang={lang}>{t.repository}</Ui>
              </th>
              <th scope="col">
                <Ui lang={lang}>{t.language}</Ui>
              </th>
              <th scope="col" className="sx-num">
                <Ui lang={lang}>{t.stars}</Ui>
              </th>
              <th scope="col">
                <Ui lang={lang}>{t.lastChange}</Ui>
              </th>
            </tr>
          </thead>
          <tbody data-type-role="body-compact">
            {repos.map((repo) => (
              <tr key={repo.name}>
                <th scope="row">
                  <span className="sx-row-title">
                    {safeHref(repo.url) ? (
                      <Port href={hrefFor(repo.url, input)}>{repo.name}</Port>
                    ) : (
                      repo.name
                    )}
                  </span>
                  {present(repo.description) ? (
                    <span className="sx-row-body">{repo.description}</span>
                  ) : null}
                </th>
                <td>{repo.language ?? ''}</td>
                <td className="sx-num" data-type-role="numeric">
                  {typeof repo.stars === 'number' ? figure(repo.stars, input) : ''}
                </td>
                <td className="sx-nowrap">
                  {pushed.get(repo.name) ? (
                    <When raw={pushed.get(repo.name)!.slice(0, 7)} input={input} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {trace && trace.busiest && fig ? (
        <figure className="sx-trace" aria-labelledby={`${input.ids.prefix}sx-fig-${fig}--c`}>
          <svg
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path className="sx-trace__area" d={trace.area} />
            <path className="sx-trace__pen" d={trace.line} vectorEffect="non-scaling-stroke" />
          </svg>
          <Caption id={`${input.ids.prefix}sx-fig-${fig}--c`} n={fig} lang={lang} fig={t.fig}>
            {t.traceCaption(
              days[0]!.date.slice(0, 7),
              days.at(-1)!.date.slice(0, 7),
              trace.busiest.start,
              figure(trace.busiest.sum, input),
            )}
          </Caption>
        </figure>
      ) : null}
    </div>
  );
}
