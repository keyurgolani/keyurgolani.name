import type { ReactNode } from 'react';
import { Dialog } from '@portfolio/appearance/primitives';
import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { ChromeFrame, ChromeMotionControl } from './chrome-frame';
import { MenuLink } from './menu-link';

// The chrome (#14): one navigation landmark, always on screen. On a large
// screen it holds the section links; on a small one, the button that opens
// #19's Dialog with the same links, a native modal that closes on Escape,
// keeps focus inside, gives it back to the button, and stops the page's
// scrolling in CSS, never through document.body. Each set of links is in
// the tab order only while it shows: the stylesheet hides the other with
// display: none. Every section that renders and has a title is linked, with
// no cap, and it's all there from the server's first paint, for keyboard
// and touch, with no pointer movement needed. During passive viewing the
// links recede, and any input brings them back (chrome-frame.tsx); beside
// the visitor control is the pause for the page's motion.

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

/** Every id the owner's content holds, anywhere in it: any of them can be an element's id on the page. */
function contentIds(value: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) contentIds(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'id' && typeof item === 'string') found.add(item);
      else contentIds(item, found);
    }
  }
  return found;
}

/**
 * The menu dialog's local id. #19's Dialog takes a local id, one hyphen at
 * a time, which is the same form an owner's section and record ids have, so
 * it's `kc-menu` unless the content already holds that id, and otherwise
 * the first of `kc-menu-2`, `kc-menu-3`, and on, that it doesn't.
 */
export function menuId(portfolio: VariantRenderInput['portfolio']): string {
  const taken = contentIds(portfolio, new Set());
  let id = 'kc-menu';
  for (let n = 2; taken.has(id); n += 1) id = `kc-menu-${n}`;
  return id;
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
    <ChromeFrame>
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
              id={menuId(portfolio)}
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
      <div className="kc-chrome__controls">
        <VisitorControlSlot />
        <ChromeMotionControl policy={input.presentation.motionPolicy} />
      </div>
    </ChromeFrame>
  );
}
