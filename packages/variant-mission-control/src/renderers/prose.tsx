import {
  Heading,
  hrefFor,
  MediaFigure,
  placedImage,
  placedMedia,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { said } from '../model';
import { linkText, Out } from '../parts';

// The owner's own words on the wall, each in a panel's body under its bar:
// a lede as a reading column, the portrait a square module beside the
// first; now with its as-of reading in the bar (the frame's lamp); focus as
// ticks; fun facts as a ticked list in columns; a quote at title size in the
// quote voice; a custom section's body, then its items as cells; and a
// second hero as one line at title size with its actions.

export function LedeBody({ section, input }: SectionRendererProps<SectionOf<'lede'>>) {
  const first = input.portfolio.sections.find((each) => each.kind === 'lede')?.id === section.id;
  const portrait = first ? placedImage(input.portfolio.identity.avatar, input) : undefined;
  const ctx = renderContext(input, section, 3);
  return (
    <div className="mc-lede-body" data-portrait={portrait ? '' : undefined}>
      {portrait ? (
        <div className="mc-portrait">
          <MediaFigure placed={portrait} ctx={ctx} inline sizes="10rem" />
        </div>
      ) : null}
      <RichText source={section.body} className="mc-prose" input={input} />
    </div>
  );
}

export function NowBody({ section, input }: SectionRendererProps<SectionOf<'now'>>) {
  return said(section.body) ? (
    <RichText source={section.body} className="mc-prose" input={input} />
  ) : null;
}

export function FocusBody({ section }: SectionRendererProps<SectionOf<'focus'>>) {
  const items = (section.items ?? []).filter(
    (item): item is string => typeof item === 'string' && said(item),
  );
  if (items.length === 0) return null;
  return (
    <ul className="mc-ticks">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function FunFactsBody({ section }: SectionRendererProps<SectionOf<'fun-facts'>>) {
  const items = section.items.filter(present);
  if (items.length === 0) return null;
  return (
    <ul className="mc-ticks mc-ticks--columns">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function QuoteBody({ section, input }: SectionRendererProps<SectionOf<'quote'>>) {
  return (
    <figure className="mc-saying">
      <blockquote className="mc-saying__text">
        <p>{section.text}</p>
      </blockquote>
      {said(section.attribution) || said(section.source) ? (
        <figcaption className="mc-quote__source">
          {said(section.attribution) ? (
            <span className="mc-quote__name">{section.attribution}</span>
          ) : null}
          {said(section.source) ? (
            <cite className="mc-quote__role">
              {section.sourceUrl ? (
                <Out href={hrefFor(section.sourceUrl, input)}>{section.source}</Out>
              ) : (
                section.source
              )}
            </cite>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function CustomBody({ section, input, level }: SectionRendererProps<SectionOf<'custom'>>) {
  const ctx = renderContext(input, section, level);
  const items = section.items ?? [];
  return (
    <>
      {present(section.body) ? (
        <RichText source={section.body} className="mc-prose mc-custom__body" input={input} />
      ) : null}
      {items.length > 0 ? (
        <ul className="mc-cells">
          {items.map((item, index) => {
            const image = placedMedia(item.media?.[0], ctx);
            return (
              <li key={index}>
                <article className="mc-cell">
                  {image ? (
                    <MediaFigure
                      placed={image}
                      ctx={ctx}
                      className="mc-cell__media"
                      sizes="(width >= 73.75rem) 25vw, 100vw"
                    />
                  ) : null}
                  <div className="mc-cell__body">
                    <Heading level={ctx.itemLevel} className="mc-cell__title">
                      {item.title}
                    </Heading>
                    {present(item.summary) ? (
                      <RichText source={item.summary} className="mc-cell__summary" input={input} />
                    ) : null}
                    {item.links?.length ? (
                      <ul className="mc-actions">
                        {item.links.map((link, i) => (
                          <li key={i}>
                            <Out href={hrefFor(link.url, input)} className="mc-link">
                              {linkText(link)}
                            </Out>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

/** A hero past the anchor: its line at title size, its subtagline, its actions. */
export function SecondHeroBody({ section, input }: SectionRendererProps<SectionOf<'hero'>>) {
  const ctas = section.ctas ?? [];
  return (
    <div className="mc-hero2">
      {said(section.greeting) ? <p className="mc-role">{section.greeting}</p> : null}
      {said(section.name) ? <p className="mc-hero2__name">{section.name}</p> : null}
      {said(section.subtitle) ? <p className="mc-anchor__sub">{section.subtitle}</p> : null}
      {present(section.tagline) ? <p className="mc-lede">{section.tagline}</p> : null}
      {said(section.subtagline) ? <p className="mc-anchor__status">{section.subtagline}</p> : null}
      {ctas.length > 0 ? (
        <ul className="mc-actions">
          {ctas.map((cta, index) => (
            <li key={`${cta.url}-${index}`}>
              <Out
                href={hrefFor(cta.url, input)}
                className={index === 0 ? 'mc-act mc-act--primary' : 'mc-act'}
              >
                {cta.label}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
