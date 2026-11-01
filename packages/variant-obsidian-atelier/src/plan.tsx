import { Children, type ComponentType, type ReactNode } from 'react';
import type { OutlineSection } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { AtelierModel } from './model';
import { destination, type DestinationId } from './navigation';
import { homeHref, numbers, ownId, Words } from './parts';

// The plan of the exhibition (redesign, stream C): the composition's own
// index, drawn as a floor plan of hairline walls with door gaps. The
// entrance, each room by its number and its work, the collection with a
// door to each bay, Writing with a door to each of its bays, and each gallery with a door to each section the owner
// titled, so every section on the page is two actions from anywhere: Index,
// then its door. The Index dialog shows it whole, with links that close the
// dialog before they go; the footer draws the rooms alone.

type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  lang?: string;
  children: ReactNode;
}>;

function Plain({
  href,
  className,
  lang,
  children,
}: {
  href: string;
  className?: string;
  lang?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className} lang={lang}>
      {children}
    </a>
  );
}

/** Whether the plan has anything past the entrance: a room, the collection, or a gallery. */
export function hasPlan(model: AtelierModel): boolean {
  return model.rooms.length > 0 || model.collection.length > 0 || model.galleries.length > 0;
}

/** Where the entrance is: the composition's own wall, which the running head marks too. */
export function entranceAnchor(_model: AtelierModel, input: VariantRenderInput): string {
  return ownId(input, 'entrance');
}

export function Plan({
  model,
  input,
  link: Link = Plain,
  doors: withDoors = false,
}: {
  model: AtelierModel;
  input: VariantRenderInput;
  /** The link each door is: a plain link, or the dialog's, which closes it first. */
  link?: LinkComponent;
  /** Whether each room shows a door to each of its sections, as the Index does, or its name alone. */
  doors?: boolean;
}) {
  // A door to each section the owner titled and the page links, of those the set holds.
  const doorsTo = (holds: (section: OutlineSection) => boolean | undefined) =>
    !withDoors
      ? []
      : model.outline.sections.filter(
          (section) => section.href !== undefined && section.title !== undefined && holds(section),
        );
  const doors = (key: DestinationId) =>
    doorsTo((section) => destination(model.navigation, key)?.sections.includes(section));
  const collection = doors('work');
  const hasContact = model.galleries.some(({ key }) => key === 'contact');
  // The exit wall, on the way out: its quote's own title, else its place's name.
  const exitEntry = model.exit
    ? model.outline.sections.find(({ id }) => id === model.exit!.id)
    : undefined;
  const exit = model.exit ? (
    <li key="exit" className="oa-plan__room">
      <Link
        className="oa-plan__name"
        href={exitEntry?.href ?? homeHref(input, `${input.ids.prefix}${model.exit.id}`)}
        lang={exitEntry?.title ? exitEntry.lang : undefined}
      >
        {exitEntry?.title ?? <Words input={input}>Last word</Words>}
      </Link>
    </li>
  ) : null;
  // Writing is its own destination, though its bays hang on the collection wall.
  const writing = destination(model.navigation, 'writing');
  const reading = doors('writing');
  const galleryRooms = model.galleries.flatMap((gallery, index) => {
    // What the gallery hangs: the exit wall's quote hangs at the exit, which is its own entry.
    const hung = gallery.sections.filter((section) => section !== model.exit);
    const shown = doorsTo((section) => hung.some(({ id }) => id === section.id));
    const last = index === model.galleries.length - 1;
    const exitHere = gallery.key === 'contact' || (last && !hasContact);
    const room =
      hung.length > 0 ? (
        <li key={gallery.key} className="oa-plan__room oa-plan__room--wide">
          {/* A gallery's door is its namesake section, as the shared model picks it, or its wall. */}
          <Link
            className="oa-plan__name"
            href={
              destination(model.navigation, gallery.key)?.href ??
              homeHref(input, ownId(input, gallery.key))
            }
          >
            <Words input={input}>{gallery.label}</Words>
          </Link>
          {model.halls.get(gallery.key) ? (
            <span className="oa-plan__count">
              <Words input={input}>{`Room\u00a0${model.halls.get(gallery.key)!.numeral}`}</Words>
            </span>
          ) : null}
          {shown.length > 0 ? (
            <ul className="oa-plan__doors" role="list">
              {shown.map((section) => (
                <li key={section.id}>
                  <Link href={section.href!} lang={section.lang}>
                    {section.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ) : null;
    if (!exitHere || !exit) return room ? [room] : [];
    // The exit wall stands before Contact, or after the last gallery when there's none.
    return gallery.key === 'contact'
      ? [exit, ...(room ? [room] : [])]
      : [...(room ? [room] : []), exit];
  });
  return (
    <ol className={withDoors ? 'oa-plan oa-plan--index' : 'oa-plan'} data-oa-plan="">
      <Wing>
        <li className="oa-plan__room">
          <Link className="oa-plan__name" href={homeHref(input, entranceAnchor(model, input))}>
            <Words input={input}>Entrance</Words>
          </Link>
        </li>
        {model.rooms.map((room) => (
          <li key={room.work.id} className="oa-plan__room">
            {/* The work first, the room second: the plan names what's in each room. */}
            <Link
              className="oa-plan__name"
              href={homeHref(input, room.anchor)}
              lang={room.work.lang}
            >
              {room.work.title}
            </Link>
            <span className="oa-plan__count">
              <Words input={input}>{`Room\u00a0${room.numeral}, No.\u00a0${room.number}`}</Words>
            </span>
          </li>
        ))}
      </Wing>
      <Wing>
        {model.collection.length > 0 ? (
          <li className="oa-plan__room oa-plan__room--wide">
            <Link className="oa-plan__name" href={homeHref(input, ownId(input, 'collection'))}>
              {/* What's there first: the work; the collection wall second. */}
              <Words input={input}>Work</Words>{' '}
              <span className="oa-plan__count">
                <Words input={input}>
                  {model.hangs
                    ? `the collection, ${numbers(model.hangs.first, model.hangs.last)}`
                    : 'the collection'}
                </Words>
              </span>
            </Link>
            {collection.length > 0 ? (
              <ul className="oa-plan__doors" role="list">
                {collection.map((section) => (
                  <li key={section.id}>
                    <Link href={section.href!} lang={section.lang}>
                      {section.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
        {/* Writing's bays hang on the collection wall, so it has a cell of its own only where it lists them. */}
        {writing?.href !== undefined && reading.length > 0 ? (
          <li className="oa-plan__room oa-plan__room--wide">
            <Link className="oa-plan__name" href={writing.href}>
              <Words input={input}>{writing.label}</Words>
            </Link>
            {reading.length > 0 ? (
              <ul className="oa-plan__doors" role="list">
                {reading.map((section) => (
                  <li key={section.id}>
                    <Link href={section.href!} lang={section.lang}>
                      {section.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
      </Wing>
      {/* Practice beside Record, the halls; then Contact and the last word, a wing of their own. */}
      <Wing>{galleryRooms.filter(({ key }) => key === 'about' || key === 'record')}</Wing>
      <Wing>{galleryRooms.filter(({ key }) => key !== 'about' && key !== 'record')}</Wing>
    </ol>
  );
}

/**
 * A wing of the plan: the entrance and the rooms, the collection and
 * writing, the galleries and the exit, each a row of its own, its rooms
 * sharing the row, so no row of the drawing is left with an empty bay.
 */
function Wing({ children }: { children: ReactNode }) {
  const rooms = Children.toArray(children);
  if (rooms.length === 0) return null;
  return (
    <li className="oa-plan__wing">
      <ol className="oa-plan__rooms" role="list">
        {rooms}
      </ol>
    </li>
  );
}
