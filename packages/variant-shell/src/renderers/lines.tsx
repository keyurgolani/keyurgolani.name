import {
  anchorSection,
  evidenceByIds,
  footerOutline,
  formatFigure,
  githubSnapshot,
  hrefFor,
  MediaFigure,
  placedMedia,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRenderer,
} from '@portfolio/kit/sections';
import { promptOf } from '../model';
import { external, Link, outlineFor, Sr, uiLangOf, When, Words } from '../parts';
import { CitedRecord, RecordTerm } from './evidence';

// The short forms (brief §5.6): `cat <id>.md` (lede), `finger` (now),
// `jobs` (focus), `cat <id>.txt` (fun facts), `cat /etc/motd` (quote),
// `./<id>` with whiptail buttons (cta), `mail <email>` with the address at
// double height (contact), and `gh repo list` from the publish snapshot.

export const Lede: SectionRenderer<SectionOf<'lede'>> = ({ section, input }) => (
  <RichText source={section.body} input={input} className="sh-prose" />
);

export const Finger: SectionRenderer<SectionOf<'now'>> = ({ section, input }) => {
  const uiLang = uiLangOf(input);
  const { user } = promptOf(input);
  return (
    <div className="sh-finger">
      <p className="sh-finger__row">
        {user ? (
          <span>
            <span className="sh-faint">
              <Words lang={uiLang}>Login:</Words>
            </span>{' '}
            {user}
          </span>
        ) : null}
        <span>
          <span className="sh-faint">
            <Words lang={uiLang}>Name:</Words>
          </span>{' '}
          {input.portfolio.identity.name}
        </span>
      </p>
      <p>
        <span className="sh-faint">
          <Words lang={uiLang}>Plan</Words>
          {section.asOf ? (
            <>
              {' '}
              (<Words lang={uiLang}>as of</Words> <When raw={section.asOf} />)
            </>
          ) : null}
          :
        </span>
      </p>
      <RichText source={section.body} input={input} className="sh-prose" />
    </div>
  );
};

export const Jobs: SectionRenderer<SectionOf<'focus'>> = ({ section, input }) => {
  const uiLang = uiLangOf(input);
  const last = section.items.length - 1;
  return (
    <ol className="sh-jobs">
      {section.items.map((item, i) => (
        <li key={i}>
          <span className="sh-jobs__n" aria-hidden="true">
            [{i + 1}]{i === last ? '+' : i === last - 1 ? '-' : ' '}
          </span>
          <span className="sh-jobs__st" aria-hidden="true">
            <Words lang={uiLang}>Running</Words>
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
};

export const Facts: SectionRenderer<SectionOf<'fun-facts'>> = ({ section }) => (
  <ul className="sh-lines">
    {section.items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

export const Motd: SectionRenderer<SectionOf<'quote'>> = ({ section, input }) => (
  <figure className="sh-motd">
    <blockquote>
      <p>{section.text}</p>
    </blockquote>
    {section.attribution || section.source ? (
      <figcaption>
        <span aria-hidden="true">— </span>
        {section.attribution}
        {section.attribution && section.source ? ', ' : ''}
        {section.source ? (
          section.sourceUrl ? (
            <Link url={section.sourceUrl} input={input}>
              <cite>{section.source}</cite>
            </Link>
          ) : (
            <cite>{section.source}</cite>
          )
        ) : null}
      </figcaption>
    ) : null}
  </figure>
);

/** whiptail's < Label >: an action as a terminal dialog button. */
function Button({
  url,
  label,
  primary,
  input,
}: {
  url: string;
  label: string;
  primary: boolean;
  input: Parameters<typeof hrefFor>[1];
}) {
  return (
    <a className={primary ? 'sh-btn sh-btn--primary' : 'sh-btn'} href={hrefFor(url, input)}>
      <span className="sh-btn__ang" aria-hidden="true">
        &lt;
      </span>
      <span className="sh-btn__label">{label}</span>
      {external(url) ? <span aria-hidden="true">{' ↗'}</span> : null}
      <span className="sh-btn__ang" aria-hidden="true">
        &gt;
      </span>
    </a>
  );
}

export const Whiptail: SectionRenderer<SectionOf<'cta'>> = ({ section, input }) => (
  <>
    {section.description ? <p className="sh-prose">{section.description}</p> : null}
    {section.primaryAction || section.secondaryAction ? (
      <ul className="sh-btns">
        {section.primaryAction ? (
          <li>
            <Button
              url={section.primaryAction.url}
              label={section.primaryAction.label}
              primary
              input={input}
            />
          </li>
        ) : null}
        {section.secondaryAction ? (
          <li>
            <Button
              url={section.secondaryAction.url}
              label={section.secondaryAction.label}
              primary={false}
              input={input}
            />
          </li>
        ) : null}
      </ul>
    ) : null}
  </>
);

export const MailTo: SectionRenderer<SectionOf<'contact'>> = ({ input }) => {
  const uiLang = uiLangOf(input);
  const footer = footerOutline(input);
  const message = input.portfolio.contact?.message;
  const links = footer.contact?.links.length ? footer.contact.links : footer.links;
  return (
    <>
      {message ? <p className="sh-prose">{message}</p> : null}
      <dl className="sh-mailto">
        {footer.email ? (
          <div>
            <dt>
              <Words lang={uiLang}>To:</Words>
            </dt>
            <dd>
              <a className="sh-mailto__big" href={footer.email.href}>
                {footer.email.text}
              </a>
            </dd>
          </div>
        ) : null}
        {links.length > 0 ? (
          <div>
            <dt>
              <Words lang={uiLang}>Elsewhere:</Words>
            </dt>
            <dd>
              <ul className="sh-kv__list">
                {links.map((link) => (
                  <li key={link.href}>
                    <a className={external(link.href) ? 'sh-ext' : undefined} href={link.href}>
                      {link.text}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  );
};

export const Gh: SectionRenderer<SectionOf<'github'>> = ({ section, input, level }) => {
  const uiLang = uiLangOf(input);
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const profile = `https://github.com/${section.username}`;
  if (!snapshot || snapshot.state !== 'ready') {
    return (
      <p className="sh-dim">
        <Words lang={uiLang}>No snapshot yet.</Words>{' '}
        <Link url={profile} input={input}>
          github.com/{section.username}
        </Link>
      </p>
    );
  }
  const data = snapshot.value;
  const excluded = new Set(section.excludeRepos ?? []);
  const featured = section.featuredRepos ?? [];
  const repos = [...data.pinnedRepos]
    .filter((repo) => !excluded.has(repo.name))
    .sort((a, b) => Number(featured.includes(b.name)) - Number(featured.includes(a.name)));
  const figures = [
    data.contributionsLastYear !== null
      ? { value: data.contributionsLastYear, words: 'contributions in the last year' }
      : undefined,
    { value: data.totalRepos, words: 'repositories' },
    data.totalStarsReceived !== null
      ? { value: data.totalStarsReceived, words: 'stars received' }
      : undefined,
  ].filter((figure): figure is { value: number; words: string } => figure !== undefined);
  return (
    <>
      <p className="sh-gh-sum">
        {figures.map((figure, i) => (
          <span key={i}>
            <b className="sh-fig">{formatFigure(figure.value, ctx)}</b>{' '}
            <Words lang={uiLang}>{figure.words}</Words>
          </span>
        ))}
      </p>
      {repos.length > 0 ? (
        <table className="sh-tab">
          <thead>
            <tr lang={uiLang}>
              <th>Repository</th>
              <th>Language</th>
              <th>Stars</th>
              <th>Forks</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <tr key={repo.name}>
                <td className="sh-tab__wide">
                  <Link url={repo.url} input={input} className="sh-tab__ttl sh-dir">
                    {repo.name}
                  </Link>
                  {repo.description ? (
                    <span className="sh-tab__desc">{repo.description}</span>
                  ) : null}
                </td>
                <td className="sh-tab__d">{repo.language ?? ''}</td>
                <td className="sh-tab__f">
                  <span aria-hidden="true">★ </span>
                  {formatFigure(repo.stars, ctx)}
                  <Sr lang={uiLang}> stars</Sr>
                </td>
                <td className="sh-tab__d">
                  <span aria-hidden="true">⑂ </span>
                  {formatFigure(repo.forks, ctx)}
                  <Sr lang={uiLang}> forks</Sr>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="sh-faint">
        <Link url={data.profileUrl} input={input}>
          github.com/{data.username}
        </Link>
      </p>
    </>
  );
};

/**
 * `cat <id>` (custom): the owner's own content, printed as files are: its
 * body first, then each item under head(1)'s banner, `==> title <==`, the
 * banner hidden and the title its heading, with every picture it has at the
 * listing's thumbnail size, each with its caption, date, place and tags (a
 * custom section has no other page, so nothing of it is left out), its
 * summary, the records it cites (the kit's `evidenceByIds`: each linked to its place on home,
 * or printed whole when home doesn't list it), and its links.
 */
export const Cat: SectionRenderer<SectionOf<'custom'>> = ({ section, input, level }) => {
  const ctx = renderContext(input, section, level);
  const Heading = `h${ctx.itemLevel}` as 'h3';
  return (
    <>
      {section.body ? <RichText source={section.body} input={input} className="sh-prose" /> : null}
      {(section.items ?? []).length > 0 ? (
        <ul className="sh-cat">
          {(section.items ?? []).map((item, i) => {
            const pictures = (item.media ?? []).flatMap((placement) => {
              const placed = placedMedia(placement, ctx);
              return placed ? [placed] : [];
            });
            // A record home lists links to its place there; one it doesn't is printed whole,
            // as the case page's SEE ALSO prints it, since this is the only place it shows.
            const cited = evidenceByIds(item.evidence, input).map((record) => {
              const home = anchorSection(record, input);
              const href = home
                ? outlineFor(input).sections.find((each) => each.id === home.id)?.href
                : undefined;
              return { record, href };
            });
            const listed = cited.filter(
              (each): each is { record: (typeof cited)[number]['record']; href: string } =>
                each.href !== undefined,
            );
            const own = cited.filter(({ href }) => href === undefined).map(({ record }) => record);
            return (
              <li key={i} className="sh-cat__item">
                <Heading className="sh-cat__h">
                  <span aria-hidden="true">==&gt; </span>
                  {item.title}
                  <span aria-hidden="true"> &lt;==</span>
                </Heading>
                {pictures.length > 0 ? (
                  <ul className="sh-cat__media">
                    {pictures.map((placed, n) => (
                      <li key={`${placed.asset}-${n}`} className="sh-icat" data-preview="thumb">
                        <MediaFigure placed={placed} ctx={ctx} sizes="20ch" />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.summary ? (
                  <RichText source={item.summary} input={input} className="sh-prose" />
                ) : null}
                {listed.length > 0 ? (
                  <ul className="sh-kv__list">
                    {listed.map(({ record, href }, n) => (
                      <li key={`${record.id}-${n}`} lang={record.lang}>
                        <RecordTerm record={record} ctx={ctx} href={href} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {own.length > 0 ? (
                  <dl className="sh-man__see sh-cat__cited">
                    {own.map((record, n) => (
                      <CitedRecord key={`${record.id}-${n}`} record={record} ctx={ctx} />
                    ))}
                  </dl>
                ) : null}
                {(item.links ?? []).length > 0 ? (
                  <ul className="sh-kv__list">
                    {(item.links ?? []).map((link) => (
                      <li key={link.url}>
                        <Link url={link.url} input={input}>
                          {link.label ?? link.platform ?? link.url}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
};
