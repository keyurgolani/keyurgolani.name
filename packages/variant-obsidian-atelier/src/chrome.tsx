import { Dialog, Header } from '@portfolio/appearance/primitives';
import { VisitorControlSlot } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Here } from './client/here';
import { NavLandmark } from './client/nav-landmark';
import { PlanLink } from './client/plan-link';
import { mediumLabel, type AtelierModel } from './model';
import { entranceAnchor, hasPlan, Plan } from './plan';
import { homeHref, ownId, uiLang } from './parts';

// The corner chrome (redesign, stream C): no bar and no ground, type on
// the page's column lines in the window's top band, which every wall and
// corridor keeps clear. Top left, the mark: the owner's name, back to the
// entrance. From the sixth column, the room switch: a numeral for each
// room, and from a wide window the work's title beside it. Top
// right, the running head, which says where the visitor is, and Index.
// All of it is the first view's top row and scrolls away with the page,
// except Index: one constant plate on the last column line that stays in
// the window, so every section is one or two actions from any depth. Past
// the top, the gallery titles, room numbers, and floor counters say where
// the visitor is. The other destinations live in the plan.
//
// Index is a link to the plan of the exhibition in the footer, which works
// with no script. Once the running head's script runs it marks the chrome,
// and Index becomes the button that opens the same plan in #19's Dialog,
// a native modal: Escape closes it, focus stays inside and goes back to
// Index, and the plan's links close it before they go.

/** Every id the owner's content holds: any of them can be an element's id on the page. */
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
 * The Index dialog's local id. #19's Dialog takes a local id in the form a
 * content id has, so it's `oa-plan`, unless the content holds that id, and
 * then the first of `oa-plan-2`, `oa-plan-3`, and on, that it doesn't.
 */
export function planDialogId(portfolio: VariantRenderInput['portfolio']): string {
  const taken = contentIds(portfolio, new Set());
  let id = 'oa-plan';
  for (let n = 2; taken.has(id); n += 1) id = `oa-plan-${n}`;
  return id;
}

export function Chrome({
  input,
  model,
  here = 'Entrance',
}: {
  input: VariantRenderInput;
  model: AtelierModel;
  /** Where the page starts, which the running head says before anything scrolls. */
  here?: string;
}) {
  const lang = uiLang(input);
  return (
    <Header className="oa-chrome" pinned>
      {/* The running head's strip: past five windows, a band the plates stand on, so nothing prints under them. */}
      <span className="oa-chrome__strip" aria-hidden="true" />
      <a
        className="oa-chrome__mark"
        href={homeHref(input, entranceAnchor(model, input))}
        data-type-role="label"
      >
        {input.portfolio.identity.name}
      </a>
      {model.rooms.length > 1 ? (
        <NavLandmark label="Rooms" className="oa-chrome__rooms">
          <ul role="list" data-oa-rooms="" data-type-role="label">
            {model.rooms.map((room) => {
              const medium = mediumLabel(room.work);
              // Named by the numeral and, from a wide window, the work's title cut at a word; the whole title is its name.
              return (
                <li key={room.work.id}>
                  <a
                    href={homeHref(input, room.anchor)}
                    aria-label={`Room ${room.numeral}, ${room.work.title}${medium ? `, ${medium}` : ''}`}
                  >
                    <span className="oa-chrome__numeral">{room.numeral}</span>
                    {room.name ? (
                      <span className="oa-chrome__name" lang={room.work.lang}>
                        {` ${room.name}`}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </NavLandmark>
      ) : null}
      {/* The running head and the visitor control scroll away with the top row; Index's plate stays. */}
      <div className="oa-chrome__corner" data-type-role="label">
        <Here initial={here} />
        <div className="oa-chrome__appearance">
          <VisitorControlSlot />
        </div>
        {hasPlan(model) ? (
          <div className="oa-chrome__dock">
            <div className="oa-chrome__pin">
              <a className="oa-chrome__index-link" href={`#${ownId(input, 'plan')}`}>
                <span className="oa-plus" aria-hidden="true" />
                <span className="oa-chrome__index-word" lang={lang}>
                  Index
                </span>
              </a>
              <div className="oa-chrome__index">
                <Dialog
                  id={planDialogId(input.portfolio)}
                  triggerEmphasis="quiet"
                  trigger={
                    <span className="oa-chrome__index-label">
                      <span className="oa-plus" aria-hidden="true" />
                      <span className="oa-chrome__index-word" lang={lang}>
                        Index
                      </span>
                    </span>
                  }
                  title={<span lang={lang}>Plan of the exhibition</span>}
                  description={
                    <span lang={lang}>Every room and gallery, and the sections in each.</span>
                  }
                  closeLabel="Close"
                >
                  <Plan model={model} input={input} link={PlanLink} doors />
                </Dialog>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Header>
  );
}
