import type { Link } from '@portfolio/schema';
import {
  evidenceByIds,
  formatFigure,
  githubSnapshot,
  hrefFor,
  MaybeLink,
  MediaFigure,
  placedMedia,
  present,
  renderContext,
  RichText,
  Ui,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { atelierModel } from '../model';
import { Entry } from './evidence';
import { SectionTitle } from './title';

// The contact gallery (redesign, stream C), and the quote, which is the
// exit wall's inscription before it or a clipping inside it: the address
// to write to at title size, the call to work together as a wall label
// with plain links, the GitHub snapshot as leaders with the date it froze,
// and the owner's custom sections.

const linkText = (link: Link) => [link.label, link.platform].find(present) ?? link.url;

/**
 * Ways to get in touch: the contact record's message, the identity's email
 * as the address, then the contact's links, else the portfolio's, less any
 * that point at the same address, or where the exit wall's call to work
 * together already goes, so a thing such as the CV has one name on the page.
 */
export function ContactSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'contact'>>) {
  const ctx = renderContext(input, section, level);
  const { identity, links: portfolioLinks, contact } = input.portfolio;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email !== undefined ? `mailto:${email}` : undefined;
  const label = atelierModel(input).exitLabel;
  const called = new Set(
    label?.kind === 'cta'
      ? [label.primaryAction?.url, label.secondaryAction?.url].filter(present)
      : [],
  );
  const links = (contact?.links?.length ? contact.links : portfolioLinks).filter(
    (link) =>
      (mailto === undefined || link.url.toLowerCase() !== mailto.toLowerCase()) &&
      !called.has(link.url),
  );
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      {present(contact?.message) ? <p className="oa-quiet">{contact.message}</p> : null}
      {mailto !== undefined ? (
        <p className="oa-address" data-type-role="headline">
          <a href={mailto}>{email}</a>
        </p>
      ) : null}
      {links.length > 0 ? (
        <ul className="oa-links" role="list">
          {links.map((link, index) => (
            <li key={index}>
              <a href={hrefFor(link.url, input)} data-platform={link.platform}>
                {linkText(link)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A call to action, set as a wall label: its words, then its actions as plain links, the first one first. */
export function CtaSection({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const ctx = renderContext(input, section, level);
  const { primaryAction, secondaryAction } = section;
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      {present(section.description) ? <p className="oa-quiet">{section.description}</p> : null}
      {primaryAction || secondaryAction ? (
        <p className="oa-actions">
          {primaryAction ? (
            <a className="oa-actions__first" href={hrefFor(primaryAction.url, input)}>
              {linkText(primaryAction)}
            </a>
          ) : null}
          {secondaryAction ? (
            <a href={hrefFor(secondaryAction.url, input)}>{linkText(secondaryAction)}</a>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** A quote: an inscription on the exit wall, or a clipping in a gallery, with its source. */
export function QuoteSection({ section, input, level }: SectionRendererProps<SectionOf<'quote'>>) {
  const ctx = renderContext(input, section, level);
  const url = section.sourceUrl;
  const attribution = present(section.attribution) ? section.attribution : undefined;
  const source = present(section.source) ? section.source : undefined;
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      <figure className="oa-inscription">
        <blockquote cite={url !== undefined ? hrefFor(url, input) : undefined}>
          <p data-type-role="headline">{section.text}</p>
        </blockquote>
        {attribution !== undefined || source !== undefined || url !== undefined ? (
          <figcaption className="oa-credit" data-type-role="label">
            {attribution !== undefined ? (
              <MaybeLink url={source === undefined ? url : undefined} ctx={ctx}>
                {attribution}
              </MaybeLink>
            ) : null}
            {attribution !== undefined && source !== undefined ? ', ' : null}
            {source !== undefined ? (
              <cite>
                <MaybeLink url={url} ctx={ctx}>
                  {source}
                </MaybeLink>
              </cite>
            ) : null}
            {attribution === undefined && source === undefined && url !== undefined ? (
              <a href={hrefFor(url, input)}>{url}</a>
            ) : null}
          </figcaption>
        ) : null}
      </figure>
    </>
  );
}

/** A link only to an https address: snapshot data names GitHub's own pages, nothing else. */
function safeHref(url: string): string | undefined {
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The GitHub snapshot as leaders and a ruled list of repositories, dated; else the profile alone. */
export function GithubSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'github'>>) {
  const ctx = renderContext(input, section, level);
  const snapshot = githubSnapshot(section, input);
  const ready = snapshot?.state === 'ready' ? snapshot : undefined;
  const data = ready?.value;
  const figures: (readonly [string, number])[] = data
    ? [
        ...(data.totalStarsReceived !== null
          ? [['Stars received', data.totalStarsReceived] as const]
          : []),
        ...(data.contributionsLastYear !== null
          ? [['Contributions in the last year', data.contributionsLastYear] as const]
          : []),
        ['Public repositories', data.totalRepos] as const,
      ]
    : [];
  const repos = data?.pinnedRepos ?? [];
  const day = ready ? new Date(ready.derivedAt) : undefined;
  const dated = day && !Number.isNaN(day.getTime()) ? day : undefined;
  const profile = `https://github.com/${encodeURIComponent(section.username)}`;
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      {figures.length > 0 ? (
        // The account's figures as the catalogue sets a figure: the number over its label, no leaders.
        <dl className="oa-stats">
          {figures.map(([label, value]) => (
            <div key={label} className="oa-stat">
              <dt>
                <Ui ctx={ctx}>{label}</Ui>
              </dt>
              <dd className="oa-stat__figure">{formatFigure(value, ctx)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {repos.length > 0 ? (
        <ul className="oa-ruled oa-repos" role="list">
          {repos.map((repo) => {
            const href = safeHref(repo.url);
            return (
              <li key={repo.name}>
                {href ? <a href={href}>{repo.name}</a> : repo.name}
                <span className="oa-quiet" data-type-role="label">
                  <Ui ctx={ctx}>{`${formatFigure(repo.stars, ctx)} stars`}</Ui>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="oa-credit" data-type-role="label">
        {dated ? (
          <>
            <Ui ctx={ctx}>Snapshot of</Ui>{' '}
            <time dateTime={dated.toISOString().slice(0, 10)} lang={ctx.uiLang}>
              {new Intl.DateTimeFormat('en-GB', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC',
              }).format(dated)}
            </time>
            {', '}
          </>
        ) : null}
        <a href={profile}>{`@${section.username}`}</a>
      </p>
    </>
  );
}

/** The owner's own section: its body, then each item with its words, pictures, evidence, and links. */
export function CustomSection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionTitle section={section} ctx={ctx} />
      {present(section.body) ? (
        <RichText source={section.body} className="oa-prose" input={input} />
      ) : null}
      {section.items?.length ? (
        <ul className="oa-ruled oa-custom" role="list">
          {section.items.map((item, index) => {
            const media = (item.media ?? []).flatMap((placement) => {
              const image = placedMedia(placement, ctx);
              return image ? [image] : [];
            });
            const evidence = evidenceByIds(item.evidence, input);
            return (
              <li key={index}>
                <p className="oa-materials__name">{item.title}</p>
                {present(item.summary) ? (
                  <RichText source={item.summary} className="oa-quiet" input={input} />
                ) : null}
                {media.map((image, mediaIndex) => (
                  <MediaFigure
                    key={`${image.asset}-${mediaIndex}`}
                    placed={image}
                    ctx={ctx}
                    className="oa-custom__image"
                    sizes="(min-width: 64rem) 40vw, 100vw"
                  />
                ))}
                {evidence.length > 0 ? (
                  <ol className="oa-entries" role="list">
                    {evidence.map((entry) => (
                      <Entry key={entry.id} entry={entry} ctx={ctx} />
                    ))}
                  </ol>
                ) : null}
                {item.links?.length ? (
                  <ul className="oa-links" role="list">
                    {item.links.map((link, linkIndex) => (
                      <li key={linkIndex}>
                        <a href={hrefFor(link.url, input)}>{linkText(link)}</a>
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
}
