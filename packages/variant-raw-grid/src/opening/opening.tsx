import {
  hrefFor,
  MediaFigure,
  placedImage,
  present,
  renderContext,
  renderSection,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { cellFrame } from '../frame';
import { chromeIds, recordHref, thesisParts, workHref, type HomeModel } from '../model';
import { Chips, Fit, linkText, Links, Words } from '../parts';
import { cardText } from '../renderers/works';
import { PosterBody } from './poster';

// The opening: one field of three cells. The poster (columns 1 to 8, both
// rows); the thesis (9 to 12), its section's title as black tape and its
// first sentence as the headline when it's short; and under it the pinned
// work, its cover, its title, and one highlight. No thesis: the cell
// drops and the pin spans the column. No work: the thesis spans it.
//
// The page's h1 is the thesis (N5): a short first sentence is the
// headline, set as the h1 with the owner's name as a hidden prefix, and
// the poster's name is display type, a <p>. A thesis too long for a
// headline is a paragraph, and then the poster's name is the h1. The
// tapes are labels, never headings, so the sheets' h2s follow the h1.

/** The thesis's headline, when its first sentence is short enough to be one. */
export const thesisLead = (input: VariantRenderInput) =>
  thesisParts(input.portfolio.practice?.thesis)?.lead;

/** The thesis cell's body: the tape title, the headline (the page's h1), the rest. */
function ThesisBody({
  section,
  input,
  name,
}: SectionRendererProps<SectionOf<'practice'>> & { readonly name: string }) {
  const parts = thesisParts(input.portfolio.practice?.thesis);
  if (!parts) return null;
  // The frame names the cell by this id (frame.tsx's headId()).
  const id = `${input.ids.prefix}${section.id}--head`;
  return (
    <>
      {present(section.title) ? (
        <p className="rg-tab">
          <span id={id}>{section.title}</span>
        </p>
      ) : null}
      {/* In the opening a section's subtitle is a label line under its tape (T1's four sizes). */}
      {present(section.subtitle) ? <p className="rg-meta">{section.subtitle}</p> : null}
      {parts.lead !== undefined ? (
        <h1 className="rg-thesis__lead">
          <span className="rg-hidden">{name}: </span>
          {/* By its longest word as written: any markup only counts it longer. */}
          <Fit text={parts.lead}>
            <RichText source={parts.lead} inline input={input} />
          </Fit>
        </h1>
      ) : null}
      {parts.rest !== undefined ? (
        <RichText
          source={parts.rest}
          className={parts.lead !== undefined ? 'rg-thesis__rest' : 'rg-thesis__whole'}
          input={input}
        />
      ) : null}
    </>
  );
}

/**
 * The pinned work: its cover, what it is, its title, one highlight, its summary. Its section
 * lists it as a line back up here, so a work with no page of its own says the rest here too:
 * its description, its tools and its links.
 */
function Pin({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const work = model.pinned;
  if (!work) return null;
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: undefined }, 2);
  const cover = placedImage(work.cover ?? work.media?.[0], input);
  const href = workHref(work, input) ?? recordHref(work, input);
  // Named for why it's pinned: the signature, a featured work, or just the first work shown.
  const kind =
    input.portfolio.signature === work.id
      ? 'Signature work'
      : input.portfolio.featured.includes(work.id)
        ? 'Featured work'
        : 'Work';
  const highlight = work.highlights?.find(present);
  const own = workHref(work, input) === undefined;
  // Its summary always, so a work with a page of its own is still said here, under the title
  // that links straight to that page.
  const text = cardText(work, input);
  return (
    <div className="rg-cell rg-pin" id={chromeIds(input.ids.prefix).pin} lang={work.lang}>
      {cover ? (
        <div className="rg-pin__media">
          <MediaFigure
            placed={cover}
            ctx={ctx}
            inline
            eager
            sizes="(min-width: 48rem) 30vw, 100vw"
          />
        </div>
      ) : null}
      <p className="rg-meta">
        <Words lang={model.uiLang}>{kind}</Words>
      </p>
      <p className="rg-pin__title">
        <a href={href}>{work.title}</a>
      </p>
      {highlight ? <p className="rg-pin__fact">{highlight}</p> : null}
      {text !== undefined ? <RichText source={text} className="rg-pin__sum" input={input} /> : null}
      {own ? <Chips items={work.tools} label="Built with" /> : null}
      {own ? (
        <Links
          links={(work.links ?? [])
            .map((link) => ({ url: link.url, text: linkText(link) }))
            .filter((link) => hrefFor(link.url, input) !== href)}
          input={input}
        />
      ) : null}
    </div>
  );
}

export function Opening({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const leads = model.thesis !== undefined && thesisLead(input) !== undefined;
  const name =
    model.hero && present(model.hero.name) ? model.hero.name : input.portfolio.identity.name;
  const poster = model.hero
    ? renderSection(
        model.hero,
        input,
        {
          renderers: {
            hero: (props) => (
              <PosterBody
                {...props}
                stickers={model.stickers}
                uiLang={model.uiLang}
                heading={!leads}
              />
            ),
          },
          Frame: cellFrame(model.stickers.length > 0 ? 'rg-poster rg-poster--stuck' : 'rg-poster'),
        },
        { level: 1 },
      )
    : null;
  const thesis = model.thesis
    ? renderSection(
        model.thesis,
        input,
        {
          renderers: { practice: (props) => <ThesisBody {...props} name={name} /> },
          Frame: cellFrame('rg-thesis'),
        },
        { level: 2 },
      )
    : null;
  return (
    <div
      className="rg-field rg-opening"
      data-thesis={thesis ? undefined : 'none'}
      data-pin={model.pinned ? undefined : 'none'}
    >
      {poster ?? (
        <div className="rg-cell rg-poster">
          {leads ? <p className="rg-name">{name}</p> : <h1 className="rg-name">{name}</h1>}
        </div>
      )}
      {thesis}
      <Pin input={input} model={model} />
    </div>
  );
}
