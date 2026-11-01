import type { Focus, FunFacts, Hero, Lede, Now, Quote } from '@portfolio/schema';
import {
  evidenceByIds,
  Heading,
  hrefFor,
  MaybeLink,
  MediaFigure,
  present,
  renderContext,
  RichText,
  Ui,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { FoldOnPhone } from '../fold';
import { LinkRow, LinkTo, Phrase, RuledList, placedPhoto } from '../parts';
import { splitThesis } from './practice';

// The owner's own words in Kinetic Cosmos (redesign, stream E): the hero's
// actions and its line about now, set into the opening stage; the lede as
// a standfirst and its prose; now as a large paragraph; focus and facts as
// ruled lists at reading size; a quote set large on the text line; and a
// custom section's body and items. A section's title and count are its
// frame's orbit rule, so none of these renders a section heading of its own.

/**
 * The hero, inside the opening stage. Its heading is the name only when no
 * thesis carries the page's h1 (the caller gives it level 1 then); its
 * actions sit under the standfirst and its line about now on the stage's
 * band, beside where the owner is.
 */
export function HeroBody({ section, input, level }: SectionRendererProps<Hero>) {
  const ctx = renderContext(input, section, level);
  const { identity } = input.portfolio;
  const name = present(section.name) ? section.name : identity.name;
  return (
    <>
      {level === 1 ? (
        <Heading level={1} className="kc-thesis kc-thesis--name">
          <span className="kc-thesis__line">{name}</span>
        </Heading>
      ) : null}
      {level === 1 && present(section.subtitle) ? (
        <p className="kc-standfirst">{section.subtitle}</p>
      ) : null}
      {section.ctas?.length ? (
        <ul className="kc-opening__actions" role="list">
          {section.ctas.map((link, index) => (
            <li key={index}>
              <LinkTo
                link={link}
                ctx={ctx}
                className={index === 0 ? 'kc-button kc-button--bright' : 'kc-link-action'}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {present(section.subtagline) ? <p className="kc-band__now">{section.subtagline}</p> : null}
      <Phrase className="kc-band__where" parts={[identity.pronouns, identity.location]} />
    </>
  );
}

/** A lede: its first sentence as a standfirst, then the rest as prose, folded on a phone (M3). */
export function LedeBody({ section, input, level }: SectionRendererProps<Lede>) {
  const ctx = renderContext(input, section, level);
  const [first = '', ...paragraphs] = section.body.split(/\n\s*\n/);
  const { head, rest } = splitThesis(first);
  const prose = [rest, ...paragraphs].filter((part): part is string => present(part)).join('\n\n');
  return (
    <div className="kc-about">
      <RichText source={head} className="kc-about__lede" input={input} />
      {present(prose) ? (
        <FoldOnPhone className="kc-fold--inline" summary={<Ui ctx={ctx}>Read on</Ui>}>
          <RichText source={prose} className="kc-prose" input={input} />
        </FoldOnPhone>
      ) : null}
    </div>
  );
}

export function NowBody({ section, input }: SectionRendererProps<Now>) {
  return <RichText source={section.body} className="kc-now" input={input} />;
}

export function FocusBody({ section }: SectionRendererProps<Focus>) {
  return <RuledList items={section.items} className="kc-ruled kc-ruled--focus" />;
}

export function FunFactsBody({ section }: SectionRendererProps<FunFacts>) {
  return <RuledList items={section.items} className="kc-ruled kc-ruled--facts" />;
}

/** One quote, set large, captioned with who said it and where, linked as the owner says. */
export function QuoteBody({ section, input, level }: SectionRendererProps<Quote>) {
  const ctx = renderContext(input, section, level);
  const url = section.sourceUrl;
  const source = present(section.source) ? section.source : undefined;
  const attribution = present(section.attribution) ? section.attribution : undefined;
  return (
    <figure className="kc-pull">
      <blockquote cite={url !== undefined ? hrefFor(url, input) : undefined}>
        <p>{section.text}</p>
      </blockquote>
      {attribution !== undefined || source !== undefined || url !== undefined ? (
        <figcaption className="kc-pull__caption">
          <Phrase
            parts={[
              attribution !== undefined && (
                <strong key="attribution">
                  <MaybeLink url={source === undefined ? url : undefined} ctx={ctx}>
                    {attribution}
                  </MaybeLink>
                </strong>
              ),
              source !== undefined && (
                <cite key="source">
                  <MaybeLink url={url} ctx={ctx}>
                    {source}
                  </MaybeLink>
                </cite>
              ),
              attribution === undefined && source === undefined && url !== undefined && (
                <a key="url" href={hrefFor(url, input)}>
                  {url}
                </a>
              ),
            ]}
          />
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A custom section: its body, then each item with its words, pictures, evidence, and links. */
export function CustomBody({ section, input, level }: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      {present(section.body) ? (
        <RichText source={section.body} className="kc-prose" input={input} />
      ) : null}
      {section.items?.length ? (
        <ul className="kc-custom" role="list">
          {section.items.map((item, index) => {
            const media = (item.media ?? []).flatMap((placement) => {
              const image = placedPhoto(placement, ctx);
              return image ? [image] : [];
            });
            const evidence = evidenceByIds(item.evidence, input);
            return (
              <li key={index} className="kc-custom__item">
                {present(item.title) ? (
                  <Heading level={ctx.itemLevel} className="kc-custom__title">
                    {item.title}
                  </Heading>
                ) : null}
                {present(item.summary) ? (
                  <RichText source={item.summary} className="kc-summary" input={input} />
                ) : null}
                {media.length ? (
                  <ul className="kc-hang" role="list" data-count={Math.min(media.length, 4)}>
                    {media.map((image, mediaIndex) => (
                      <li key={`${image.asset}-${mediaIndex}`} className="kc-hang__item">
                        <MediaFigure
                          placed={image}
                          ctx={ctx}
                          className="kc-hang__image"
                          sizes="(min-width: 64rem) 33vw, 100vw"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {evidence.length ? (
                  <ul className="kc-ruled" role="list">
                    {evidence.map((entry) => (
                      <li key={entry.id} lang={entry.lang}>
                        {present(entry.title) ? <strong>{entry.title}</strong> : null}
                        {present(entry.title) && present(entry.statement) ? ' ' : null}
                        {present(entry.statement) ? (
                          <RichText source={entry.statement} inline input={input} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <LinkRow links={item.links} ctx={ctx} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
