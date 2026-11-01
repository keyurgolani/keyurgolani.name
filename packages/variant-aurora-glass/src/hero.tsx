import type { ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import { hrefFor, type SectionRendererProps } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Lens } from './lens';
import { controlsOf, heroOf, openingOf, present, proofTiles, signatureSheet } from './model';
import {
  Hidden,
  Img,
  LinkLine,
  ownId,
  Out,
  Phrase,
  readyImage,
  Tracks,
  uiLang,
  When,
  Words,
} from './parts';
import { Pane } from './surfaces/pane';
import { Sheet } from './surfaces/sheet';
import { Shingle } from './surfaces/shingle';

// The first view (brief §5.2, step 6; AG-M1, AG-M2, AG-M4, AG-S3): the
// identity pane shingled under the signature work's raised sheet, the Lens
// in the open sky at the h1's right, and the stat tiles in the pane's lower
// band. The thesis is the display line, inside the one h1, with the name
// above it at title size and the greeting a label-size eyebrow; the rest of
// the thesis is the standfirst, which is the thesis section's own frame.
// Source order is reading order: the pane, then the sheet, then the tiles,
// so a phone's first screen reaches the sheet (AG-M2); on wide screens the
// grid lays the tiles into the pane's foot.

/**
 * The thesis section's frame, which HomePage renders and the opening shows as
 * its standfirst, by render input: a server component can't take a context,
 * and the hero's renderer gets only the section and the input.
 */
const standfirsts = new WeakMap<object, ReactNode>();

/** Hands the opening its standfirst for this render. */
export function setStandfirst(input: VariantRenderInput, element: ReactNode): void {
  standfirsts.set(input, element);
}

/** The h1's id: the opening's own, so the capsule's name and the Index land on it. */
export const openingHeading = (input: Pick<VariantRenderInput, 'ids'>) =>
  ownId(input.ids.prefix, 'opening');

/** The sheet's id: the one place the signature work shows, which a band links back to (N6). */
export const signatureId = (input: Pick<VariantRenderInput, 'ids'>) =>
  ownId(input.ids.prefix, 'signature');

/** A work's own page. */
export const caseHref = (input: VariantRenderInput) => (work: { slug: string }) =>
  routeHref(input, { route: 'work', slug: work.slug });

function Identity({ input, standfirst }: { input: VariantRenderInput; standfirst: ReactNode }) {
  const opening = openingOf(input);
  // The hero's own title, when the owner gave one, heads the meta row.
  const label = heroOf(input)?.title?.trim() || undefined;
  // And its subtitle, the owner's own line under it, beside the tagline.
  const subtitle = heroOf(input)?.subtitle?.trim() || undefined;
  const { meta } = opening;
  const where = [meta.location, meta.pronouns].filter(Boolean) as string[];
  return (
    <Pane frost className="ag-id">
      <div className="ag-id__top">
        {label || meta.tagline || subtitle || where.length > 0 ? (
          <div className="ag-id__meta" data-type-role="label">
            {label ? <p className="ag-id__tagline">{label}</p> : null}
            {meta.tagline ? <p className="ag-id__tagline">{meta.tagline}</p> : null}
            {subtitle ? <p className="ag-id__tagline">{subtitle}</p> : null}
            {where.length > 0 ? (
              <p className="ag-id__where">
                {where.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="ag-id__head">
          {opening.greeting ? (
            <p className="ag-id__greet" data-type-role="label">
              {opening.greeting}
            </p>
          ) : null}
          <h1 className="ag-id__h1" id={openingHeading(input)}>
            {opening.line.source === 'name' ? (
              <span
                className="ag-id__line"
                data-type-role="display"
                data-length={opening.line.length}
              >
                {opening.line.text}
              </span>
            ) : (
              <>
                <span className="ag-id__name" data-type-role="title">
                  {opening.name}
                </span>
                <Hidden>: </Hidden>
                <span
                  className="ag-id__line"
                  data-type-role="display"
                  data-length={opening.line.length}
                >
                  {opening.line.text}
                </span>
              </>
            )}
          </h1>
        </div>
      </div>
      <div className="ag-id__body">
        {standfirst}
        {opening.lede ? (
          <p className="ag-id__lede" data-type-role="body">
            <Phrase source={opening.lede} input={input} />
          </p>
        ) : null}
        {opening.status ? (
          <p className="ag-id__status" data-type-role="body-compact">
            <span className="ag-pip" aria-hidden="true" />
            <Phrase source={opening.status} input={input} />
          </p>
        ) : null}
        {opening.ctas.length > 0 ? (
          <p className="ag-id__acts">
            {opening.ctas.map((cta) => {
              const href = hrefFor(cta.url, input);
              return (
                <a
                  key={`${cta.label}-${cta.url}`}
                  className={cta.primary ? 'ag-btn' : 'ag-link'}
                  href={href}
                  data-type-role="label"
                >
                  {cta.label}
                  <Out href={href} />
                </a>
              );
            })}
          </p>
        ) : null}
      </div>
    </Pane>
  );
}

function SignatureSheet({ input }: { input: VariantRenderInput }) {
  const sheet = signatureSheet(input, caseHref(input));
  if (!sheet) return null;
  const lang = uiLang(input.portfolio.locale);
  const { work } = sheet;
  const placed = sheet.media ? readyImage(sheet.media, input) : undefined;
  const titleId = `${signatureId(input)}--h`;
  const summary = work.summary ?? work.description;
  return (
    <Sheet
      className={placed ? 'ag-sig' : 'ag-sig ag-sig--text'}
      id={signatureId(input)}
      aria-labelledby={titleId}
      lang={work.lang}
    >
      {placed ? (
        <div className="ag-sig__media">
          <Img
            placed={placed}
            input={input}
            sizes="(min-width: 64rem) 32rem, 100vw"
            eager
            className="ag-sig__img"
          />
        </div>
      ) : null}
      <div className="ag-sig__body">
        <p className="ag-sig__kicker" data-type-role="caption">
          <Words lang={lang}>{sheet.since ? 'Signature work, since ' : 'Signature work'}</Words>
          {sheet.since ? <When raw={work.period?.start} lang={lang} /> : null}
        </p>
        <h2 className="ag-sig__title" id={titleId} data-type-role="title">
          {sheet.link ? (
            <a className="ag-stretch" href={sheet.link.href}>
              {work.title}
              <Out href={sheet.link.href} />
            </a>
          ) : (
            work.title
          )}
        </h2>
        {summary ? (
          <p className="ag-sig__sum" data-type-role="body-compact">
            <Phrase source={summary} input={input} />
          </p>
        ) : null}
        {[work.role, work.organization, work.publication, work.artist, work.label].some(present) ? (
          <p className="ag-sig__meta" data-type-role="caption">
            {[work.role, work.organization, work.publication, work.artist, work.label]
              .filter(present)
              .map((part) => (
                <span key={part}>{part}</span>
              ))}
          </p>
        ) : null}
        {/* A release with no page of its own lists its tracks here, over the stretched link (blocker 2). */}
        {!sheet.link?.caseStudy && work.tracks?.length ? (
          <Tracks tracks={work.tracks} input={input} className="ag-tracks ag-sig__tracks" />
        ) : null}
        {/* Its own links by their labels, over the sheet's stretched link; on its page they lead it. */}
        {!sheet.link?.caseStudy ? (
          <LinkLine links={work.links} input={input} className="ag-row__links ag-sig__links" />
        ) : null}
        {sheet.link?.caseStudy ? (
          <p className="ag-sig__cue" data-type-role="label" aria-hidden="true">
            <Words lang={lang}>Read the case study</Words>
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function Tiles({ input }: { input: VariantRenderInput }) {
  const tiles = proofTiles(input);
  if (tiles.length === 0) return null;
  return (
    <ul className="ag-tiles" aria-label="In short" data-count={String(tiles.length)}>
      {tiles.map((tile) => (
        <li key={tile.id} className="ag-pane ag-tile">
          <span className="ag-tile__value ag-num" data-type-role="numeric">
            {tile.value}
          </span>{' '}
          <span className="ag-tile__label" data-type-role="label">
            {tile.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The opening: the shingle of the identity pane and the signature sheet, the tiles and the Lens. */
export function Opening({ input }: { input: VariantRenderInput }) {
  const standfirst = standfirsts.get(input) ?? null;
  const sheet = signatureSheet(input, caseHref(input));
  const { lens } = controlsOf(input);
  const tiles = proofTiles(input).length;
  return (
    <Shingle
      className="ag-opening"
      data-sheet={sheet ? 'yes' : 'no'}
      data-tiles={tiles > 0 ? 'yes' : 'no'}
      data-lens={lens ? 'yes' : 'no'}
    >
      <Identity input={input} standfirst={standfirst} />
      <SignatureSheet input={input} />
      <Tiles input={input} />
      {lens ? <Lens prefix={input.ids.prefix} /> : null}
    </Shingle>
  );
}

/** The hero section's renderer: the opening, inside the hero's frame. */
export function HeroRenderer({
  section,
  input,
}: SectionRendererProps<Extract<Section, { kind: 'hero' }>>) {
  // The first hero is the opening; a later one (rare) shows its own words in a plain pane.
  const first = input.portfolio.sections.find((each) => each.kind === 'hero');
  if (first?.id === section.id) return <Opening input={input} />;
  return (
    <div className="ag-sec__body">
      {section.tagline ? (
        <p data-type-role="title">
          <Phrase source={section.tagline} input={input} />
        </p>
      ) : null}
      {section.subtagline ? (
        <p data-type-role="body">
          <Phrase source={section.subtagline} input={input} />
        </p>
      ) : null}
    </div>
  );
}
