import type { ReactNode } from 'react';
import { Dialog } from '@portfolio/appearance/primitives';
import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { MenuLink } from './menu-link';

// The chrome (#14): one navigation landmark, always on screen. On a large
// screen it holds the section links; on a small one, the button that opens
// #19's Dialog with the same links, a native modal that closes on Escape,
// keeps focus inside, gives it back to the button, and stops the page's
// scrolling in CSS, never through document.body. Each set of links is in
// the tab order only while it shows: the stylesheet hides the other with
// display: none. Every section that renders and has a title is linked, with
// no cap, and it's all there from the server's first paint, for keyboard
// and touch, with no pointer movement needed.

export interface ChromeLink {
  readonly id: string;
  readonly title: string;
  readonly lang?: string;
}

/** The section links, in page order, as #19's navigation slots. */
function SectionList({
  links,
  className,
  link,
}: {
  links: readonly ChromeLink[];
  className: string;
  link: (chrome: ChromeLink) => ReactNode;
}) {
  return (
    <ul className={className} data-ui-slot="navigation.list">
      {links.map((chrome) => (
        <li key={chrome.id} data-ui-slot="navigation.item">
          {link(chrome)}
        </li>
      ))}
    </ul>
  );
}

export function Chrome({
  input,
  links,
}: {
  input: VariantRenderInput;
  links: readonly ChromeLink[];
}) {
  const { ids, portfolio } = input;
  // The host's own words are English, marked so in a portfolio in another language.
  const uiLang = /^en(?:-|$)/i.test(portfolio.locale) ? undefined : 'en';
  // Two hyphens: no content id has them, so none can take this one.
  const labelId = `${ids.prefix}kc--sections`;
  const href = (link: ChromeLink) => `#${ids.prefix}${link.id}`;
  return (
    <header className="kc-chrome">
      {links.length > 0 ? (
        <nav
          className="kc-chrome__nav"
          data-ui-slot="navigation"
          data-orientation="horizontal"
          aria-labelledby={labelId}
        >
          <span id={labelId} lang={uiLang} hidden>
            Sections
          </span>
          <SectionList
            links={links}
            className="kc-chrome__links"
            link={(link) => (
              <a data-ui-slot="navigation.link" href={href(link)} lang={link.lang}>
                {link.title}
              </a>
            )}
          />
          <div className="kc-menu">
            <Dialog
              id="kc-menu"
              trigger={<span lang={uiLang}>Sections</span>}
              title={<span lang={uiLang}>Sections</span>}
              closeLabel="Close"
              headingLevel={2}
            >
              <SectionList
                links={links}
                className="kc-menu__links"
                link={(link) => (
                  <MenuLink href={href(link)} lang={link.lang}>
                    {link.title}
                  </MenuLink>
                )}
              />
            </Dialog>
          </div>
        </nav>
      ) : null}
      <VisitorControlSlot />
    </header>
  );
}
