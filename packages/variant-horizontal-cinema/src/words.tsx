import { Action } from '@portfolio/appearance/primitives';
import {
  DateText,
  evidenceByIds,
  formatFigure,
  githubSnapshot,
  Heading,
  hrefFor,
  LinkText,
  MaybeLink,
  MediaFigure,
  placedMedia,
  present,
  renderContext,
  RichText,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { Link } from '@portfolio/schema';
import { platformLabel } from './credits';
import { Words } from './parts';

// The sections of words alone (redesign): the lede, now, a quote, the
// focus, the fun facts, contact, the call to action, GitHub, and custom
// sections. Each gives its scene one dominant line, a quote at headline
// size, a fact list at title size, the call to action's question at
// display size, and keeps the rest at a reading measure. Figures are
// words, never a row of large numbers: GitHub's totals are one sentence.

/** A section's heading and subtitle, when it has them: every Cinema section heads itself this way. */
export function SectionHead({
  section,
  level,
  role = 'headline',
  subtitleRole = 'body',
}: {
  section: { readonly title?: string; readonly subtitle?: string };
  level: RenderContext['level'];
  role?: 'headline' | 'label' | 'display';
  subtitleRole?: 'body' | 'title';
}) {
  if (!present(section.title) && !present(section.subtitle)) return null;
  return (
    <header className="hc-reel__head">
      {present(section.title) ? (
        <Heading level={level} className="hc-reel__title">
          <span data-type-role={role}>{section.title}</span>
        </Heading>
      ) : null}
      {present(section.subtitle) ? (
        <p className="hc-reel__subtitle" data-type-role={subtitleRole}>
          {section.subtitle}
        </p>
      ) : null}
    </header>
  );
}

export function LedeSection({ section, input, level }: SectionRendererProps<SectionOf<'lede'>>) {
  return (
    <>
      <SectionHead section={section} level={level} role="label" />
      <RichText source={section.body} className="hc-prose" input={input} />
    </>
  );
}

export function NowSection({ section, input, level }: SectionRendererProps<SectionOf<'now'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHead section={section} level={level} />
      {section.asOf !== undefined ? (
        <p className="hc-words__as-of" data-type-role="label">
          <Words lang={ctx.uiLang}>As of</Words> <DateText raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
      <div className="hc-words__lead" data-type-role="title">
        <RichText source={section.body} input={input} />
      </div>
    </>
  );
}

export function QuoteSection({ section, input, level }: SectionRendererProps<SectionOf<'quote'>>) {
  const ctx = renderContext(input, section, level);
  const url = present(section.sourceUrl) ? section.sourceUrl : undefined;
  const who = present(section.attribution) ? section.attribution : undefined;
  const source = present(section.source) ? section.source : undefined;
  return (
    <>
      <SectionHead section={section} level={level} role="label" />
      <figure className="hc-words__quote">
        <blockquote cite={url ? hrefFor(url, input) : undefined} data-type-role="headline">
          <p>{section.text}</p>
        </blockquote>
        {who || source || url ? (
          <figcaption data-type-role="label">
            {who ? (
              <MaybeLink url={source ? undefined : url} ctx={ctx}>
                {who}
              </MaybeLink>
            ) : null}
            {who && source ? ', ' : null}
            {source ? (
              <cite>
                <MaybeLink url={url} ctx={ctx}>
                  {source}
                </MaybeLink>
              </cite>
            ) : null}
            {!who && !source && url ? <a href={hrefFor(url, input)}>{url}</a> : null}
          </figcaption>
        ) : null}
      </figure>
    </>
  );
}

/** A short list as ruled rows at title size: the focus, or the fun facts. */
function Rows({ items }: { items: readonly string[] }) {
  return (
    <ul className="hc-rules hc-words__rows" role="list">
      {items.map((item, index) => (
        <li key={index} data-type-role="title">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function FocusSection({ section, level }: SectionRendererProps<SectionOf<'focus'>>) {
  return (
    <>
      <SectionHead section={section} level={level} />
      <Rows items={section.items} />
    </>
  );
}

export function FunFactsSection({ section, level }: SectionRendererProps<SectionOf<'fun-facts'>>) {
  return (
    <>
      <SectionHead section={section} level={level} />
      <Rows items={section.items} />
    </>
  );
}

/**
 * What a way to get in touch reads as: the address itself, `github.com/anamika`,
 * when its label would only repeat what it is, else its label.
 */
function addressOf(link: Link): string {
  const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  const label = link.label?.trim();
  if (label && plain(label) !== plain(platformLabel(link.platform ?? ''))) return label;
  return link.url
    .replace(/^mailto:/, '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/$/, '');
}

/** An address that may break only after a slash or a dot, never inside a word. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[/.])/);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </span>
      ))}
    </>
  );
}

/** Ways to get in touch as credits: what each is, then the link. */
function Ways({ links, ctx }: { links: readonly Link[]; ctx: RenderContext }) {
  if (links.length === 0) return null;
  return (
    <dl className="hc-words__ways">
      {links.map((link) => (
        <div key={link.url}>
          <dt data-type-role="label">{platformLabel(link.platform ?? 'website')}</dt>
          <dd data-type-role="body">
            <a href={hrefFor(link.url, ctx.input)}>
              <Breakable text={addressOf(link)} />
            </a>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The ways the Get in touch scene lists: the email first, then the contact's links, else the portfolio's. */
function waysOf(input: SectionRendererProps<SectionOf<'contact'>>['input']): readonly Link[] {
  const { identity, links: portfolioLinks, contact } = input.portfolio;
  const links = contact?.links?.length ? contact.links : portfolioLinks;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email ? `mailto:${email}` : undefined;
  return mailto && !links.some((link) => link.url.toLowerCase() === mailto.toLowerCase())
    ? [{ platform: 'email', url: mailto, label: email }, ...links]
    : links;
}

/** Where each way the Get in touch scene lists leads, so the end credits needn't list it again. */
export function contactHrefs(input: SectionRendererProps<SectionOf<'contact'>>['input']): string[] {
  return waysOf(input).map((link) => hrefFor(link.url, input));
}

export function ContactSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'contact'>>) {
  const ctx = renderContext(input, section, level);
  const { contact } = input.portfolio;
  const listed = waysOf(input);
  return (
    <>
      <SectionHead section={section} level={level} />
      {present(contact?.message) ? (
        <p className="hc-words__lead" data-type-role="title">
          {contact.message}
        </p>
      ) : null}
      <Ways links={listed} ctx={ctx} />
    </>
  );
}

export function CtaSection({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const actions = [section.primaryAction, section.secondaryAction].filter(
    (action): action is NonNullable<typeof action> => action !== undefined,
  );
  return (
    <>
      <SectionHead section={section} level={level} role="display" />
      {present(section.description) ? (
        <p className="hc-words__lead" data-type-role="title">
          {section.description}
        </p>
      ) : null}
      {actions.length > 0 ? (
        <ul className="hc-words__actions" role="list">
          {actions.map((action, index) => (
            <li key={index}>
              {/* One start action; any other is a plain link in the slate's own colours. */}
              {index === 0 ? (
                <Action href={hrefFor(action.url, input)} emphasis="primary">
                  {present(action.label) ? action.label : action.url}
                </Action>
              ) : (
                <a className="hc-words__more" href={hrefFor(action.url, input)}>
                  {present(action.label) ? action.label : action.url}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A link only to an https address: a snapshot names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export function GithubSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'github'>>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const excluded = new Set(section.excludeRepos ?? []);
  const repos =
    ready && section.showPinnedRepos !== false
      ? ready.value.pinnedRepos.filter((repo) => !excluded.has(repo.name))
      : [];
  // The totals, as one sentence, never a row of large numbers.
  const totals: string[] = [];
  if (ready) {
    totals.push(`${formatFigure(ready.value.totalRepos, ctx)} repositories`);
    if (section.showTotalStars !== false && ready.value.totalStarsReceived !== null) {
      totals.push(`${formatFigure(ready.value.totalStarsReceived, ctx)} stars received`);
    }
    if (ready.value.contributionsLastYear !== null) {
      totals.push(
        `${formatFigure(ready.value.contributionsLastYear, ctx)} contributions in the last year`,
      );
    }
  }
  const day = ready ? new Date(ready.derivedAt) : undefined;
  const asOf =
    day && !Number.isNaN(day.getTime()) ? (
      <time dateTime={day.toISOString().slice(0, 10)} lang={ctx.uiLang}>
        {new Intl.DateTimeFormat('en', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(day)}
      </time>
    ) : null;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  return (
    <>
      <SectionHead section={section} level={level} />
      {totals.length > 0 ? (
        <p className="hc-words__lead" data-type-role="body">
          <Words lang={ctx.uiLang}>{totals.join(', ')}</Words>
          {asOf ? (
            <>
              {', '}
              <Words lang={ctx.uiLang}>as of</Words> {asOf}
            </>
          ) : null}
          {'.'}
        </p>
      ) : null}
      {repos.length > 0 ? (
        <ul className="hc-records" role="list">
          {repos.map((repo) => {
            const href = safeHref(repo.url);
            return (
              <li key={repo.name}>
                <div className="hc-records__what">
                  <Heading level={ctx.itemLevel} className="hc-records__title">
                    <span data-type-role="body">
                      {href ? <a href={href}>{repo.name}</a> : repo.name}
                    </span>
                  </Heading>
                  {present(repo.description) ? (
                    <p className="hc-records__where" data-type-role="body-compact">
                      {repo.description}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="hc-words__profile" data-type-role="body">
        <a href={profile}>{section.username}</a>
      </p>
    </>
  );
}

export function CustomSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  const items = section.items ?? [];
  return (
    <>
      <SectionHead section={section} level={level} />
      {present(section.body) ? (
        <RichText source={section.body} className="hc-prose" input={input} />
      ) : null}
      {items.length > 0 ? (
        <ul className="hc-words__items" role="list">
          {items.map((item, index) => {
            const media = (item.media ?? []).flatMap((placement) => {
              const placed = placedMedia(placement, ctx);
              return placed ? [placed] : [];
            });
            const evidence = evidenceByIds(item.evidence, input);
            return (
              <li key={index}>
                {present(item.title) ? (
                  <Heading level={ctx.itemLevel} className="hc-work__title">
                    <span data-type-role="title">{item.title}</span>
                  </Heading>
                ) : null}
                {present(item.summary) ? (
                  <RichText source={item.summary} className="hc-work__body" input={input} />
                ) : null}
                {media.map((placed, mediaIndex) => (
                  <div key={`${placed.asset}-${mediaIndex}`} className="hc-work__still hc-still">
                    <MediaFigure placed={placed} ctx={ctx} />
                  </div>
                ))}
                {evidence.length > 0 ? (
                  <p className="hc-work__by" data-type-role="body-compact">
                    {evidence.map((entry, entryIndex) => (
                      <span key={entry.id}>
                        {entryIndex > 0 ? ', ' : null}
                        <MaybeLink url={present(entry.url) ? entry.url : undefined} ctx={ctx}>
                          {entry.title ?? entry.id}
                        </MaybeLink>
                      </span>
                    ))}
                  </p>
                ) : null}
                {item.links?.length ? (
                  <p className="hc-work__go" data-type-role="body-compact">
                    {item.links.map((link, linkIndex) => (
                      <LinkText key={linkIndex} link={link} ctx={ctx} />
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
