import type { ChronologyEntry } from '@portfolio/schema';
import {
  hrefFor,
  present,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Address, Words } from '../parts';
import type { Env } from '../env';

// The hero, as the issue's byline: the name and tagline on the head line,
// then where the owner works now, where they're based, and how to write to
// them, each cell on a column line, along the bottom of the first view.
// With a thesis, that's all: the standfirst is the opening's one paragraph.
// With none, the h1 says the hero's tagline and its subtagline follows. Its
// greeting and avatar aren't shown: the thesis opens the page, not a hello.

type HeroProps = SectionRendererProps<SectionOf<'hero'>> & { readonly env: Env };

/** The role the owner holds now: the first chronology entry of a role with no end. */
function currentRole(chronology: readonly ChronologyEntry[]): ChronologyEntry | undefined {
  return chronology.find((entry) => entry.kind === 'role' && entry.period && !entry.period.end);
}

/**
 * The byline's ruled facts: where the owner works now, where they're based,
 * and how to write to them. The hero sets them on the first view's bottom
 * band; on one column the opening sets them again before Pl. 1 (C2), and
 * the hero's own are hidden there.
 */
export function BylineFacts({
  section,
  input,
  className = 'ee-byline__facts',
}: {
  section: SectionOf<'hero'>;
  input: SectionRendererProps<SectionOf<'hero'>>['input'];
  className?: string;
}) {
  const { identity, chronology } = input.portfolio;
  const now = currentRole(chronology);
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const ctas = section.ctas ?? [];
  const based = [identity.location, identity.pronouns].filter(present);
  if (!now && based.length === 0 && email === undefined && ctas.length === 0) return null;
  return (
    <dl className={className} data-type-role="body-compact">
      {now ? (
        <div>
          <dt>
            <Words input={input}>Currently</Words>
          </dt>
          <dd lang={now.lang}>
            {now.title}
            {present(now.organization) ? (
              <>
                , <Words input={input}>at</Words> {now.organization}
              </>
            ) : null}
          </dd>
        </div>
      ) : null}
      {based.length > 0 ? (
        <div>
          <dt>
            <Words input={input}>Based in</Words>
          </dt>
          <dd>
            {present(identity.location) ? identity.location : null}
            {present(identity.location) && present(identity.pronouns) ? '. ' : null}
            {present(identity.pronouns) ? (
              <>
                <Words input={input}>Pronouns</Words> {identity.pronouns}
              </>
            ) : null}
          </dd>
        </div>
      ) : null}
      {email !== undefined || ctas.length > 0 ? (
        <div>
          <dt>
            <Words input={input}>Write to</Words>
          </dt>
          <dd>
            <ul className="ee-links" role="list">
              {email !== undefined ? (
                <li>
                  <a href={`mailto:${email}`}>
                    <Address email={email} />
                  </a>
                </li>
              ) : null}
              {ctas.map((link, index) => (
                <li key={index}>
                  <a href={hrefFor(link.url, input)}>
                    {[link.label, link.platform].find(present) ?? link.url}
                  </a>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function HeroBody({ section, input, env }: HeroProps) {
  const { identity } = input.portfolio;
  const name = present(section.name) ? section.name : identity.name;
  const tagline = present(identity.tagline) ? identity.tagline : undefined;
  // With a thesis, the standfirst beside Pl. 1 is the opening's one paragraph (G2): no second
  // intro under the byline. With none, the h1 says the hero's tagline, and its subtagline follows.
  const lede = env.model.thesis ? [] : [section.subtagline].filter(present);
  return (
    <>
      <div className="ee-byline">
        <p className="ee-byline__name">
          <b data-type-role="title">{name}</b>
          {tagline ? <span>{tagline}</span> : null}
        </p>
        <BylineFacts section={section} input={input} />
      </div>
      {lede.length > 0 ? (
        <div className="ee-byline__lede" data-type-role="quote">
          {lede.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}
