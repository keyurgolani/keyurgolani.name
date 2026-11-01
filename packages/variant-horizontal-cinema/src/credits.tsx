import type { ReactNode } from 'react';
import { sameTarget, type FooterOutline } from '@portfolio/kit/sections';
import { uiLang, Words } from './parts';

// The end credits (redesign): a roll on the matte after the film. The name
// at display size, then the credits written as sentences on the page's grid
// lines, three columns: who and what, how to get in touch, and the film's
// five chapters as five links with the List view and the full record. A
// copyright line closes it. It's static, every link is real, and nothing
// moves: no sitemap of every section, which the chapter sheet holds. On a
// case study the roll is short: how to get in touch.

/** One link the roll names in a sentence. */
export interface CreditLink {
  readonly href: string;
  readonly title: string;
  readonly lang?: string;
}

/** Links as one sentence's list: "a, b and c", each a real link. */
function Listed({ links, lang }: { links: readonly CreditLink[]; lang: 'en' | undefined }) {
  return (
    <>
      {links.map((link, index) => (
        <span key={link.href}>
          {index > 0 ? (
            index === links.length - 1 ? (
              <>
                {' '}
                <Words lang={lang}>and</Words>{' '}
              </>
            ) : (
              ', '
            )
          ) : null}
          <a href={link.href} lang={link.lang}>
            {link.title}
          </a>
        </span>
      ))}
    </>
  );
}

/** One column of the roll: its label, then its sentence. */
function Credit({
  label,
  lang,
  inFilm,
  phoneOnly,
  children,
}: {
  label: string;
  lang: 'en' | undefined;
  inFilm?: boolean;
  /** Shown only on a phone, where the full credit gives way to the film's own scene. */
  phoneOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="hc-credits__credit"
      data-in-film={inFilm ? '' : undefined}
      data-phone-only={phoneOnly ? '' : undefined}
    >
      <p className="hc-credits__label" data-type-role="label">
        <Words lang={lang}>{label}</Words>
      </p>
      <p className="hc-credits__sentence" data-type-role="body">
        {children}
      </p>
    </div>
  );
}

export function Credits({
  id,
  footer,
  role,
  film,
  listHref,
  recordHref,
  contactInFilm = [],
  contactHref,
  locale,
}: {
  id: string;
  footer: FooterOutline;
  /** The owner's current role, the first credit. */
  role?: string;
  /** The five chapters, each a link to its card; a case study has none. */
  film?: readonly CreditLink[];
  /** The List view. */
  listHref?: string;
  /** The full record after the film. */
  recordHref?: string;
  /** Where the film's Get in touch scene leads, which on a phone the roll doesn't list again. */
  contactInFilm?: readonly string[];
  /** The film's Get in touch, which a phone's roll points to when it lists every way already. */
  contactHref?: string;
  locale: string;
}) {
  const lang = uiLang(locale);
  const contact: CreditLink[] = [
    ...(footer.email ? [footer.email] : []),
    ...footer.links,
    ...(footer.contact?.links ?? []),
  ]
    .filter((link, index, all) => all.findIndex((one) => one.href === link.href) === index)
    .map((link) => ({
      href: link.href,
      title: link.platform ? platformLabel(link.platform) : link.text,
    }));
  // On a phone, only the ways the film's Get in touch scene doesn't list already.
  const rest = contact.filter((link) => !contactInFilm.some((href) => sameTarget(href, link.href)));
  const headingId = `${id}-heading`;
  // The colophon after the copyright, without the name the line has just given.
  const colophon = [withoutName(footer.colophon.title, footer.name), footer.colophon.description]
    .filter((part): part is string => Boolean(part))
    .join('. ')
    .replace(/\s+[—–]\s+/g, ', ');
  const extra: CreditLink[] = [
    ...(listHref ? [{ href: listHref, title: 'the List view', lang }] : []),
    ...(recordHref ? [{ href: recordHref, title: 'the full record', lang }] : []),
  ];
  return (
    <footer id={id} className="hc-credits" aria-labelledby={headingId} tabIndex={-1}>
      <div className="hc-credits__head">
        <p id={headingId} className="hc-credits__name" data-type-role="display">
          {footer.name}
        </p>
        {footer.tagline ? (
          <p className="hc-credits__tagline" data-type-role="title">
            {footer.tagline}
          </p>
        ) : null}
      </div>
      <div className="hc-credits__roll">
        {role ? (
          <Credit label="Role" lang={lang}>
            {role}.
          </Credit>
        ) : null}
        {contact.length > 0 ? (
          <Credit label="Contact" lang={lang} inFilm={rest.length < contact.length}>
            <Listed links={contact} lang={lang} />.
          </Credit>
        ) : null}
        {rest.length > 0 && rest.length < contact.length ? (
          <Credit label="Contact" lang={lang} phoneOnly>
            <Listed links={rest} lang={lang} />.
          </Credit>
        ) : rest.length === 0 && contact.length > 0 && contactHref ? (
          <Credit label="Contact" lang={lang} phoneOnly>
            <a href={contactHref}>
              <Words lang={lang}>Get in touch</Words>
            </a>
            <Words lang={lang}>, every way in one scene of the film.</Words>
          </Credit>
        ) : null}
        {film && film.length > 0 ? (
          <Credit label="The film" lang={lang}>
            <Listed links={film} lang={lang} />
            {extra.length > 0 ? (
              <>
                {'. '}
                <Words lang={lang}>Or read</Words> <Listed links={extra} lang={lang} />
              </>
            ) : null}
            .
          </Credit>
        ) : null}
      </div>
      <div className="hc-credits__end" data-type-role="caption">
        <p>
          {`© ${footer.year} ${footer.name}.`}
          {colophon ? ` ${colophon}` : null}
        </p>
      </div>
    </footer>
  );
}

/** A title without the owner's name it opens with: "Anamika Devi — Portfolio" is "Portfolio". */
function withoutName(title: string | undefined, name: string): string | undefined {
  if (!title) return undefined;
  const rest = title.startsWith(name)
    ? title.slice(name.length).replace(/^[\s—–,:|-]+/, '')
    : title;
  return rest.trim() || undefined;
}

/** A link platform as the credits label it. */
export function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    linkedin: 'LinkedIn',
    mastodon: 'Mastodon',
    bluesky: 'Bluesky',
    website: 'Website',
    resume: 'Résumé',
    email: 'Email',
  };
  return labels[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}
