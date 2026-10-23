import { Dialog } from '@portfolio/appearance/primitives';
import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { MenuLink } from './menu-link';

// The chrome (#14): a bar of section links on a large screen, and on a small
// one #19's Dialog, a native modal that opens from a button, closes on
// Escape, keeps focus inside, gives it back to the button, and stops the
// page's scrolling in CSS, never through document.body. Each set of links
// is in the tab order only while it shows: the stylesheet hides the other
// with display: none. Every section that renders and has a title is linked,
// with no cap. It's all there from the server's first paint, for keyboard
// and touch, with no pointer movement needed.

export interface ChromeLink {
  readonly id: string;
  readonly title: string;
  readonly lang?: string;
}

/** The section links, in page order, as #19's navigation slots. */
function SectionLinks({
  links,
  prefix,
  labelId,
  uiLang,
  inMenu,
}: {
  links: readonly ChromeLink[];
  prefix: string;
  labelId: string;
  uiLang: string | undefined;
  inMenu: boolean;
}) {
  return (
    <nav
      className={inMenu ? 'kc-menu__nav' : 'kc-chrome__nav'}
      data-ui-slot="navigation"
      data-orientation={inMenu ? 'vertical' : 'horizontal'}
      aria-labelledby={labelId}
    >
      <span id={labelId} lang={uiLang} hidden>
        Sections
      </span>
      <ul data-ui-slot="navigation.list">
        {links.map((link) => (
          <li key={link.id} data-ui-slot="navigation.item">
            {inMenu ? (
              <MenuLink href={`#${prefix}${link.id}`} lang={link.lang}>
                {link.title}
              </MenuLink>
            ) : (
              <a data-ui-slot="navigation.link" href={`#${prefix}${link.id}`} lang={link.lang}>
                {link.title}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
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
  return (
    <header className="kc-chrome">
      {links.length > 0 ? (
        <>
          <SectionLinks
            links={links}
            prefix={ids.prefix}
            labelId={`${ids.prefix}kc--sections`}
            uiLang={uiLang}
            inMenu={false}
          />
          <div className="kc-menu">
            <Dialog
              id="kc-menu"
              trigger={<span lang={uiLang}>Sections</span>}
              title={<span lang={uiLang}>Sections</span>}
              closeLabel="Close"
              headingLevel={2}
            >
              <SectionLinks
                links={links}
                prefix={ids.prefix}
                labelId={`${ids.prefix}kc--menu-sections`}
                uiLang={uiLang}
                inMenu
              />
            </Dialog>
          </div>
        </>
      ) : null}
      <VisitorControlSlot />
    </header>
  );
}
