import type { Section } from '@portfolio/schema';
import { githubSnapshot, hrefFor, type SectionRendererProps } from '@portfolio/kit/sections';
import { addressOf, contactLinks, contactRow, formatNumber, present } from '../model';
import { Out, Paren, Phrase, uiLang, Words } from '../parts';
import { RuledTable } from './ruled-table';

// The page's end (brief §5.1, components 17 and 8): the contact finale,
// the email at poster scale under a signal bar with the message and a
// table of links, the call to action as one ruled row, and GitHub as its
// figures and a table of pinned repositories, stars and forks in columns
// of their own at every width (SS-M3).

type Of<K extends Section['kind']> = Extract<Section, { kind: K }>;

/** How long an address is, which picks its step so it fits the line without breaking mid-word. */
const fitOf = (text: string) => {
  const length = [...text].length;
  return length <= 16 ? 's' : length <= 24 ? 'm' : length <= 34 ? 'l' : 'xl';
};

/** An address with a break opportunity after its @. */
const atBreak = (address: string) => {
  const at = address.indexOf('@');
  if (at < 0) return address;
  return (
    <>
      {address.slice(0, at + 1)}
      <wbr />
      {address.slice(at + 1)}
    </>
  );
};

export function ContactRenderer({ input }: SectionRendererProps<Of<'contact'>>) {
  const lang = uiLang(input.portfolio.locale);
  const { identity, contact } = input.portfolio;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const links = contactLinks(input);
  return (
    <div className="ss-contact">
      {email ? (
        <p className="ss-email" data-fit={fitOf(email)} data-type-role="display">
          {/* Where an address can't hold the line, it breaks after its @, never inside a word. */}
          <a href={`mailto:${email}`}>{atBreak(email)}</a>
        </p>
      ) : null}
      {present(contact?.message) ? (
        <p className="ss-contact__msg" data-type-role="quote">
          <Phrase source={contact.message} input={input} />
        </p>
      ) : null}
      {links.length > 0 ? (
        <dl className="ss-contact__links" data-type-role="body">
          {links.map((link) => {
            const row = contactRow(link);
            return (
              <div key={link.url}>
                <dt data-type-role="body-compact">
                  {row.label ?? <Words lang={lang}>Link</Words>}
                </dt>
                <dd>
                  {/* data-address: the text is the address, so print adds none after it. */}
                  <a href={hrefFor(link.url, input)} data-address="">
                    {row.address}
                    <Out href={link.url} />
                  </a>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}

export function CtaRenderer({ section, input }: SectionRendererProps<Of<'cta'>>) {
  const actions = [section.primaryAction, section.secondaryAction].filter(
    (action): action is NonNullable<typeof action> => action !== undefined,
  );
  return (
    <div className="ss-cta-row">
      {present(section.description) ? (
        <p data-type-role="body">
          <Phrase source={section.description} input={input} />
        </p>
      ) : null}
      {actions.length > 0 ? (
        <p className="ss-cta-row__actions">
          {actions.map((action, index) => (
            <a
              key={action.url}
              className={index === 0 ? 'ss-cta' : undefined}
              href={hrefFor(action.url, input)}
              data-type-role={index === 0 ? 'title' : 'body'}
            >
              {action.label}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export function GithubRenderer({ section, input }: SectionRendererProps<Of<'github'>>) {
  const lang = uiLang(input.portfolio.locale);
  const locale = input.portfolio.locale;
  const snapshot = githubSnapshot(section, input);
  const profile = `https://github.com/${section.username}`;
  if (!snapshot || snapshot.state !== 'ready') {
    return (
      <p data-type-role="body">
        <a href={profile} data-address="">
          {addressOf(profile)}
          <Out href={profile} />
        </a>
      </p>
    );
  }
  const data = snapshot.value;
  const figures = [
    { value: data.totalRepos, label: 'repositories' },
    { value: data.totalStarsReceived, label: 'stars received' },
    { value: data.contributionsLastYear, label: 'contributions in the last year' },
  ].filter(
    (figure): figure is { value: number; label: string } => typeof figure.value === 'number',
  );
  const repos = data.pinnedRepos;
  const days = data.contributionCalendar;
  return (
    <div className="ss-gh">
      {figures.length > 0 ? (
        <ul className="ss-gh__figs">
          {figures.map((figure) => (
            <li key={figure.label}>
              <span className="ss-gh__value ss-num" data-type-role="headline">
                {formatNumber(figure.value, locale)}
              </span>{' '}
              <span data-type-role="body-compact">
                <Words lang={lang}>{figure.label}</Words>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {days.length > 0 ? (
        // The calendar repeats the contributions figure above as a picture: decoration.
        <div className="ss-cal" aria-hidden="true">
          {days.map((day) => (
            <i key={day.date} data-level={day.level} />
          ))}
        </div>
      ) : null}
      {repos.length > 0 ? (
        <RuledTable
          caption={section.title ?? 'GitHub'}
          lang={lang}
          columns={[
            { label: 'Repository', span: 6 },
            { label: 'Language', span: 2, wide: true },
            { label: 'Stars', span: 2, end: true },
            { label: 'Forks', span: 2, end: true },
          ]}
          rows={repos.map((repo) => ({
            key: repo.url,
            cells: [
              <>
                <span className="ss-strong" data-type-role="body">
                  <a href={repo.url}>
                    {repo.name}
                    <Out href={repo.url} />
                  </a>
                </span>
                {present(repo.description) ? (
                  <span className="ss-sub">{repo.description}</span>
                ) : null}
              </>,
              repo.language ?? null,
              <span key="s" className="ss-num">
                {formatNumber(repo.stars, locale)}
              </span>,
              <span key="f" className="ss-num">
                {formatNumber(repo.forks, locale)}
              </span>,
            ],
            narrow: repo.language ? <span className="ss-sub">{repo.language}</span> : undefined,
          }))}
        />
      ) : null}
      <p data-type-role="body-compact">
        <a href={data.profileUrl} data-address="">
          {addressOf(data.profileUrl)}
          <Out href={data.profileUrl} />
        </a>{' '}
        <Paren>
          <Words lang={lang}>as of</Words> {snapshot.derivedAt.slice(0, 10)}
        </Paren>
      </p>
    </div>
  );
}
