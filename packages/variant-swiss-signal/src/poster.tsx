import type { Section } from '@portfolio/schema';
import { hrefFor, type SectionRendererProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { CSSProperties } from 'react';
import {
  asideFit,
  heroOf,
  ownerName,
  posterLede,
  posterLine,
  present,
  wordClass,
  wordFit,
} from './model';
import { Hidden, ownId, Paren, Phrase } from './parts';
import { SelectedIndex } from './selected-index';

// The poster (brief §5.1, component 3): the thesis at the 6rem ceiling in
// uppercase, the aside in the quote role at the end of its last line, a
// 1.5 px rule, then the lede, the positioning line and one call to action
// on the left and the selected index, the proof, on the right. Imageless
// (S3): the index's thumbnails are the only pictures in the first view.

type Hero = Extract<Section, { kind: 'hero' }>;

/** The id of the poster's h1, which its section is labelled by. */
export const posterHeading = (input: VariantRenderInput) => ownId(input.ids.prefix, 'poster');

/** The poster's body: the h1 and everything under its rule. */
export function Poster({ input }: { input: VariantRenderInput }) {
  const line = posterLine(input);
  const { lede, subtitle, position } = posterLede(input);
  const own = ownerName(input);
  const heroName =
    own !== input.portfolio.identity.name.replace(/\s+/g, ' ').trim() ? own : undefined;
  const hero = heroOf(input);
  const ctas = (hero?.ctas ?? []).filter((cta) => present(cta.label));
  const [first, ...rest] = ctas;
  return (
    <div className="ss-grid ss-poster__grid">
      <h1
        className="ss-poster__line"
        id={posterHeading(input)}
        data-length={line.length}
        data-word={line.length === 'long' ? undefined : wordClass(line.text)}
        style={line.length !== 'long' ? (wordFit(line.text) as CSSProperties) : undefined}
      >
        {/* SS-M5: the name leads the h1 for the outline and search, visible in the masthead. */}
        {/* The hero's own name, where it gives one other than the identity's (which the
            masthead sets), is the poster's first line; else the name leads the h1 unseen. */}
        {line.namePrefix && heroName ? (
          <>
            <span className="ss-poster__name" data-type-role="title">
              {heroName}
            </span>
            <Hidden>{': '}</Hidden>
          </>
        ) : line.namePrefix ? (
          <Hidden>{`${input.portfolio.identity.name}: `}</Hidden>
        ) : null}
        <span className="ss-poster__text" data-type-role="display">
          {line.text}
        </span>
        {line.aside ? (
          <>
            {' '}
            <Paren
              signal
              className="ss-poster__aside"
              style={asideFit(line.aside.text) as CSSProperties}
            >
              {line.aside.text}
            </Paren>
            {line.tail ? <span data-type-role="display">{line.tail}</span> : null}
          </>
        ) : null}
      </h1>
      <div className="ss-poster__left">
        {lede ? (
          <p className="ss-poster__lede" data-type-role="quote">
            <Phrase source={lede} input={input} />
          </p>
        ) : null}
        {subtitle ? (
          <p className="ss-poster__position" data-type-role="body">
            <Phrase source={subtitle} input={input} />
          </p>
        ) : null}
        {position ? (
          <p className="ss-poster__position" data-type-role="body">
            <Phrase source={position} input={input} />
          </p>
        ) : null}
        {first ? (
          <p className="ss-poster__ctas">
            <a className="ss-cta" href={hrefFor(first.url, input)} data-type-role="title">
              {first.label}
            </a>
            {rest.map((cta) => (
              <a key={cta.url} href={hrefFor(cta.url, input)} data-type-role="body">
                {cta.label}
              </a>
            ))}
          </p>
        ) : null}
      </div>
      <SelectedIndex input={input} />
    </div>
  );
}

/** The hero's renderer: the poster. */
export function HeroRenderer({ input }: SectionRendererProps<Hero>) {
  return <Poster input={input} />;
}
