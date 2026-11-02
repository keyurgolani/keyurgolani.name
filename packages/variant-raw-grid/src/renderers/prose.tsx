import {
  hrefFor,
  LabeledDate,
  MediaFigure,
  placedImage,
  present,
  renderContext,
  RichText,
  Heading,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Fit, Links, Out, linkText } from '../parts';

// The short and the personal: a lede as a text cell beside the owner's
// portrait, a now note with its date, a focus list as ruled lines, fun
// facts as oddity cells, a quote at display size across the field, and a
// custom section's items as cells.

export function LedeBody({ section, input }: SectionRendererProps<SectionOf<'lede'>>) {
  // The portrait goes beside the first lede alone, so it shows once.
  const first = input.portfolio.sections.find((each) => each.kind === 'lede')?.id === section.id;
  const portrait = first ? placedImage(input.portfolio.identity.avatar, input) : undefined;
  const ctx = renderContext(input, section, 2);
  return (
    <>
      <div className="rg-cell rg-about__text">
        <RichText source={section.body} input={input} />
      </div>
      {portrait ? (
        <div className="rg-cell rg-about__portrait">
          <MediaFigure placed={portrait} ctx={ctx} inline sizes="(min-width: 48rem) 30vw, 100vw" />
        </div>
      ) : null}
    </>
  );
}

export function NowBody({ section, input }: SectionRendererProps<SectionOf<'now'>>) {
  const ctx = renderContext(input, section, 2);
  return (
    <div className="rg-cell rg-now">
      {section.asOf !== undefined ? (
        <p className="rg-num rg-meta">
          <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
      <RichText source={section.body} input={input} />
    </div>
  );
}

export function FocusBody({ section }: SectionRendererProps<SectionOf<'focus'>>) {
  return (
    <ul className="rg-cell rg-list" role="list">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>
          <Fit text={item} />
        </li>
      ))}
    </ul>
  );
}

export function FunFactsBody({ section }: SectionRendererProps<SectionOf<'fun-facts'>>) {
  return (
    <>
      {section.items.filter(present).map((item, index) => (
        <p key={index} className="rg-cell rg-oddity">
          {item}
        </p>
      ))}
    </>
  );
}

export function QuoteBody({ section, input }: SectionRendererProps<SectionOf<'quote'>>) {
  return (
    <figure className="rg-cell rg-quote">
      <blockquote>
        <p>
          <Fit text={section.text} />
        </p>
      </blockquote>
      {present(section.attribution) || present(section.source) ? (
        <figcaption>
          {present(section.attribution) ? (
            <span className="rg-quote__who">{section.attribution}</span>
          ) : null}
          {present(section.source) ? (
            <cite>
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
  return (
    <>
      {present(section.body) ? (
        <div className="rg-cell rg-about__text">
          <RichText source={section.body} input={input} />
        </div>
      ) : null}
      {(section.items ?? []).map((item, index) => {
        const placement = item.media?.[0];
        const image = placedImage(placement, input);
        const caption = present(placement?.caption) ? placement.caption : undefined;
        const picture = image ? (
          <MediaFigure placed={image} ctx={ctx} inline sizes="(min-width: 48rem) 30vw, 100vw" />
        ) : null;
        return (
          <article key={index} className="rg-cell rg-item">
            {/* Its caption a label line under it, as a photograph's caption cell sets its own. */}
            {picture && caption !== undefined ? (
              <figure className="rg-item__fig">
                {picture}
                <figcaption className="rg-meta">{caption}</figcaption>
              </figure>
            ) : (
              picture
            )}
            <Heading level={ctx.itemLevel} className="rg-item__title">
              <Fit text={item.title} />
            </Heading>
            {present(item.summary) ? <RichText source={item.summary} input={input} /> : null}
            <Links
              links={(item.links ?? []).map((link) => ({ url: link.url, text: linkText(link) }))}
              input={input}
            />
          </article>
        );
      })}
    </>
  );
}
