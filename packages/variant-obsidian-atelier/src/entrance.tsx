import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import {
  hrefFor,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Hang } from './hang';
import { atelierModel, type AtelierModel } from './model';
import { ownId, Words } from './parts';

// The entrance (redesign, stream C, C2 and C3): the first room, one wall
// down to a floor line, symmetric on the page's axis where Editorial is
// asymmetric. In reading order, which is the order every width shows:
//
//   the plaque     the hero's frame: the role, at caption size, under the
//                  chrome's name in the wall's top corner
//   the work       the signature on a deep mat, cropped square, on the
//                  page's axis, its foot just above the floor line; its
//                  wall label, No. 1 of the catalogue, pinned to its
//                  bottom-left at caption size (under it on a phone)
//   the title      on the floor at the work's foot: the thesis's first
//                  sentence, the room's title and the page's h1 (with no
//                  thesis, the plaque is the h1)
//   the floor      at its front edge, where the owner is and the way on
//   after it       on the canvas, the rest of the thesis, the hero's own
//                  words, and its links (EntranceWords)
//
// No greeting, no avatar, no card, and no column of text beside the work:
// the work is the picture, and the thesis is what the room says.

/** The plaque's h1 id, which the entrance is labelled by. */
export const entranceTitle = (input: Pick<VariantRenderInput, 'ids'>) =>
  ownId(input, 'entrance-title');

/** Words a full stop follows that end no sentence, in English. */
const ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'mx',
  'prof',
  'st',
  'jr',
  'sr',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'no',
  'e.g',
  'i.e',
  'cf',
  'approx',
]);

/**
 * Where the first sentence ends: the first `.`, `!`, or `?` that a space
 * and a capital, a digit, or a quote follow, unless the word it ends is an
 * abbreviation, such as "Dr.", or an initial, such as the "J." of "J. Doe".
 */
function firstSentenceEnd(text: string): number {
  const end = /[.!?]["'\u2019\u201d)]?(?=\s+["'\u2018\u201c(]?[\p{Lu}\p{N}])/gu;
  for (let match = end.exec(text); match !== null; match = end.exec(text)) {
    if (text[match.index] === '.') {
      const word = /([\p{L}.]+)$/u.exec(text.slice(0, match.index))?.[1] ?? '';
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) continue;
    }
    return match.index + match[0].length;
  }
  return -1;
}

/**
 * The thesis split for the wall: its first sentence, the room's title, and
 * the rest. A thesis with no sentence end, or a first sentence too long to
 * stand as a title, is the title whole, at the headline size.
 */
export function thesisParts(source: string): { title: string; rest?: string; long: boolean } {
  const text = source.trim();
  const at = firstSentenceEnd(text);
  const title = at < 0 ? text : text.slice(0, at);
  const rest = at < 0 ? undefined : text.slice(at).trim();
  if (title.length > 90) return { title: text, long: true };
  return { title, ...(present(rest) ? { rest } : {}), long: false };
}

/**
 * The plaque: the role, at caption size in the wall's corner, under the name
 * the chrome's mark shows there. The name is on the plaque too when it's
 * the page's h1, with no thesis to name the room, or when the hero names
 * someone the identity doesn't.
 */
function Plaque({
  input,
  name,
  heading,
}: {
  input: VariantRenderInput;
  name: string;
  /** Whether the plaque is the page's h1: when no thesis names the room. */
  heading: boolean;
}) {
  const { tagline } = input.portfolio.identity;
  const named = heading || name !== input.portfolio.identity.name;
  const role = present(tagline) && tagline !== name ? tagline : undefined;
  if (!named && role === undefined) return null;
  const Title = heading ? 'h1' : 'p';
  return (
    <Title
      id={heading ? entranceTitle(input) : undefined}
      className="oa-plaque__name"
      data-type-role={heading ? undefined : 'label'}
    >
      {named ? <span className="oa-plaque__line">{name}</span> : null}
      {named && role !== undefined ? ' ' : null}
      {role !== undefined ? <span className="oa-plaque__line oa-plaque__role">{role}</span> : null}
    </Title>
  );
}

export function Entrance({
  input,
  model,
  render,
}: {
  input: VariantRenderInput;
  model: AtelierModel;
  /** Renders a section in the composition's own frame, at a level. */
  render: (section: Section, level: 1 | 2 | 3) => ReactElement | null;
}) {
  const { hero, thesis, rooms } = model;
  const { identity } = input.portfolio;
  const ctx = renderContext(input, hero ?? { id: 'entrance' }, 1);
  const first = rooms[0];
  const facts = [identity.location, identity.pronouns].filter(present);
  // The entrance is the page's opening wall, no region of its own: its h1 heads the main,
  // and the hero and the thesis on it are each their own section's frame. The work comes
  // first, as a visitor meets it; the room's title is on the floor at its foot.
  return (
    <div
      id={ownId(input, 'entrance')}
      className="oa-entrance oa-wall"
      data-oa-place="Entrance"
      data-oa-key="entrance"
      data-hung={first?.image ? '' : undefined}
    >
      {hero ? (
        render(hero, thesis ? 3 : 1)
      ) : (
        <div className="oa-plaque">
          <Plaque input={input} name={identity.name} heading={!thesis} />
        </div>
      )}
      {first ? (
        <Hang room={first} ctx={ctx} eager caption sizes="(min-width: 64rem) 55vw, 100vw" />
      ) : null}
      {thesis ? render(thesis, 1) : null}
      {/* The floor's front edge: where the owner is, and the way on to Room I. */}
      {first || facts.length > 0 ? (
        <p className="oa-floor__on" data-type-role="label">
          {facts.length > 0 ? <span className="oa-floor__facts">{facts.join(', ')}</span> : null}
          {first ? (
            <a className="oa-floor__way" href={`#${first.anchor}`}>
              <Words input={input}>{`Continue to Room ${first.numeral}`}</Words>
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** The links a visitor can take from the hero, less any the exit wall's label already offers, such as the CV. */
function heroLinks(input: VariantRenderInput, model: AtelierModel) {
  const label = model.exitLabel;
  const taken = new Set(
    label?.kind === 'cta'
      ? [label.primaryAction?.url, label.secondaryAction?.url].filter(present)
      : [],
  );
  return (model.hero?.ctas ?? []).filter((link) => !taken.has(link.url));
}

/**
 * The wall text after the entrance, on the canvas before Room I: the rest
 * of the thesis, the hero's own words, and its links, off the wall, which
 * carries the work, its label, and the room's title alone.
 */
export function EntranceWords({
  input,
  model,
}: {
  input: VariantRenderInput;
  model: AtelierModel;
}) {
  const { hero, thesis } = model;
  const statement = input.portfolio.practice?.thesis;
  const rest = thesis && present(statement) ? thesisParts(statement).rest : undefined;
  const words = [hero?.tagline, hero?.subtagline].filter(present);
  const ctas = heroLinks(input, model);
  if (!present(rest) && words.length === 0 && ctas.length === 0) return null;
  return (
    <div className="oa-intro">
      {present(rest) || words.length > 0 ? (
        <div className="oa-intro__words">
          {present(rest) ? (
            <RichText source={rest} className="oa-intro__thesis" input={input} />
          ) : null}
          {words.map((text, index) => (
            <p key={index} className={index > 0 || present(rest) ? 'oa-quiet' : undefined}>
              {text}
            </p>
          ))}
        </div>
      ) : null}
      {ctas.length > 0 ? (
        <ul className="oa-actions oa-intro__actions" role="list">
          {ctas.map((link, index) => (
            <li key={index}>
              <a href={hrefFor(link.url, input)} data-platform={link.platform}>
                {[link.label, link.platform].find(present) ?? link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The thesis on the entrance: its first sentence the room's title and the
 * page's h1, on the floor at the work's foot; the rest of it is the wall
 * text after the wall (EntranceWords). The section's own title is kept for
 * assistive technology, as the room's sign.
 */
export function EntranceThesis({
  input,
  label,
}: {
  input: VariantRenderInput;
  /** The section's own title, the room's sign over the thesis. */
  label?: string;
}) {
  const thesis = input.portfolio.practice?.thesis;
  if (!present(thesis)) return null;
  const { title, long } = thesisParts(thesis);
  return (
    <>
      {present(label) ? <p className="oa-visually-hidden">{label}</p> : null}
      <h1
        id={entranceTitle(input)}
        className="oa-entrance__title"
        data-type-role={long ? 'headline' : 'display'}
        data-long={long ? '' : undefined}
      >
        <RichText source={title} inline input={input} />
      </h1>
    </>
  );
}

/** The hero: the entrance's plaque, the page's h1 at level 1, a plain opening anywhere else. */
export function HeroRenderer({ section, input, level }: SectionRendererProps<SectionOf<'hero'>>) {
  if (atelierModel(input).hero?.id === section.id) {
    const name = present(section.name) ? section.name : input.portfolio.identity.name;
    return (
      <>
        {present(section.title) ? (
          <p className="oa-plaque__label oa-quiet">{section.title}</p>
        ) : null}
        <Plaque input={input} name={name} heading={!atelierModel(input).thesis} />
      </>
    );
  }
  // A second hero has no wall of its own: its name and words, read in its gallery.
  const ctx = renderContext(input, section, level);
  const Title = `h${ctx.level}` as const;
  const words = [section.tagline, section.subtagline].filter(present);
  return (
    <>
      <Title className="oa-h3">
        {present(section.name) ? section.name : input.portfolio.identity.name}
      </Title>
      {words.map((text, index) => (
        <p key={index} className={index > 0 ? 'oa-quiet' : undefined}>
          {text}
        </p>
      ))}
      {section.ctas?.length ? (
        <ul className="oa-links" role="list">
          {section.ctas.map((link, index) => (
            <li key={index}>
              <a href={hrefFor(link.url, input)}>
                {[link.label, link.platform].find(present) ?? link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
