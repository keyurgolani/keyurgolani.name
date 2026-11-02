import type { ReactNode } from 'react';
import type { Link } from '@portfolio/schema';
import {
  DateText,
  deeper,
  Heading,
  present,
  renderContext,
  renderSection,
  RichText,
  sectionRenders,
  type SectionFrameProps,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { overviewOf, splitThesis, statementClass } from '../model';
import { Button, Dot, formatAddress, handleOf, linkWords, Out, TileHead } from '../parts';

// The identity tiles: the hero plate, which carries the practice thesis as
// its display line, the About prose, the dated Now note, the focus list,
// the facts, the pull quote, the contact ledger, and the call to action.

/** The sections that render, in reading order. */
const rendering = (input: VariantRenderInput) =>
  input.portfolio.sections.filter((section) => sectionRenders(section, input));

/** The thesis inside the hero's plate: a frame with no chrome of its own. */
function ThesisFrame({ frame, children }: SectionFrameProps) {
  return (
    <section {...frame} className="sb-hero__thesis">
      {children}
    </section>
  );
}

/** The thesis as the hero sets it: its first sentence at display size, and the rest as the lede. */
function HeroThesis({ section, input, level }: SectionRendererProps<SectionOf<'practice'>>) {
  const thesis = input.portfolio.practice?.thesis;
  if (section.part !== 'thesis' || !present(thesis)) return null;
  const { display, rest } = splitThesis(thesis);
  return (
    <>
      {present(section.title) ? (
        <Heading level={level} className="sb-hidden">
          {section.title}
        </Heading>
      ) : null}
      {display !== undefined ? <p className="sb-hero__display">{display}</p> : null}
      {rest !== undefined ? (
        <RichText
          source={rest}
          input={input}
          className={display !== undefined ? 'sb-hero__lede' : 'sb-hero__standfirst'}
        />
      ) : null}
    </>
  );
}

/** The thesis as the hero's plate sets it: its renderer and frame, for renderSection(). */
export const IN_HERO = { renderers: { practice: HeroThesis }, Frame: ThesisFrame } as const;

export function Hero({ section, input, level }: SectionRendererProps<SectionOf<'hero'>>) {
  const ctx = renderContext(input, section, level);
  const { identity } = input.portfolio;
  const sections = rendering(input);
  const overview = overviewOf(sections, input);
  const leads = overview.hero?.id === section.id;
  const thesis = leads ? overview.thesis : undefined;
  const lede = sections.some((each) => each.kind === 'lede');
  const name = present(section.name) ? section.name : identity.name;
  // The hero's own tagline is its lede, unless the thesis took that place
  // and an About tile is there to open with it.
  const tagline = present(section.tagline) && !(thesis && lede) ? section.tagline : undefined;
  // With no thesis and no tagline of its own, the identity's tagline is the plate's display line
  // (thesis first): the first view leads with a statement, never the name alone.
  const statement =
    leads && !thesis && tagline === undefined && present(identity.tagline)
      ? identity.tagline
      : undefined;
  const ctas = section.ctas ?? [];
  return (
    <>
      <div className="sb-hero__head">
        <Heading
          level={level}
          className={
            leads && !thesis && tagline === undefined && statement === undefined
              ? `sb-hero__name ${statementClass(name)}`
              : 'sb-hero__name'
          }
        >
          {name}
        </Heading>
        {leads && present(identity.tagline) && statement === undefined ? (
          <p className="sb-hero__role">{identity.tagline}</p>
        ) : null}
        {leads && present(identity.pronouns) ? (
          <p className="sb-hero__pronouns">{identity.pronouns}</p>
        ) : null}
        {present(section.title) ? <p className="sb-hero__pronouns">{section.title}</p> : null}
      </div>
      <div className="sb-hero__body">
        {thesis ? renderSection(thesis, input, IN_HERO, { level: deeper(level) }) : null}
        {tagline !== undefined ? (
          <p className={thesis ? 'sb-hero__lede' : statementClass(tagline)}>{tagline}</p>
        ) : null}
        {statement !== undefined ? <p className={statementClass(statement)}>{statement}</p> : null}
        {present(section.subtagline) ? <p className="sb-hero__now">{section.subtagline}</p> : null}
      </div>
      {ctas.length > 0 ? (
        <div className="sb-hero__foot">
          <ul className="sb-hero__actions" role="list">
            {ctas.map((cta, index) => (
              <li key={index}>
                <Button url={cta.url} ctx={ctx} tone={index === 0 ? 'strong' : 'ghost'}>
                  {cta.label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** The thesis anywhere but the hero: the practice's one paragraph, set as a standfirst. */
export function ThesisTile({ section, input, level }: SectionRendererProps<SectionOf<'practice'>>) {
  const thesis = input.portfolio.practice?.thesis;
  if (!present(thesis)) return null;
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <RichText source={thesis} input={input} className="sb-standfirst" />
    </>
  );
}

/** The About prose: the owner's words, opening with the hero's tagline when the thesis took its place. */
export function Lede({ section, input, level }: SectionRendererProps<SectionOf<'lede'>>) {
  const sections = rendering(input);
  const overview = overviewOf(sections, input);
  const first = sections.find((each) => each.kind === 'lede')?.id === section.id;
  const hero = overview.hero?.kind === 'hero' ? overview.hero : undefined;
  const standfirst =
    first && overview.thesis && hero && present(hero.tagline) ? hero.tagline : undefined;
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      {standfirst !== undefined ? <p className="sb-standfirst">{standfirst}</p> : null}
      <RichText source={section.body} input={input} className="sb-prose" />
    </>
  );
}

/**
 * The Now note: dated, with a live dot. `lead` sets under its head, before
 * its words: on home, the hero's standfirst and now line for a phone (E1).
 */
export function Now({
  section,
  input,
  level,
  lead,
}: SectionRendererProps<SectionOf<'now'>> & { readonly lead?: ReactNode }) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <TileHead
        title={section.title}
        subtitle={section.subtitle}
        level={level}
        aside={
          section.asOf !== undefined ? (
            <p className="sb-now__when">
              <Dot />
              <DateText raw={section.asOf} ctx={ctx} />
            </p>
          ) : undefined
        }
      />
      {lead}
      <RichText source={section.body} input={input} className="sb-now__body" />
    </>
  );
}

/** What the author is putting energy into: a short ruled list, each item at title size. */
export function Focus({ section, level }: SectionRendererProps<SectionOf<'focus'>>) {
  const items = section.items.filter(present);
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <ul className="sb-focus" role="list">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/** Playful facts, each with a ring for a bullet. */
export function FunFacts({ section, level }: SectionRendererProps<SectionOf<'fun-facts'>>) {
  const items = section.items.filter(present);
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <ul className="sb-rings" role="list">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/** A pull quote at board size, with whoever said it and where. */
export function Quote({ section, input, level }: SectionRendererProps<SectionOf<'quote'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      <figure className="sb-pull">
        <blockquote>
          <p>
            {'“'}
            {section.text}
            {'”'}
          </p>
        </blockquote>
        {present(section.attribution) || present(section.source) ? (
          <figcaption>
            {present(section.attribution) ? (
              <span className="sb-pull__who">{section.attribution}</span>
            ) : null}
            {present(section.attribution) && present(section.source) ? ' ' : null}
            {present(section.source) ? (
              <cite>
                {present(section.sourceUrl) ? (
                  <Out url={section.sourceUrl} ctx={ctx}>
                    {section.source}
                  </Out>
                ) : (
                  section.source
                )}
              </cite>
            ) : null}
          </figcaption>
        ) : null}
      </figure>
    </>
  );
}

/**
 * The ways to get in touch, as the contact section lists them: the
 * identity's email, unless a link already points at it, then the contact
 * record's links, else the portfolio's.
 */
export function contactLinks(input: VariantRenderInput): readonly Link[] {
  const { identity, links: portfolioLinks, contact } = input.portfolio;
  const links = contact?.links?.length ? contact.links : portfolioLinks;
  const email = present(identity.email) ? identity.email.trim() : undefined;
  const mailto = email !== undefined ? `mailto:${email}` : undefined;
  return mailto !== undefined &&
    !links.some((link) => link.url.toLowerCase() === mailto.toLowerCase())
    ? [{ platform: 'email', url: mailto, label: email }, ...links]
    : links;
}

/** The contact ledger: the message, the email at title size, and a ruled row a link. */
export function Contact({ section, input, level }: SectionRendererProps<SectionOf<'contact'>>) {
  const ctx = renderContext(input, section, level);
  const message = input.portfolio.contact?.message;
  const links = contactLinks(input);
  const [first, ...rest] = links;
  const lead = first?.url.startsWith('mailto:') ? first : undefined;
  const ledger = lead ? rest : links;
  return (
    <>
      <TileHead title={section.title} subtitle={section.subtitle} level={level} />
      {present(message) ? <p className="sb-contact__message">{message}</p> : null}
      {lead ? (
        <p className="sb-contact__mail">
          <Out url={lead.url} ctx={ctx}>
            {formatAddress(lead.url)}
          </Out>
        </p>
      ) : null}
      {ledger.length > 0 ? (
        <ul className="sb-contact__links" role="list">
          {ledger.map((link, index) => {
            const words = linkWords(link);
            const handle = handleOf(link.url);
            return (
              <li key={index}>
                <Out url={link.url} ctx={ctx}>
                  <span className="sb-contact__name">{words}</span>
                  {/* The handle, unless it says what the name already does. */}
                  {handle.toLowerCase() !== words.toLowerCase() ? (
                    <span className="sb-contact__where">{handle}</span>
                  ) : null}
                </Out>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

/** The call to action: a poster on the accent, its title at board size and its two actions. */
export function Cta({ section, input, level }: SectionRendererProps<SectionOf<'cta'>>) {
  const ctx = renderContext(input, section, level);
  const actions = [section.primaryAction, section.secondaryAction].flatMap((action) =>
    action ? [action] : [],
  );
  return (
    <>
      {present(section.title) ? (
        <Heading level={level} className="sb-poster__title">
          {section.title}
        </Heading>
      ) : null}
      <div className="sb-poster__foot">
        {present(section.description) ? (
          <p className="sb-poster__text">{section.description}</p>
        ) : null}
        {actions.length > 0 ? (
          <ul className="sb-poster__actions" role="list">
            {actions.map((action, index) => (
              <li key={index}>
                <Button url={action.url} ctx={ctx} tone={index === 0 ? 'strong' : 'ghost'}>
                  {action.label}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
