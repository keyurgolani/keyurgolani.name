import type { CSSProperties } from 'react';
import {
  hrefFor,
  present,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { titleOf } from '../frame';
import { nameLines, recordHref, type Sticker } from '../model';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Out, Words } from '../parts';

// The poster: the hero as a pasted-up bill on the prominent ground. The
// owner's tagline and pronouns and place at its head; the name stacked a
// word a line, fitted to the poster's width (--layout-name-chars); the
// hero's tagline as a label pasted on, its status under a rule; the hero's
// own actions as block buttons, each item the block and its link a ring's
// reach inside it, the first on the accent surface, so a focus ring lies on
// the block's own ground (on-accent on the accent), never on the shadow it
// casts on the poster; and, in their own column, up to three
// stickers, facts from records on the page, each linking to its record.
// Source order is the reading order at every width: the left column, then
// the stickers, so on a phone they sit in one row after the actions. A
// titled hero hangs its title from the poster's corner as tape, the label
// its frame names the region by; the name stays the page's one h1.

export function PosterBody({
  section,
  input,
  level,
  stickers,
  uiLang,
  heading = true,
}: SectionRendererProps<SectionOf<'hero'>> & {
  readonly stickers: readonly Sticker[];
  readonly uiLang: 'en' | undefined;
  /** False when the thesis is the page's h1: the name is then display type, a <p>. */
  readonly heading?: boolean;
}) {
  // The opening's hero is the page's h1 unless the thesis is; any other sits at its band's level.
  const Tag = heading ? (`h${level}` as const) : 'p';
  const { identity } = input.portfolio;
  const name = present(section.name) ? section.name : identity.name;
  const { lines, longest } = nameLines(name);
  const meta = [identity.pronouns, identity.location].filter(present);
  const ctas = section.ctas ?? [];
  // In the opening the tape shows the title; in a band its head already does, under the one id.
  const title = level === 1 ? titleOf(section) : undefined;
  // In a band the head shows the subtitle under the tape; in the opening the poster does.
  const subtitle = level === 1 && present(section.subtitle) ? section.subtitle : undefined;
  return (
    <>
      {present(identity.tagline) || meta.length > 0 || title !== undefined || subtitle ? (
        <div className="rg-poster__top">
          {title !== undefined ? (
            <p className="rg-tab rg-poster__tab">
              <span id={`${input.ids.prefix}${section.id}--head`}>{title}</span>
            </p>
          ) : null}
          {/* A label line under the tape, as the band heads set theirs (T1's four sizes). */}
          {subtitle ? <p className="rg-meta">{subtitle}</p> : null}
          {present(identity.tagline) ? <p className="rg-poster__role">{identity.tagline}</p> : null}
          {meta.length > 0 ? (
            <p className="rg-meta" data-parts="">
              {meta.map((part, index) => (
                <span key={index}>{part}</span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
      <Tag className="rg-name" style={{ '--layout-name-chars': longest } as CSSProperties}>
        {lines.map((line, index) => (
          <span key={index} className="rg-name__line">
            {line}
            {index < lines.length - 1 ? ' ' : null}
          </span>
        ))}
      </Tag>
      {present(section.tagline) || present(section.subtagline) ? (
        <div className="rg-paste">
          {present(section.tagline) ? <p className="rg-paste__lede">{section.tagline}</p> : null}
          {present(section.subtagline) ? (
            <p className="rg-paste__status">{section.subtagline}</p>
          ) : null}
        </div>
      ) : null}
      {ctas.length > 0 ? (
        <ul className="rg-actions" role="list">
          {ctas.map((cta, index) => (
            <li key={index} className="rg-act" data-ui-surface={index === 0 ? 'accent' : undefined}>
              <Out className="rg-go rg-btn" href={hrefFor(cta.url, input)}>
                {cta.label}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
      <Stickers stickers={stickers} input={input} uiLang={uiLang} />
    </>
  );
}

/** The stickers: facts pinned at a tilt, each linking to its record on the page, the first in ink. */
export function Stickers({
  stickers,
  input,
  uiLang,
}: {
  readonly stickers: readonly Sticker[];
  readonly input: VariantRenderInput;
  readonly uiLang: 'en' | undefined;
}) {
  if (stickers.length === 0) return null;
  return (
    <ul className="rg-stickers" role="list">
      {stickers.map((sticker) => (
        <li
          key={sticker.id}
          className="rg-sticker"
          data-tone={sticker.tone}
          // The first sticker is ink: K-2's inverse pair gives its link a ring that shows.
          data-ui-surface={sticker.tone === 'emphasis' ? 'inverse' : undefined}
          lang={sticker.lang}
        >
          <a href={recordHref(sticker, input)}>
            {/* The kit's own words (WRITTEN UP IN) keep one line; the venue takes the next. */}
            <span className="rg-sticker__line" data-kit={sticker.own === 'line' ? '' : undefined}>
              {sticker.own === 'line' ? <Words lang={uiLang}>{sticker.line}</Words> : sticker.line}
            </span>
            {present(sticker.sub) ? <span className="rg-sticker__sub">{sticker.sub}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
