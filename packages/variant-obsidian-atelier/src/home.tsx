import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import { Footer } from '@portfolio/appearance/primitives';
import {
  chronologyOf,
  evidenceOf,
  footerOutline,
  present,
  renderSection,
  RichText,
  type BespokeRenderers,
  type HomePageProps,
  type SectionComposition,
  type SectionFrame,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Chrome } from './chrome';
import { NavLandmark } from './client/nav-landmark';
import { baySpans, WorksSection } from './collection';
import { Entrance, EntranceWords, HeroRenderer } from './entrance';
import {
  ContactSection,
  CtaSection,
  CustomSection,
  GithubSection,
  QuoteSection,
} from './galleries/contact';
import { EvidenceSection } from './galleries/evidence';
import { readsWide } from './galleries/evidence-layout';
import { LedeSection, NowSection, PracticeSection, ShortList } from './galleries/practice';
import { ChronologySection, hasWork } from './galleries/record';
import { firstParagraph, pairHalves } from './layout';
import {
  atelierModel,
  hangingOrder,
  roman,
  type AtelierModel,
  type Gallery,
  type Hall,
} from './model';
import { homeHref, numbers, ownId, Words } from './parts';
import { destination } from './navigation';
import { entranceAnchor, hasPlan, Plan } from './plan';
import { RoomView } from './room';

// Obsidian Atelier's home page (redesign, stream C): a private viewing, in
// the order a visitor walks it. The corner chrome; the entrance wall with
// the signature hung on it; the rooms, one work each; the collection's
// salon wall, a bay for each works section; the galleries, Practice,
// Record, and Contact, each under its signage, with the exit wall's
// inscription before Contact; and the colophon, whose plan of the
// exhibition is the page's index. Every section renders through the
// composition's own renderers and frames, and nothing needs a script to
// read or to reach: the running head and the Index dialog's links are the
// only client code, and each is a link or a native modal without it.

/** Every core kind, through the composition's own renderers. */
export const RENDERERS = {
  hero: HeroRenderer,
  lede: LedeSection,
  now: NowSection,
  works: WorksSection,
  evidence: EvidenceSection,
  chronology: ChronologySection,
  practice: PracticeSection,
  contact: ContactSection,
  custom: CustomSection,
  quote: QuoteSection,
  focus: ShortList,
  'fun-facts': ShortList,
  cta: CtaSection,
  github: GithubSection,
} satisfies BespokeRenderers;

/** Whether a record or contact section reads across its gallery, or in half of it. */
function readsAcross(section: Section, input: VariantRenderInput): boolean {
  switch (section.kind) {
    case 'chronology':
      return hasWork(chronologyOf(section, input));
    case 'evidence':
      return readsWide(evidenceOf(section, input));
    case 'custom':
      return true;
    default:
      return false;
  }
}

/** The frame around each section: the wall, bay, or block the model puts it in. */
function frameFor(
  model: AtelierModel,
  input: VariantRenderInput,
  /** The composition the frame is part of, for a section a frame hangs inside another's. */
  composition?: () => SectionComposition,
): SectionFrame {
  // Whether each block of a gallery that isn't a hall reads across it or in half, in the order it hangs.
  const placeOf = new Map<string, string>();
  for (const gallery of model.galleries) {
    if (model.halls.has(gallery.key)) continue;
    const hung = hangingOrder(gallery, model.exit, model.exitLabel);
    const spans = pairHalves(hung.map((section) => readsAcross(section, input)));
    hung.forEach((section, index) => placeOf.set(section.id, spans[index]!));
  }
  const spans = baySpans(model);
  const writing = new Set(
    destination(model.navigation, 'writing')?.sections.map((entry) => entry.id) ?? [],
  );
  const contact = model.galleries.find((gallery) => gallery.key === 'contact');
  return function Frame({ frame, section, children }) {
    // On the entrance wall: the hero is its plaque, the thesis its room title.
    if (model.hero?.id === section.id) {
      return (
        <section {...frame} className="oa-plaque">
          {children}
        </section>
      );
    }
    if (model.thesis?.id === section.id) {
      return (
        <section {...frame} className="oa-entrance__statement">
          {children}
        </section>
      );
    }
    if (model.exit?.id === section.id) {
      // The exit wall's label: Contact's call to work together, pinned beside the inscription.
      const label =
        model.exitLabel && composition
          ? renderSection(model.exitLabel, input, composition(), { level: 3 })
          : null;
      return (
        <section {...frame} className="oa-exit oa-wall" data-labelled={label ? '' : undefined}>
          {children}
          {label}
          {contact || model.total > 0 ? (
            <p className="oa-wallfloor" data-type-role="label">
              {contact ? (
                <a href={`#${ownId(input, contact.key)}`}>
                  <Words input={input}>{`Then ${contact.label}`}</Words>
                </a>
              ) : null}
              {model.total > 0 ? (
                <span className="oa-wallfloor__count">
                  <Words input={input}>{`${numbers(1, model.total)} hung`}</Words>
                </span>
              ) : null}
            </p>
          ) : null}
        </section>
      );
    }
    if (section.kind === 'works') {
      // A bay is a place of its own: the running head names it, Writing's by its own name.
      return (
        <section
          {...frame}
          className={`oa-bay oa-bay--span-${spans.get(section.id) ?? 12}`}
          data-oa-place={writing.has(section.id) ? 'Writing' : 'Collection'}
        >
          {children}
        </section>
      );
    }
    return (
      <section
        {...frame}
        className={`oa-block oa-block--${section.kind}`}
        data-oa-span={placeOf.get(section.id)}
      >
        {children}
      </section>
    );
  };
}

function Signage({ input, gallery }: { input: VariantRenderInput; gallery: Gallery }) {
  return (
    <h2 id={ownId(input, `${gallery.key}-title`)} className="oa-signage" data-type-role="headline">
      <Words input={input}>{gallery.label}</Words>
    </h2>
  );
}

/**
 * A hall's running head (C1): the left track's standing job while the room
 * is read, sticky beside it: the room's plaque, its name, where it leads
 * in the catalogue, and the plan of the exhibition, one step away.
 */
function HallRail({
  input,
  gallery,
  hall,
  model,
}: {
  input: VariantRenderInput;
  gallery: Gallery;
  hall: Hall;
  model: AtelierModel;
}) {
  return (
    <div className="oa-hall__rail">
      <p className="oa-hall__plaque" data-type-role="label">
        <Words input={input}>{`Room ${hall.numeral} of ${roman(model.roomCount)}`}</Words>
      </p>
      <Signage input={input} gallery={gallery} />
      <p className="oa-hall__index" data-type-role="label">
        <a href={`#${ownId(input, 'plan')}`}>
          <Words input={input}>The plan of the exhibition</Words>
        </a>
      </p>
    </div>
  );
}

function GalleryView({
  gallery,
  model,
  input,
  composition,
}: {
  gallery: Gallery;
  model: AtelierModel;
  input: VariantRenderInput;
  composition: SectionComposition;
}) {
  const listed = (sections: readonly Section[]) =>
    sections.flatMap((section) => {
      const element = renderSection(section, input, composition, { level: 3 });
      return element ? [element] : [];
    });
  const rest = gallery.sections.filter(
    (section) => section !== model.exit && section !== model.exitLabel,
  );
  if (rest.length === 0) return null;
  const titleId = ownId(input, `${gallery.key}-title`);
  const hall = model.halls.get(gallery.key);
  if (hall) {
    const words = hall.lead[0];
    const rest =
      gallery.key === 'about' && words?.kind === 'lede'
        ? firstParagraph(words.body).rest
        : undefined;
    const next = model.galleries[model.galleries.indexOf(gallery) + 1];
    return (
      <section
        id={ownId(input, gallery.key)}
        className={`oa-gallery oa-gallery--${gallery.key} oa-hall oa-wall`}
        aria-labelledby={titleId}
        data-oa-place={`Room ${hall.numeral}, ${gallery.label}`}
        data-oa-key={gallery.key}
      >
        <HallRail input={input} gallery={gallery} hall={hall} model={model} />
        {hall.lead.length > 0 ? <div className="oa-hall__lead">{listed(hall.lead)}</div> : null}
        {hall.whole.length > 0 || rest !== undefined ? (
          // The rest of the hall, folded on the server: one disclosure, its name the summary.
          <details className="oa-whole">
            <summary className="oa-summary">
              <span className="oa-plus" aria-hidden="true" />
              <span>
                <Words input={input}>
                  {gallery.key === 'about' ? 'The whole practice' : 'The whole record'}
                </Words>
              </span>
            </summary>
            <div className="oa-whole__main">
              {rest !== undefined ? (
                // The rest of the words whose first paragraph is the hall's wall label.
                <div className="oa-block oa-block--lede">
                  <RichText source={rest} className="oa-prose" input={input} />
                </div>
              ) : null}
              {listed(hall.whole)}
            </div>
          </details>
        ) : null}
        {next ? (
          // The way on: the next gallery, or the last word when it stands before Contact, which says "Then Contact" itself.
          <p className="oa-wallfloor" data-type-role="label">
            {next.key === 'contact' && model.exit ? (
              <a href={`#${input.ids.prefix}${model.exit.id}`}>
                <Words input={input}>Then the last word</Words>
              </a>
            ) : (
              <a href={`#${ownId(input, next.key)}`}>
                <Words input={input}>{`Then ${next.label}`}</Words>
              </a>
            )}
          </p>
        ) : null}
      </section>
    );
  }
  const main = hangingOrder(gallery, model.exit, model.exitLabel);
  return (
    <section
      id={ownId(input, gallery.key)}
      className={`oa-gallery oa-gallery--${gallery.key}`}
      aria-labelledby={titleId}
      data-oa-place={gallery.label}
      data-oa-key={gallery.key}
    >
      <Signage input={input} gallery={gallery} />
      <div className="oa-gallery__main">{listed(main)}</div>
    </section>
  );
}

/**
 * The colophon (C6): the plan of the exhibition, rooms alone, then one
 * line: the name and its one line, the catalogue's count, and the way back
 * to the entrance. How to get in touch is the Contact gallery's, never
 * repeated here; a portfolio with no Contact gallery has it here, once.
 */
export function Colophon({
  input,
  model,
  composition,
}: {
  input: VariantRenderInput;
  model: AtelierModel;
  composition: SectionComposition;
}) {
  const outline = footerOutline(input, composition);
  const titleId = ownId(input, 'plan-title');
  // Every room the page hangs, Practice and Record among them, as "Room V of V" counts them.
  const rooms = model.roomCount;
  const summary = [
    `A catalogue of ${model.total === 1 ? '1 work' : `${model.total} works`}`,
    rooms > 0 ? `in ${rooms === 1 ? '1 room' : `${rooms} rooms`}` : undefined,
  ]
    .filter(present)
    .join(' ');
  const links = [...(outline.contact?.links ?? []), ...outline.links];
  // The Contact gallery says how to get in touch; with none, the colophon does, once.
  const contact = model.galleries.some(({ key }) => key === 'contact');
  return (
    <Footer className="oa-colophon" id={ownId(input, 'plan')}>
      {hasPlan(model) ? (
        <NavLandmark labelledBy={titleId} className="oa-colophon__plan">
          <h2 id={titleId} className="oa-h3">
            <Words input={input}>Plan of the exhibition</Words>
          </h2>
          <Plan model={model} input={input} />
        </NavLandmark>
      ) : null}
      {contact ? null : (
        <div className="oa-colophon__text oa-label" data-type-role="body">
          {present(outline.contact?.message) ? <p>{outline.contact.message}</p> : null}
          {outline.email ? (
            <p>
              <a href={outline.email.href}>{outline.email.text}</a>
            </p>
          ) : null}
          {links.length > 0 ? (
            <ul className="oa-links" role="list">
              {links.map((link, index) => (
                <li key={index}>
                  <a href={link.href} data-platform={link.platform}>
                    {link.text}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className="oa-colophon__base" data-type-role="label">
        <p>
          <span className="oa-colophon__name">{outline.name}</span>
          {present(outline.tagline) ? `, ${outline.tagline}` : null}
        </p>
        {model.total > 0 ? (
          <p>
            <Words input={input}>{`${summary}.`}</Words>
          </p>
        ) : null}
        <p>
          <a href={homeHref(input, entranceAnchor(model, input))}>
            <Words input={input}>Back to the entrance</Words>
          </a>
        </p>
      </div>
    </Footer>
  );
}

/** The composition's own renderers and frames, which both pages' sections and the footer outline read. */
export function atelierComposition(
  model: AtelierModel,
  input: VariantRenderInput,
): SectionComposition {
  const composition: SectionComposition = {
    renderers: RENDERERS,
    Frame: frameFor(model, input, () => composition),
  };
  return composition;
}

export function HomePage({ input }: HomePageProps) {
  const { ids } = input;
  const model = atelierModel(input);
  const composition = atelierComposition(model, input);
  const sections = (list: readonly Section[], level: 2 | 3) =>
    list.flatMap((section): ReactElement[] => {
      const element = renderSection(section, input, composition, { level });
      return element ? [element] : [];
    });
  const bays = sections(model.collection, 3);
  const inRooms = model.rooms.length;
  return (
    <>
      <Chrome input={input} model={model} />
      {/* Focusable, so the host's skip link moves focus here, not only the view. */}
      <main id={ids.main} className="oa-main" tabIndex={-1}>
        <Entrance
          input={input}
          model={model}
          render={(section, level) => renderSection(section, input, composition, { level })}
        />
        <EntranceWords input={input} model={model} />
        {model.rooms.map((room) => (
          <RoomView key={room.work.id} room={room} model={model} input={input} />
        ))}
        {bays.length > 0 ? (
          <section
            id={ownId(input, 'collection')}
            className={`oa-collection oa-wall${model.hangs ? '' : ' oa-collection--notes'}`}
            aria-labelledby={ownId(input, 'collection-title')}
            data-oa-place="Collection"
            data-oa-key="collection"
          >
            <div className="oa-collection__head">
              <h2
                id={ownId(input, 'collection-title')}
                className="oa-signage"
                data-type-role="headline"
              >
                <Words input={input}>Collection</Words>
              </h2>
              {model.hangs ? (
                <p className="oa-quiet">
                  <Words input={input}>
                    {`${numbers(model.hangs.first, model.hangs.last)}, hung by section.${
                      inRooms > 0
                        ? ` ${numbers(1, inRooms)} ${inRooms === 1 ? 'is in its room' : 'are in the rooms'}.`
                        : ''
                    }`}
                  </Words>
                </p>
              ) : null}
            </div>
            <div className="oa-bays">{bays}</div>
            {model.hangs || model.galleries[0] ? (
              <p className="oa-wallfloor" data-type-role="label">
                {model.galleries[0] ? (
                  <a href={`#${ownId(input, model.galleries[0].key)}`}>
                    <Words input={input}>{`Then ${model.galleries[0].label}`}</Words>
                  </a>
                ) : null}
                {model.hangs ? (
                  <span className="oa-wallfloor__count">
                    <Words input={input}>{numbers(model.hangs.first, model.hangs.last)}</Words>
                  </span>
                ) : null}
              </p>
            ) : null}
          </section>
        ) : null}
        {model.galleries.map((gallery) => (
          <GalleryRun
            key={gallery.key}
            gallery={gallery}
            model={model}
            input={input}
            composition={composition}
          />
        ))}
      </main>
      <Colophon input={input} model={model} composition={composition} />
    </>
  );
}

/** A gallery, and the exit wall on the way out: before Contact, else after the last gallery. */
function GalleryRun(props: {
  gallery: Gallery;
  model: AtelierModel;
  input: VariantRenderInput;
  composition: SectionComposition;
}) {
  const { gallery, model, input, composition } = props;
  const { galleries } = model;
  const contact = galleries.some(({ key }) => key === 'contact');
  const exit = model.exit ? renderSection(model.exit, input, composition, { level: 2 }) : null;
  const before = gallery.key === 'contact' ? exit : null;
  const after = !contact && gallery === galleries[galleries.length - 1] ? exit : null;
  return (
    <>
      {before}
      <GalleryView {...props} />
      {after}
    </>
  );
}
