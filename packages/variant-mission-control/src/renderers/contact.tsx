import {
  footerOutline,
  hrefFor,
  present,
  sameTarget,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { said } from '../model';
import { Out } from '../parts';

// Contact on the wall: the open channel. The contact's message, the email
// address at headline size (the biggest link on the board), then every
// other way to reach the owner as a row of channel chips, each place once,
// as footerOutline() lists them. A call to action is its own panel beside
// it: its description and its actions, the first the primary.

/** An in-page link the content wrote, from wherever the page is: home's path on a work's page. */
export const homeward = (href: string, input: VariantRenderInput) =>
  href.startsWith('#') && input.route.route !== 'home'
    ? `${routeHref(input, { route: 'home' })}${href}`
    : href;

export function ContactBody({ input }: SectionRendererProps<SectionOf<'contact'>>) {
  const footer = footerOutline(input);
  const message = footer.contact?.message ?? input.portfolio.contact?.message;
  const listed = input.portfolio.contact?.links?.length
    ? (footer.contact?.links ?? [])
    : footer.links;
  const channels = listed.filter(
    (link) => !(footer.email && sameTarget(link.href, footer.email.href)),
  );
  if (!said(message) && !footer.email && channels.length === 0) return null;
  // The owner's own words for the email link, when they wrote some: the address shows as itself.
  const emailLink = footer.email
    ? (input.portfolio.contact?.links ?? []).find((link) =>
        sameTarget(hrefFor(link.url, input), footer.email!.href),
      )
    : undefined;
  const emailLabel =
    emailLink && said(emailLink.label) && emailLink.label !== footer.email?.text
      ? emailLink.label
      : undefined;
  return (
    <div className="mc-channel">
      {said(message) ? <p className="mc-channel__message">{message}</p> : null}
      {emailLabel ? <p className="mc-channel__via">{emailLabel}</p> : null}
      {footer.email ? (
        <p className="mc-channel__address">
          <a href={footer.email.href}>{footer.email.text}</a>
        </p>
      ) : null}
      {channels.length > 0 ? (
        <ul className="mc-chips">
          {channels.map((link) => (
            <li key={link.href}>
              <Out href={homeward(link.href, input)} className="mc-chip">
                {link.text}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CtaBody({ section, input }: SectionRendererProps<SectionOf<'cta'>>) {
  const actions = [section.primaryAction, section.secondaryAction].filter(
    (action): action is NonNullable<typeof action> => action !== undefined && present(action.label),
  );
  const unique = actions.filter(
    (action, index) =>
      actions.findIndex((other) =>
        sameTarget(hrefFor(other.url, input), hrefFor(action.url, input)),
      ) === index,
  );
  if (!said(section.description) && unique.length === 0) return null;
  return (
    <div className="mc-cta">
      {said(section.description) ? <p className="mc-prose">{section.description}</p> : null}
      {unique.length > 0 ? (
        <ul className="mc-actions">
          {unique.map((action, index) => (
            <li key={`${action.url}-${index}`}>
              <Out
                href={homeward(hrefFor(action.url, input), input)}
                className={index === 0 ? 'mc-act mc-act--primary' : 'mc-act'}
              >
                {action.label}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
