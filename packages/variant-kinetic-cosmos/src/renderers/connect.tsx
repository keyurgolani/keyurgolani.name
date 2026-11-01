import type { CSSProperties } from 'react';
import type { Link } from '@portfolio/schema';
import {
  Heading,
  hrefFor,
  present,
  renderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { linkText, shortUrl } from '../parts';

// The closing stage in Kinetic Cosmos (redesign, stream E), the opening's
// bookend: the contact section's heading, its message, and the email set
// large, and the ways out drawn as the opening's legend mirrored, each link
// a body on its own orbit with its address under it; then any call to
// action, its words and its two actions. Every way out is a real link.

/** The ways to get in touch: the email first, unless a link already points at it, then the links. */
function waysOut(input: SectionRendererProps<never>['input']): {
  email?: string;
  links: readonly Link[];
} {
  const { identity, links: portfolioLinks, contact } = input.portfolio;
  const links = contact?.links?.length ? contact.links : portfolioLinks;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email !== undefined ? `mailto:${email}` : undefined;
  const listed =
    mailto !== undefined && links.some((link) => link.url.toLowerCase() === mailto.toLowerCase());
  return { ...(email !== undefined && !listed ? { email } : {}), links };
}

export function ContactBody({ section, input, level }: SectionRendererProps<SectionOf<'contact'>>) {
  const ctx = renderContext(input, section, level);
  const { email, links } = waysOut(input);
  const message = input.portfolio.contact?.message;
  return (
    <div className="kc-contact">
      <div className="kc-contact__words">
        {present(section.title) ? (
          <Heading level={level} className="kc-contact__title">
            {section.title}
          </Heading>
        ) : null}
        {present(section.subtitle) ? (
          <p className="kc-contact__message">{section.subtitle}</p>
        ) : null}
        {present(message) ? <p className="kc-contact__message">{message}</p> : null}
        {email !== undefined ? (
          <p className="kc-contact__email">
            <a href={`mailto:${email}`}>{email}</a>
          </p>
        ) : null}
      </div>
      {links.length > 0 ? (
        <div className="kc-ways">
          <svg
            className="kc-ways__orbits"
            viewBox="0 0 400 400"
            aria-hidden="true"
            focusable="false"
          >
            <circle className="kc-ways__halo" cx="200" cy="200" r="190" />
            <circle className="kc-ways__orbit" cx="200" cy="200" r="150" />
            <circle className="kc-ways__orbit" cx="200" cy="200" r="104" />
            <circle className="kc-ways__orbit" cx="200" cy="200" r="58" />
            <circle className="kc-ways__orbit" cx="200" cy="200" r="48" />
          </svg>
          <span className="kc-ways__core" aria-hidden="true" />
          <ol
            className="kc-ways__list"
            role="list"
            style={{ '--layout-count': links.length } as CSSProperties}
          >
            {links.map((link, index) => (
              <li
                key={index}
                className="kc-way"
                style={{ '--layout-index': index } as CSSProperties}
              >
                <span className="kc-way__body" aria-hidden="true" />
                <a
                  className="kc-way__link"
                  href={hrefFor(link.url, ctx.input)}
                  data-platform={link.platform}
                >
                  <span className="kc-way__name">{linkText(link)}</span>
                  {shortUrl(link.url) === linkText(link) ? null : (
                    <span className="kc-way__address" data-type-role="label">
                      {shortUrl(link.url)}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export function CtaBody({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const ctx = renderContext(input, section, level);
  // The closing stage already holds the email and every way out: an action
  // that only repeats one of them isn't drawn twice (review round 2).
  const { email, links } = waysOut(input);
  const key = (url: string) =>
    url
      .trim()
      .toLowerCase()
      .replace(/[?#].*$/, '');
  const shown = new Set([
    ...(email !== undefined ? [key(`mailto:${email}`)] : []),
    ...links.map((link) => key(link.url)),
  ]);
  const actions: Link[] = [];
  for (const action of [section.primaryAction, section.secondaryAction]) {
    if (action !== undefined && !shown.has(key(action.url))) actions.push(action);
  }
  return (
    <div className="kc-cta">
      {present(section.title) ? (
        <Heading level={level} className="kc-cta__title">
          {section.title}
        </Heading>
      ) : null}
      {present(section.subtitle) ? <p className="kc-cta__words">{section.subtitle}</p> : null}
      {present(section.description) ? <p className="kc-cta__words">{section.description}</p> : null}
      {actions.length > 0 ? (
        <ul className="kc-cta__actions" role="list">
          {actions.map((action, index) => (
            <li key={index}>
              <a
                className={index === 0 ? 'kc-button kc-button--bright' : 'kc-link-action'}
                href={hrefFor(action.url, ctx.input)}
                data-platform={action.platform}
              >
                {linkText(action)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
