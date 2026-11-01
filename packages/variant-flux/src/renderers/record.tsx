import type { ChronologyEntry, Evidence, Section } from '@portfolio/schema';
import {
  chronologyOf,
  hrefFor,
  recordAnchor,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  addressOf,
  currentFirst,
  evidenceRuns,
  formatNumber,
  githubView,
  metricValue,
  plainInline,
  present,
  rangeOf,
  squash,
  upToComma,
} from '../model';
import { Img, More, Out, Phrase, readyImage, uiLang, When, Words } from '../parts';

// The record (brief §5.10): evidence by type and the progress line.
// Metrics are At a glance, a line of figures at title size with a gloss of
// what each says more; testimonials are the voices, the first set large and
// the rest beside it; publications, talks, awards, patents and press are
// titled rows; external work is links. The chronology is the progress line:
// one tube down the start edge, filled with the sheet's ink up to the
// newest entry, a liquid dot riding it as the reader scrolls (where the
// browser has scroll timelines), and each entry its period, title and
// place beside it. Never a ring, orbit or dot-and-leader chain (FX-M2).

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;
type Chronology = Extract<Section, { kind: 'chronology' }>;
type Github = Extract<Section, { kind: 'github' }>;

/** The date a record is known by: when it was published, presented, received, granted or filed. */
const dateOf = (entry: Evidence) =>
  entry.publishedAt ??
  entry.presentedAt ??
  entry.receivedAt ??
  entry.grantedAt ??
  entry.filedAt ??
  entry.asOf;

/** Where and who, one line: the venue or publication, the location, the organization, the authors. */
function whereOf(entry: Evidence): string[] {
  const parts = [
    entry.venue,
    entry.publication,
    entry.location,
    entry.organization,
    entry.assignee,
    entry.number,
    entry.author,
    entry.locationLabel,
    entry.urlLabel,
  ].filter(present);
  for (const names of [entry.authors, entry.inventors])
    if (names?.length) parts.push(names.filter(present).join(', '));
  // An external work's categories, as one phrase: "Photography, travel and documentary".
  const categories = (entry.categories ?? []).filter(present);
  if (categories.length > 0) parts.push(phraseOf(categories));
  return [...new Set(parts)];
}

/** Words as one phrase, the first capitalised as written and the rest lowered: "A, b and c". */
function phraseOf(words: readonly string[]): string {
  const [first, ...rest] = words.map((word, index) =>
    index === 0 ? squash(word) : squash(word).toLocaleLowerCase(),
  );
  if (rest.length === 0) return first!;
  return `${[first, ...rest.slice(0, -1)].join(', ')} and ${rest.at(-1)}`;
}

/** An external work's figures, as P-0 sets them: "Published frames: 120+." */
const highlightsOf = (entry: Evidence) =>
  (entry.highlights ?? [])
    .filter((item) => present(item.label) || present(item.sub))
    .map((item) => (present(item.sub) ? `${squash(item.sub)}: ${squash(item.label)}` : item.label));

/** The record's other links: every one but the link its title takes, each by its label. */
function moreLinks(entry: Evidence, titleHref: string | undefined) {
  const urls = [entry.pdfUrl, entry.slidesUrl, entry.videoUrl].filter(present);
  const own = (entry.links ?? []).filter((link) => present(link.url));
  return [
    ...own.map((link) => ({
      url: link.url,
      label: present(link.label) ? squash(link.label) : undefined,
    })),
    ...urls.map((url) => ({ url, label: undefined })),
  ].filter(
    (link, index, all) =>
      link.url !== titleHref && all.findIndex((other) => other.url === link.url) === index,
  );
}

/** The link a record's title takes: its URL, else its PDF or slides, else its first link. */
const linkOf = (entry: Evidence) =>
  entry.url ??
  entry.pdfUrl ??
  entry.slidesUrl ??
  entry.videoUrl ??
  entry.links?.find((link) => present(link.url))?.url;

function Glance({
  entries,
  section,
  input,
}: {
  entries: readonly Evidence[];
  section: EvidenceSection;
  input: VariantRenderInput;
}) {
  const locale = input.portfolio.locale;
  const items = entries.map((entry) => {
    const statement = present(entry.statement) ? plainInline(entry.statement) : undefined;
    const label = statement
      ? upToComma(statement)
      : present(entry.title)
        ? squash(entry.title)
        : undefined;
    const rest =
      statement && label && statement.length > label.length + 1
        ? statement.slice(label.length).replace(/^[,،、，]\s*/u, '')
        : undefined;
    return { entry, label, rest, value: metricValue(entry, label, locale) };
  });
  const glossed = items.filter(
    (item) =>
      present(item.rest) || present(item.entry.description) || present(item.entry.source?.name),
  );
  return (
    <div className="fx-glance">
      <ul className="fx-glance__line" role="list" data-type-role="title">
        {items.map(({ entry, label, value }) => (
          <li key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
            {value ? <strong className="fx-num">{value}</strong> : null} {label}
          </li>
        ))}
      </ul>
      {/* What each figure says more, folded on a phone under the line of figures. */}
      {glossed.length > 0 ? (
        <More count={glossed.length} input={input}>
          <dl className="fx-glance__gloss" data-type-role="body-compact">
            {glossed.map(({ entry, label, rest }) => (
              <div key={entry.id} lang={entry.lang}>
                <dt>{label}</dt>
                <dd>
                  {present(rest) ? (
                    <span>{rest.charAt(0).toLocaleUpperCase(locale) + rest.slice(1)}</span>
                  ) : null}
                  {present(rest) && present(entry.description) ? ' ' : null}
                  {present(entry.description) ? (
                    <Phrase source={entry.description} input={input} />
                  ) : null}
                  {present(entry.source?.name) ? (
                    <span className="fx-glance__source">
                      {[entry.source.name, entry.source.organization].filter(present).join(', ')}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </More>
      ) : null}
    </div>
  );
}

function Voices({
  entries,
  section,
  input,
  from = 0,
}: {
  entries: readonly Evidence[];
  section: EvidenceSection;
  input: VariantRenderInput;
  /** Where this list starts in its run: the run's first voice is the lead. */
  from?: number;
}) {
  return (
    <ul className="fx-voices" role="list" data-count={String(entries.length + from)}>
      {entries.map((entry, at) => {
        const index = at + from;
        const words = entry.statement ?? entry.excerpt ?? entry.description;
        const who = entry.source;
        const avatar = index === 0 ? readyImage(who?.avatar, input) : undefined;
        return (
          <li
            key={entry.id}
            className={index === 0 ? 'fx-voice fx-voice--lead' : 'fx-voice'}
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
          >
            <figure>
              {present(words) ? (
                <blockquote
                  className="fx-voice__words"
                  data-type-role={index === 0 ? 'headline' : 'quote'}
                >
                  <Phrase source={words} input={input} />
                </blockquote>
              ) : null}
              {present(entry.description) && words !== entry.description ? (
                <p className="fx-voice__about" data-type-role="body-compact">
                  <Phrase source={entry.description} input={input} />
                </p>
              ) : null}
              {who ? (
                <figcaption className="fx-voice__who" data-type-role="caption">
                  {avatar ? (
                    <span className="fx-voice__face">
                      <Img placed={avatar} input={input} sizes="3rem" decorative />
                    </span>
                  ) : null}
                  <span>
                    <span className="fx-voice__name">{who.name}</span>
                    {present(who.role) || present(who.organization) ? (
                      <span className="fx-voice__role">
                        {[who.role, who.organization].filter(present).join(', ')}
                      </span>
                    ) : null}
                  </span>
                </figcaption>
              ) : null}
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Titled rows: a record's title (its link), what it says, and an aside of where, when, its
 * awards and its other links. `anchorOf` gives a row its id (home's sections); `home` adds, on a
 * work's own page, a link to where the record sits on home.
 */
export function Rows({
  entries,
  input,
  anchorOf,
  home,
  links = false,
}: {
  entries: readonly Evidence[];
  input: VariantRenderInput;
  anchorOf?: (entry: Evidence) => string | undefined;
  home?: (entry: Evidence) => { href: string; label: string } | undefined;
  links?: boolean;
}) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <ul className={links ? 'fx-rows fx-rows--links' : 'fx-rows'} role="list">
      {entries.map((entry) => {
        // A record whose link the owner named (an external work's button) keeps that name: the
        // link goes in the links line by it, and the title doesn't take it a second time.
        const named =
          present(entry.buttonText) && present(entry.url)
            ? { url: entry.url, label: squash(entry.buttonText) }
            : undefined;
        const link = named ? undefined : linkOf(entry);
        const href = link ? hrefFor(link, input) : undefined;
        const title = present(entry.title)
          ? entry.title
          : present(entry.citation)
            ? entry.citation
            : undefined;
        const words = entry.statement ?? entry.abstract ?? entry.excerpt ?? entry.description;
        // A talk's or a testimonial's description says more than its statement: it follows it.
        const more =
          present(entry.description) && words !== entry.description ? entry.description : undefined;
        const where = whereOf(entry);
        const date = dateOf(entry);
        const figures = highlightsOf(entry);
        const awards = (entry.awards ?? []).filter(present);
        const others = [...(named ? [named] : []), ...moreLinks(entry, link)].filter(
          (each, index, all) => all.findIndex((other) => other.url === each.url) === index,
        );
        const there = home?.(entry);
        // A publication's citation under its title, as the owner wrote it, and its DOI.
        const citation =
          title && present(entry.citation) && entry.citation !== title ? entry.citation : undefined;
        const doi = present(entry.doi) ? entry.doi.trim() : undefined;
        const aside =
          where.length > 0 ||
          date ||
          doi ||
          citation ||
          awards.length > 0 ||
          others.length > 0 ||
          there !== undefined;
        return (
          <li key={entry.id} className="fx-row" id={anchorOf?.(entry)} lang={entry.lang}>
            <p className="fx-item__title" data-type-role="title">
              {title ? (
                href ? (
                  <a href={href}>
                    {title}
                    <Out href={href} />
                  </a>
                ) : (
                  title
                )
              ) : present(words) ? (
                <Phrase source={words} input={input} />
              ) : null}
            </p>
            {(title && present(words)) || more || figures.length > 0 ? (
              <p className="fx-row__sum" data-type-role="body-compact">
                {title && present(words) ? <Phrase source={words} input={input} /> : null}
                {title && present(words) && more ? ' ' : null}
                {more ? <Phrase source={more} input={input} /> : null}
                {figures.map((figure) => (
                  <span key={figure} className="fx-row__figure">
                    {` ${figure}.`}
                  </span>
                ))}
              </p>
            ) : null}
            {aside ? (
              <div className="fx-row__aside">
                {citation ? (
                  <p className="fx-row__cite" data-type-role="body-compact">
                    {citation}
                  </p>
                ) : null}
                {where.length > 0 || date || doi ? (
                  <p className="fx-row__foot" data-type-role="caption">
                    {where.map((part) => (
                      <span key={part}>{part}</span>
                    ))}
                    {date ? (
                      <span>
                        <When raw={date} lang={lang} />
                      </span>
                    ) : null}
                    {doi ? (
                      <span className="fx-num">
                        <Words lang={lang}>DOI </Words>
                        {doi}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {awards.map((award) => (
                  <p key={award} className="fx-row__mark" data-type-role="label">
                    {award}
                  </p>
                ))}
                {others.length > 0 ? (
                  <p className="fx-row__links" data-type-role="label">
                    {others.map((other) => {
                      const to = hrefFor(other.url, input);
                      return (
                        <a key={other.url} className="fx-link" href={to}>
                          {other.label ?? addressOf(other.url)}
                          <Out href={to} />
                        </a>
                      );
                    })}
                  </p>
                ) : null}
                {there ? (
                  <p className="fx-row__links" data-type-role="label">
                    <a className="fx-link" href={there.href}>
                      <Words lang={lang}>In </Words>
                      {there.label}
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceRenderer({ section, input }: SectionRendererProps<EvidenceSection>) {
  const anchor = (entry: Evidence) => recordAnchor(section, entry, input);
  return (
    <>
      {evidenceRuns(section, input).map((run, index) => {
        const key = `${run.form}-${index}`;
        switch (run.form) {
          case 'glance':
            return <Glance key={key} entries={run.items} section={section} input={input} />;
          case 'voices':
            // The lead voice, then the rest folded on a phone.
            return run.items.length > 1 ? (
              <div key={key} className="fx-run-more">
                <Voices entries={run.items.slice(0, 1)} section={section} input={input} />
                <More count={run.items.length - 1} input={input}>
                  <Voices entries={run.items.slice(1)} section={section} input={input} from={1} />
                </More>
              </div>
            ) : (
              <Voices key={key} entries={run.items} section={section} input={input} />
            );
          case 'links':
            return <Rows key={key} entries={run.items} input={input} anchorOf={anchor} links />;
          default:
            return <Rows key={key} entries={run.items} input={input} anchorOf={anchor} />;
        }
      })}
    </>
  );
}

function Entry({
  entry,
  section,
  input,
  fold = false,
}: {
  entry: ChronologyEntry;
  section: Chronology;
  input: VariantRenderInput;
  /** Its account (what it was, what came of it) folded on a phone, under its title and place. */
  fold?: boolean;
}) {
  const range = rangeOf(entry.period);
  const where = [entry.organization, entry.location].filter(present);
  const points = [...(entry.highlights ?? []), ...(entry.achievements ?? [])].filter(present);
  const skills = (entry.skills ?? []).filter(present);
  return (
    <li
      className="fx-step"
      id={recordAnchor(section, entry, input)}
      lang={entry.lang}
      data-kind={entry.kind}
      data-open={range?.open ? '' : undefined}
    >
      {range ? (
        <p className="fx-step__when fx-num" data-type-role="label">
          {range.text}
        </p>
      ) : null}
      <div className="fx-step__words">
        <h4 className="fx-item__title" data-type-role="title">
          {present(entry.field) ? `${entry.title}, ${entry.field}` : entry.title}
        </h4>
        {where.length > 0 ? (
          <p className="fx-step__where" data-type-role="body-compact">
            {entry.organizationUrl && entry.organization ? (
              <a href={hrefFor(entry.organizationUrl, input)}>{entry.organization}</a>
            ) : (
              entry.organization
            )}
            {entry.organization && entry.location ? ', ' : null}
            {entry.location}
          </p>
        ) : null}
        {(() => {
          const account = (
            <>
              {present(entry.description) ? (
                <div className="fx-step__about">
                  <Phrase source={entry.description} input={input} />
                </div>
              ) : null}
              {points.length > 0 ? (
                <ul className="fx-step__points" role="list" data-type-role="body-compact">
                  {points.slice(0, 3).map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              ) : null}
              {skills.length > 0 ? (
                <p className="fx-step__skills" data-type-role="caption">
                  {skills.join(', ')}
                </p>
              ) : null}
            </>
          );
          const parts =
            (present(entry.description) ? 1 : 0) +
            Math.min(points.length, 3) +
            (skills.length > 0 ? 1 : 0);
          return fold && parts > 0 ? (
            <More count={parts} input={input}>
              {account}
            </More>
          ) : (
            account
          );
        })()}
      </div>
    </li>
  );
}

function Progress({
  entries,
  section,
  input,
  fold = false,
}: {
  entries: readonly ChronologyEntry[];
  section: Chronology;
  input: VariantRenderInput;
  fold?: boolean;
}) {
  return (
    <div className="fx-progress">
      <span className="fx-progress__tube" aria-hidden="true">
        <span className="fx-progress__ink" />
        <span className="fx-progress__dot" />
      </span>
      <ol className="fx-progress__steps" role="list">
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} section={section} input={input} fold={fold} />
        ))}
      </ol>
    </div>
  );
}

/**
 * The progress line. Experience keeps its current roles open (else its latest) and folds the
 * earlier ones behind a native disclosure of their own (design gate items 7 and 8): it opens from
 * a fragment, with no script, and on paper.
 */
export function ChronologyRenderer({ section, input }: SectionRendererProps<Chronology>) {
  const lang = uiLang(input.portfolio.locale);
  const entries = chronologyOf(section, input);
  if (entries.length === 0) return null;
  const { shown, earlier } = currentFirst(entries);
  return (
    <>
      {/* The current role's account folds on a phone too: its title, place and dates stay. */}
      <Progress entries={shown} section={section} input={input} fold={earlier.length > 0} />
      {earlier.length > 0 ? (
        <details className="fx-fold fx-fold--earlier" data-fx-fold="">
          <summary className="fx-fold__summary">
            <span className="fx-fold__word" data-type-role="title">
              <Words lang={lang}>Earlier</Words>
            </span>
            <span className="fx-fold__count fx-num" data-type-role="label">
              {formatNumber(earlier.length, input.portfolio.locale)}
            </span>
          </summary>
          <div className="fx-fold__body">
            <Progress entries={earlier} section={section} input={input} />
          </div>
        </details>
      ) : null}
    </>
  );
}

export function GithubRenderer({ section, input }: SectionRendererProps<Github>) {
  const lang = uiLang(input.portfolio.locale);
  const view = githubView(section, input);
  if (!view) {
    const profile = `https://github.com/${encodeURIComponent(section.username)}`;
    return (
      <p className="fx-row__sum" data-type-role="body-compact">
        <a href={profile}>
          <Words lang={lang}>{`@${section.username} on GitHub`}</Words>
          <Out href={profile} />
        </a>
      </p>
    );
  }
  return (
    <div className="fx-github">
      <p className="fx-github__totals" data-type-role="body">
        <a href={view.profileUrl}>
          <span>{`@${view.username}`}</span>
          <Out href={view.profileUrl} />
        </a>{' '}
        <Words lang={lang}>{view.totals}</Words>
      </p>
      {view.repos.length > 0 ? (
        <ul className="fx-rows" role="list">
          {view.repos.map((repo) => (
            <li key={repo.name} className="fx-row">
              <p className="fx-item__title" data-type-role="title">
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
                <p className="fx-row__sum" data-type-role="body-compact">
                  {repo.description}
                </p>
              ) : null}
              <p className="fx-row__foot" data-type-role="caption">
                {repo.language ? <span>{repo.language}</span> : null}
                <span className="fx-num">
                  <Words
                    lang={lang}
                  >{`${formatNumber(repo.stars, input.portfolio.locale)} ${repo.stars === 1 ? 'star' : 'stars'}`}</Words>
                </span>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
