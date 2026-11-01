import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { DestinationId } from '@portfolio/kit/sections';
import { chromeIds, hasNotes, type HomeModel } from '../model';
import { NotesButton } from './notes-button';

// The axial masthead: a 1fr auto 1fr grid on the field's ground, the name
// on the page's centre axis, the destinations split either side of it, and
// Field notes at the end. Under 64rem it's the name and Field notes alone
// (N1: two persistent items on a phone); the destinations are a tap away
// in Field notes. Each destination links to its field on this page; the
// field enhancement marks the one in view (aria-current="location").

/**
 * Where a destination lands on home: its field, or the close for Contact.
 * From a work's own page the field is on home, so the link carries home's
 * path; that page closes on the same field as home, so Contact stays on it.
 */
export function destinationHref(
  id: DestinationId,
  href: string,
  input: VariantRenderInput,
  model: HomeModel,
) {
  const away = input.route.route !== 'home';
  // Contact's own section may be one only home renders (an early call to action); the close's
  // anchor is the one a work's page has (code review P2, MF1).
  const close = model.contact ?? model.cta;
  const closeAt = close && model.navigation.index.find((entry) => entry.id === close.id)?.anchor;
  if (away && id === 'contact' && closeAt) return `#${closeAt}`;
  if (!model.fields.some((field) => field.id === id)) return href;
  const fragment = `#${chromeIds(input.ids.prefix).field(id)}`;
  return away ? `${model.navigation.name.href}${fragment}` : fragment;
}

export function Masthead({
  input,
  model,
  current,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  /** On a work's page, the destination that holds it (S-4); home marks the one in view instead. */
  current?: DestinationId;
}) {
  const { navigation, uiLang } = model;
  const ids = chromeIds(input.ids.prefix);
  const primary = navigation.primary;
  const split = Math.ceil(primary.length / 2);
  const list = (items: typeof primary) =>
    items.length > 0 ? (
      <ul className="tf-mast__list" role="list">
        {items.map((destination) => (
          <li key={destination.id}>
            <a
              href={destinationHref(destination.id, destination.href, input, model)}
              lang={destination.lang}
              aria-current={destination.id === current ? 'page' : undefined}
              data-tf-to={destination.id}
            >
              {destination.label}
            </a>
          </li>
        ))}
      </ul>
    ) : (
      <span />
    );
  return (
    <header className="tf-mast" data-ui-surface={model.quiet ? undefined : 'accent'}>
      <nav className="tf-page" aria-label="Site">
        <div className="tf-mast__row">
          <div className="tf-mast__start">{list(primary.slice(0, split))}</div>
          <a className="tf-mast__name tf-title" href={navigation.name.href}>
            {navigation.name.label}
          </a>
          <div className="tf-mast__end">
            {list(primary.slice(split))}
            {hasNotes(model) ? <NotesButton notesId={ids.notes} uiLang={uiLang} /> : null}
          </div>
        </div>
      </nav>
    </header>
  );
}
