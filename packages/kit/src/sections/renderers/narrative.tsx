import type { Hero, Lede, Now } from '@portfolio/schema';
import { Heading, LabeledDate, LinkText, Meta, renderContext, SectionHeader } from '../primitives';
import { RichText } from '../rich-text';
import type { SectionRendererProps } from '../types';

/**
 * The opening. Its heading is the name, at the level the caller gives, which
 * is 1 when the hero carries the page's h1. A title is a label above it.
 */
export function HeroSection({ section, input, level }: SectionRendererProps<Hero>) {
  const ctx = renderContext(input, section, level);
  const { identity } = input.portfolio;
  const tagline = section.tagline ?? identity.tagline;
  return (
    <div className="pf-hero">
      {section.title !== undefined ? <p className="pf-hero__label">{section.title}</p> : null}
      {section.greeting !== undefined ? (
        <p className="pf-hero__greeting">{section.greeting}</p>
      ) : null}
      <Heading level={level} className="pf-hero__name">
        {section.name ?? identity.name}
      </Heading>
      {section.subtitle !== undefined ? (
        <p className="pf-section__subtitle">{section.subtitle}</p>
      ) : null}
      {tagline !== undefined ? <p className="pf-hero__tagline">{tagline}</p> : null}
      {section.subtagline !== undefined ? (
        <p className="pf-hero__subtagline">{section.subtagline}</p>
      ) : null}
      {section.ctas?.length ? (
        <ul className="pf-actions">
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
      <RichText source={section.body} className="pf-prose" />
    </>
  );
}

export function NowSection({ section, input, level }: SectionRendererProps<Now>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Now" />
      <Meta
        parts={[
          section.asOf !== undefined && (
            <LabeledDate key="as-of" label="As of" raw={section.asOf} ctx={ctx} />
          ),
        ]}
      />
      <RichText source={section.body} className="pf-prose" />
    </>
  );
}
