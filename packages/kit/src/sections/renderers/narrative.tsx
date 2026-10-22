import type { Hero, Lede, Now } from '@portfolio/schema';
import { MediaFigure, placedMedia } from '../media';
import {
  Heading,
  LabeledDate,
  LinkText,
  Meta,
  present,
  renderContext,
  SectionHeader,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';


/**
 * The opening. Its heading is the name, at the level the caller gives, which
 * is 1 when the hero carries the page's h1. A title is a label above it. The
 * identity's name and tagline show unless the hero has its own, and its
 * avatar, pronouns, and location always do.
 */
export function HeroSection({ section, input, level }: SectionRendererProps<Hero>) {
  const ctx = renderContext(input, section, level);
  const { identity } = input.portfolio;
  const name = present(section.name) ? section.name : identity.name;
  const tagline = present(section.tagline) ? section.tagline : identity.tagline;
  const avatar = placedMedia(identity.avatar, ctx);
  return (
    <div className="pf-hero">
      {present(section.title) ? <p className="pf-hero__label">{section.title}</p> : null}
      {present(section.greeting) ? <p className="pf-hero__greeting">{section.greeting}</p> : null}
      {avatar ? (
        <MediaFigure placed={avatar} ctx={ctx} className="pf-avatar" sizes="3rem" inline />
      ) : null}
      <Heading level={level} className="pf-hero__name">
        {name}
      </Heading>
      {present(section.subtitle) ? (
        <p className="pf-section__subtitle">{section.subtitle}</p>
      ) : null}
      {present(tagline) ? <p className="pf-hero__tagline">{tagline}</p> : null}
      {present(section.subtagline) ? (
        <p className="pf-hero__subtagline">{section.subtagline}</p>
      ) : null}
      <Meta parts={[identity.pronouns, identity.location]} className="pf-hero__details" />
      {section.ctas?.length ? (
        <ul className="pf-actions" role="list">
          {section.ctas.map((link, index) => (
            <li key={index}>
              <LinkText link={link} ctx={ctx} className="pf-action" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A lede continues the opening, so it has no heading unless it has a title. */
export function LedeSection({ section, input, level }: SectionRendererProps<Lede>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <RichText source={section.body} className="pf-prose" input={input} />
    </>
  );
}

/** What the owner is doing now, as of the date they give. */
export function NowSection({ section, input, level }: SectionRendererProps<Now>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <Meta
        parts={[
          section.asOf !== undefined && (
            <LabeledDate key="as-of" label="As of" raw={section.asOf} ctx={ctx} />
          ),
        ]}
      />
      <RichText source={section.body} className="pf-prose" input={input} />
    </>
  );
}
