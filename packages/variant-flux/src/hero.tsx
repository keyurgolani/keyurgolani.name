import type { CSSProperties } from 'react';
import type { Section, Work } from '@portfolio/schema';
import {
  anchorSection,
  hrefFor,
  recordAnchor,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { Field } from './field/field';
import { Pool } from './field/pool';
import {
  controlsOf,
  hasCaseStudy,
  heroOf,
  openingOf,
  plateOf,
  present,
  proofLine,
  thesisSectionOf,
} from './model';
import {
  Img,
  ownId,
  Out,
  Phrase,
  readyImage,
  Tracks,
  uiLang,
  When,
  WorkLinks,
  Words,
} from './parts';

// The first view (brief §5.10, step 5; FX-M2, FX-M6, FX-S6, FX-S7). Full
// bleed, the field behind it all. At the top, the two-line h1: the greeting
// with the name, then the key phrase, the thesis's first sentence, in the
// accent-to-secondary gradient; one accessible string, with an explicit
// space between the lines. Under it the one positioning line, the one call
// to action and the one line of proof. The signature work sits whole in
// its liquid drop on the third ink's pool: the plate, never a rectangle
// beside the headline (N8). Source order is reading order: the words, the
// call to action, the plate, then the proof line, so a phone reaches the
// plate in its first screen; on wide screens the grid lays the proof into
// the opening's foot.

/** The h1's id: the opening's own, so the name in the tab bar and the Index land on it. */
export const openingHeading = (input: Pick<VariantRenderInput, 'ids'>) =>
  ownId(input.ids.prefix, 'opening');

/** The plate's id: the one place the signature work shows, which a sheet links back to (N6). */
export const plateId = (input: Pick<VariantRenderInput, 'ids'>) => ownId(input.ids.prefix, 'plate');

/** The plate title's id: the signature's record anchor, where a section lists it, else the plate's. */
export function plateTitleId(work: Pick<Work, 'id'>, input: VariantRenderInput): string {
  const listed = anchorSection(work, input);
  return (listed ? recordAnchor(listed, work, input) : undefined) ?? `${plateId(input)}--h`;
}

/** A work's own page. */
export const caseHref = (input: VariantRenderInput) => (work: { slug: string }) =>
  routeHref(input, { route: 'work', slug: work.slug });

/**
 * The key phrase's words, each a solid colour along the accent-to-secondary pour (FX-M6), from the
 * first word's to the last's: a real text colour every word, which its ground is measured against,
 * never a gradient clipped to the glyphs. The text is the same, in spans.
 */
function KeyWords({ text }: { text: string }) {
  const parts = text.split(/(\s+)/u);
  // Each part's place among the words: a running count, a space keeping the word before's.
  const order = parts.reduce<number[]>(
    (acc, part) => [...acc, (acc.at(-1) ?? -1) + (part.trim() === '' ? 0 : 1)],
    [],
  );
  const words = (order.at(-1) ?? -1) + 1;
  return (
    <>
      {parts.map((part, index) => {
        if (part.trim() === '') return part;
        const share = words > 1 ? order[index]! / (words - 1) : 0;
        return (
          <span
            key={index}
            className="fx-h1__word"
            style={{ '--layout-fx-at': Math.round(share * 1000) / 1000 } as CSSProperties}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

function Headline({ input }: { input: VariantRenderInput }) {
  const opening = openingOf(input);
  const { greeting, key } = opening;
  return (
    <h1 className="fx-h1" id={openingHeading(input)}>
      {greeting ? (
        <>
          <span className="fx-h1__hello" data-type-role="display">
            {greeting.words ? (greeting.name ? `${greeting.words} ` : greeting.words) : null}
            {greeting.name ? (
              <>
                <bdi>{greeting.name}</bdi>
                {greeting.stop}
              </>
            ) : null}
          </span>{' '}
        </>
      ) : null}
      <span className="fx-h1__key" data-type-role="display" data-length={key.length}>
        <KeyWords text={key.text} />
      </span>
    </h1>
  );
}

function Plate({ input, pool }: { input: VariantRenderInput; pool: boolean }) {
  const plate = plateOf(input, caseHref(input));
  if (!plate) {
    // No signature work: the pool keeps its own crest where the plate would stand (FX-S38).
    return pool ? (
      <div className="fx-plate fx-plate--bare" aria-hidden="true">
        <Pool bare />
      </div>
    ) : null;
  }
  const lang = uiLang(input.portfolio.locale);
  const { work } = plate;
  const placed = plate.media ? readyImage(plate.media, input) : undefined;
  const summary = work.summary ?? work.description;
  // The record's anchor is the plate's title (its sheet lists it no second time), so a link to
  // the work lands here: the caption is no box on a phone, the title always is.
  const titleId = plateTitleId(work, input);
  // Who made it and where it ran, one caption line: the role, then the organization or publication.
  const meta = [
    work.role,
    work.organization,
    work.publication,
    work.artist,
    work.label,
    work.series,
    ...(work.tools ?? []),
  ].filter(present);
  return (
    <section
      className="fx-plate"
      id={plateId(input)}
      aria-labelledby={titleId}
      lang={work.lang}
      data-cover={placed ? (plate.fit ?? 'contain') : 'none'}
    >
      <div className="fx-plate__stage">
        <div className="fx-drop">
          {placed ? (
            <Img
              placed={placed}
              input={input}
              sizes="(min-width: 64rem) 34vw, 80vw"
              eager
              className="fx-drop__img"
            />
          ) : (
            <p className="fx-drop__type" data-type-role="headline" aria-hidden="true">
              {work.title}
            </p>
          )}
        </div>
        {pool ? <Pool /> : null}
      </div>
      <div className="fx-plate__caption">
        <p className="fx-plate__kicker" data-type-role="body-compact">
          <Words lang={lang}>{plate.since ? 'Signature work, since ' : 'Signature work'}</Words>
          {plate.since ? <When raw={work.period?.start} lang={lang} /> : null}
        </p>
        <h2 className="fx-plate__title" id={titleId} data-type-role="title">
          {plate.link ? (
            <a href={plate.link.href}>
              {work.title}
              <Out href={plate.link.href} />
            </a>
          ) : (
            work.title
          )}
        </h2>
        {summary ? (
          <p className="fx-plate__sum" data-type-role="body-compact">
            <Phrase source={summary} input={input} />
          </p>
        ) : null}
        {/* Its credits only when it has no page of its own, which carries them otherwise (F4). */}
        {meta.length > 0 && !hasCaseStudy(work) ? (
          <p className="fx-plate__meta" data-type-role="caption">
            {[...new Set(meta)].join(', ')}
          </p>
        ) : null}
        {/* A release with no page of its own lists its tracks here, the one place it shows. */}
        {hasCaseStudy(work) ? null : <Tracks work={work} input={input} />}
        <WorkLinks work={work} input={input} />
      </div>
    </section>
  );
}

function Proof({ input }: { input: VariantRenderInput }) {
  const items = proofLine(input);
  if (items.length === 0) return null;
  return (
    <ul className="fx-proof" aria-label="In short" data-type-role="body-compact">
      {items.map((item) => (
        <li key={item.id}>
          {item.figure ? (
            <>
              <strong className="fx-num">{item.figure}</strong>{' '}
            </>
          ) : null}
          {item.words}
        </li>
      ))}
    </ul>
  );
}

/** The opening: the field, the h1, the positioning line, the call to action, the plate and the proof. */
export function Opening({ input }: { input: VariantRenderInput }) {
  const opening = openingOf(input);
  const { blobs } = controlsOf(input);
  const cta = opening.cta;
  // The hero's own title and subtitle, when the owner gave them, label the opening's foot.
  const hero = heroOf(input);
  const label = hero?.title?.trim() || undefined;
  const subtitle = hero?.subtitle?.trim() || undefined;
  const href = cta ? hrefFor(cta.url, input) : undefined;
  const now = opening.now && !thesisSectionOf(input) ? opening.now : undefined;
  return (
    <div className="fx-opening" data-fx-inks={blobs}>
      <Field prefix={input.ids.prefix} inks={blobs !== 'off'} />
      <div className="fx-opening__words">
        <Headline input={input} />
        {opening.positioning || now ? (
          <p className="fx-lede" data-type-role="title">
            {opening.positioning ? <Phrase source={opening.positioning} input={input} /> : null}
            {/* With no thesis section the now line closes the positioning line; else the thesis frame sets it. */}
            {now ? (
              <span className="fx-lede__now" data-type-role="body">
                <Phrase source={now} input={input} />
              </span>
            ) : null}
          </p>
        ) : null}
        {cta && href ? (
          <p className="fx-cta">
            <a className="fx-btn" href={href} data-type-role="label">
              {cta.label}
              <Out href={href} />
            </a>
          </p>
        ) : null}
      </div>
      <Plate input={input} pool={blobs === '3'} />
      {label || subtitle ? (
        <p className="fx-opening__label" data-type-role="label">
          {label ? <span>{label}</span> : null}
          {subtitle ? (
            <span className="fx-opening__sub">
              <Phrase source={subtitle} input={input} />
            </span>
          ) : null}
        </p>
      ) : null}
      <Proof input={input} />
    </div>
  );
}

/** The hero section's renderer: the opening, inside the hero's frame. */
export function HeroRenderer({
  section,
  input,
}: SectionRendererProps<Extract<Section, { kind: 'hero' }>>) {
  // The first hero is the opening; a later one (rare) shows its own words.
  const first = input.portfolio.sections.find((each) => each.kind === 'hero');
  if (first?.id === section.id) return <Opening input={input} />;
  return (
    <div className="fx-prose">
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
