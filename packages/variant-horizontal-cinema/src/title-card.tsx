import type { ReactNode } from 'react';
import type { Hero } from '@portfolio/schema';
import { Action } from '@portfolio/appearance/primitives';
import {
  chronologyOf,
  Heading,
  hrefFor,
  present,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { uiLang, Words } from './parts';

// The title card (redesign, scene 1): the hero as the film's opening
// frame. Under the scene's own top bar, the picture holds the name set to
// fill the measure at its optical centre, the dossier's one display
// exception (T3), with four credits on its corners; the first call to
// action is the one start action, on the lower credit line, and any other
// reads quietly beside it. The lower matte runs the tagline and the
// subtagline as subtitles. The frame and its bars are the scene's
// (scene.tsx); this is the hero's own content.

/** The role the portfolio's chronology says is current: the first entry with no end, else none. */
export function currentRole(input: VariantRenderInput): string | undefined {
  const entries = input.portfolio.sections.flatMap((section) => chronologyOf(section, input));
  const current = entries.find((entry) => entry.kind === 'role' && entry.period?.end === undefined);
  return current?.title;
}

/** Two credits, one at each end of a row: a row with neither is left out. */
function Credits({ start, end }: { start?: string; end?: string }) {
  if (!present(start) && !present(end)) return null;
  return (
    <p className="hc-card__credits" data-type-role="label">
      <span>{start}</span>
      <span>{end}</span>
    </p>
  );
}

export function TitleCard({ section, input, level }: SectionRendererProps<Hero>) {
  const { identity } = input.portfolio;
  const name = present(section.name) ? section.name : identity.name;
  // The identity's tagline is a corner credit when the hero has a tagline of its own.
  const tagline = present(section.tagline) ? section.tagline : identity.tagline;
  const credit = present(section.tagline) ? identity.tagline : undefined;
  // The hero's own actions, as the concept pairs them: the first the start action, the next beside it.
  const ctas = section.ctas ?? [];
  // An action to the portfolio's résumé keeps the owner's own label ("Download CV"), only accented
  // where it's the bare word, so "Resume" isn't read as playback; with no label it's the credits' word.
  const resume = new Set(
    [...input.portfolio.links, ...(input.portfolio.contact?.links ?? [])]
      .filter((link) => link.platform === 'resume')
      .map((link) => link.url),
  );
  const lang = uiLang(input.portfolio.locale);
  const labelOf = (link: (typeof ctas)[number]): ReactNode => {
    const own = present(link.label) ? link.label.trim() : undefined;
    if (!resume.has(link.url)) return own ?? link.url;
    if (own && own.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() !== 'resume') return own;
    return <Words lang={own ? undefined : lang}>Résumé</Words>;
  };
  return (
    <>
      <div className="hc-card">
        {/* The hero's own title is its label, the first credit; the identity's tagline then reads at the foot. */}
        <Credits start={present(section.title) ? section.title : credit} end={identity.location} />
        <Heading level={level} className="hc-card__name">
          {name}
        </Heading>
        <div className="hc-card__foot" data-type-role="label">
          <span>
            {[present(section.title) ? credit : undefined, identity.pronouns]
              .filter(present)
              .join(', ')}
          </span>
          {ctas.length > 0 ? (
            <ul className="hc-card__actions" role="list">
              {ctas.map((link, index) => (
                <li key={index}>
                  <Action
                    href={hrefFor(link.url, input)}
                    emphasis={index === 0 ? 'primary' : 'secondary'}
                  >
                    {labelOf(link)}
                  </Action>
                </li>
              ))}
            </ul>
          ) : null}
          <span>{currentRole(input)}</span>
        </div>
      </div>
      {present(tagline) || present(section.subtagline) ? (
        <div className="hc-card__subtitles">
          {present(tagline) ? (
            <p className="hc-card__tagline" data-type-role="title">
              {tagline}
            </p>
          ) : null}
          {present(section.subtagline) ? (
            <p className="hc-card__subtagline" data-type-role="body">
              {section.subtagline}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
