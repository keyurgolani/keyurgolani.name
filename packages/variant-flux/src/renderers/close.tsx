import type { Link, Section } from '@portfolio/schema';
import { footerOutline, hrefFor, type SectionRendererProps } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { openingHeading } from '../hero';
import { contactLinks, linkLabel, moreActions, present } from '../model';
import { Address, ownId, Out, Phrase, uiLang, Words } from '../parts';

// The close (brief §5.10, contact; FX-M4 under R10-8; FX-S46, FX-S53).
// The email at display size is the primary contact, a real mailto link.
// Beside it, Copy email: an ordinary button that copies the address, with
// one polite status. It never moves (the runaway dodge doesn't ship), and
// with no script it isn't shown, since it can't copy without one. Then the
// contact's own message at body weight and its links. The call to action
// beside the contact section merges in under the contact's one heading:
// its title opens its message, and its actions lead the links.

type Of<K extends Section['kind']> = Extract<Section, { kind: K }>;

export function ContactRenderer({ input }: SectionRendererProps<Of<'contact'>>) {
  const lang = uiLang(input.portfolio.locale);
  const { identity, contact } = input.portfolio;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const links = contactLinks(input);
  return (
    <div className="fx-close">
      {email ? (
        <div className="fx-close__mail">
          <p className="fx-close__address" data-type-role="display">
            <a href={`mailto:${email}`}>
              <Address email={email} />
            </a>
          </p>
          <p className="fx-close__copy">
            <button
              type="button"
              className="fx-btn fx-btn--quiet"
              data-fx-copy={email}
              data-type-role="label"
              hidden
            >
              <Words lang={lang}>Copy email</Words>
            </button>
            <span
              className="fx-close__status"
              role="status"
              aria-live="polite"
              id={ownId(input.ids.prefix, 'copy-status')}
              data-type-role="body-compact"
              lang={lang}
            />
          </p>
        </div>
      ) : null}
      {present(contact?.message) ? (
        <p className="fx-close__note" data-type-role="body">
          {contact.message}
        </p>
      ) : null}
      <Links input={input} links={links} />
    </div>
  );
}

/** The close's links: the hero's calls to action after the opening's one, then the contact links. */
function Links({ input, links }: { input: VariantRenderInput; links: readonly Link[] }) {
  const actions = moreActions(input);
  const listed = new Set(actions.map((action) => action.url));
  const rest = links.filter((link) => !listed.has(link.url));
  if (actions.length === 0 && rest.length === 0) return null;
  return (
    <ul className="fx-close__links" role="list" data-type-role="label">
      {actions.map((action) => {
        const href = hrefFor(action.url, input);
        return (
          <li key={`cta-${action.url}`}>
            <a href={href}>
              {action.label}
              <Out href={href} />
            </a>
          </li>
        );
      })}
      {rest.map((link) => {
        const href = hrefFor(link.url, input);
        return (
          <li key={link.url}>
            <a href={href}>
              {linkLabel(link)}
              <Out href={href} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function CtaRenderer({ section, input }: SectionRendererProps<Of<'cta'>>) {
  return (
    <div className="fx-offer__body">
      {present(section.description) ? (
        <p className="fx-offer__text" data-type-role="body">
          {section.description}
        </p>
      ) : null}
      {section.primaryAction || section.secondaryAction ? (
        <p className="fx-offer__acts">
          {section.primaryAction ? (
            <a
              className="fx-btn"
              href={hrefFor(section.primaryAction.url, input)}
              data-type-role="label"
            >
              {section.primaryAction.label}
              <Out href={section.primaryAction.url} />
            </a>
          ) : null}
          {section.secondaryAction ? (
            <a
              className="fx-link"
              href={hrefFor(section.secondaryAction.url, input)}
              data-type-role="label"
            >
              {section.secondaryAction.label}
              <Out href={section.secondaryAction.url} />
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** The footer: the name home, the way back to the top, and the year. */
export function Footer({ input }: { input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const outline = footerOutline(input);
  const closes = input.portfolio.sections.some((section) => section.kind === 'contact');
  const email = present(input.portfolio.identity.email)
    ? input.portfolio.identity.email.trim()
    : undefined;
  // The name goes home (the opening, on home); Back to the top is this page's own top.
  const home = input.route.route === 'home';
  const top = home ? `#${openingHeading(input)}` : routeHref(input, { route: 'home' });
  const back = home ? top : `#${input.ids.main}`;
  const { identity } = input.portfolio;
  const who = [identity.pronouns, identity.location].filter(present).map((part) => part.trim());
  return (
    <footer className="fx-foot">
      <p className="fx-foot__name" data-type-role="display">
        <a href={top}>{outline.name}</a>
      </p>
      {/* Who and where, as the owner wrote them: their pronouns and where they are. */}
      {who.length > 0 ? (
        <p className="fx-foot__who" data-type-role="body-compact">
          {who.map((part, index) => (
            <span key={part}>
              {index > 0 ? ' · ' : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}
      {present(outline.tagline) ? (
        <p className="fx-foot__line" data-type-role="body-compact">
          <Phrase source={outline.tagline} input={input} />
        </p>
      ) : null}
      {/* With no contact section, the footer is the way to get in touch: the email and the links. */}
      {closes ? null : (
        <>
          {email ? (
            <p className="fx-foot__mail" data-type-role="body">
              <a href={`mailto:${email}`}>
                <Address email={email} />
              </a>
            </p>
          ) : null}
          <Links input={input} links={contactLinks(input)} />
        </>
      )}
      <p className="fx-foot__meta" data-type-role="caption">
        <span className="fx-num">{`© ${outline.year} ${outline.name}`}</span>
        <a href={back}>
          <Words lang={lang}>Back to the top</Words>
        </a>
      </p>
    </footer>
  );
}
