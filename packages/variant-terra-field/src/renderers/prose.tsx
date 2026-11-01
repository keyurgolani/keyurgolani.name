import {
  Heading,
  hrefFor,
  LabeledDate,
  MediaFigure,
  placedImage,
  present,
  renderContext,
  RichText,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { said } from '../model';
import { linkText, Links, Out } from '../parts';

// The short and the personal, on the page's axis: a lede as a centred
// reading column, the owner's portrait round above the first one; a now
// note with its date; a focus list ruled; fun facts as notes in two ruled
// columns; a quote at headline size across the axis; a custom section's
// items ruled; and a second hero as one centred display line.

export function LedeBody({ section, input }: SectionRendererProps<SectionOf<'lede'>>) {
  const first = input.portfolio.sections.find((each) => each.kind === 'lede')?.id === section.id;
  const portrait = first ? placedImage(input.portfolio.identity.avatar, input) : undefined;
  const ctx = renderContext(input, section, 3);
  return (
    <div className="tf-lede" data-portrait={portrait ? '' : undefined}>
      {portrait ? (
        <div className="tf-lede__portrait">
          <MediaFigure placed={portrait} ctx={ctx} inline sizes="12rem" />
        </div>
      ) : null}
      <RichText source={section.body} className="tf-lede__text" input={input} />
    </div>
  );
}

export function NowBody({ section, input }: SectionRendererProps<SectionOf<'now'>>) {
  const ctx = renderContext(input, section, 3);
  return (
    <div className="tf-now">
      {section.asOf !== undefined ? (
        <p className="tf-label tf-kicker tf-num">
          <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
      <RichText source={section.body} className="tf-now__text" input={input} />
    </div>
  );
}

export function FocusBody({ section }: SectionRendererProps<SectionOf<'focus'>>) {
  return (
    <ul className="tf-ruled tf-focus" role="list">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function FunFactsBody({ section }: SectionRendererProps<SectionOf<'fun-facts'>>) {
  return (
    <ul className="tf-notes-list" role="list">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function QuoteBody({ section, input }: SectionRendererProps<SectionOf<'quote'>>) {
  return (
    <figure className="tf-saying">
      <blockquote>
        <p className="tf-quote">{section.text}</p>
      </blockquote>
      {said(section.attribution) || said(section.source) ? (
        <figcaption className="tf-compact">
          {said(section.attribution) ? (
            <span className="tf-strong">{section.attribution}</span>
          ) : null}
          {said(section.attribution) && said(section.source) ? ', ' : null}
          {said(section.source) ? (
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
    <div className="tf-custom">
      {present(section.body) ? (
        <RichText source={section.body} className="tf-custom__body" input={input} />
      ) : null}
      {section.items?.length ? (
        <ul className="tf-rows" role="list">
          {section.items.map((item, index) => {
            const image = placedImage(item.media?.[0], input);
            return (
              <li key={index} data-media={image ? '' : undefined}>
                {image ? (
                  <div className="tf-rows__media tf-frame">
                    <MediaFigure
                      placed={image}
                      ctx={ctx}
                      inline
                      sizes="(min-width: 48rem) 20vw, 100vw"
                    />
                  </div>
                ) : null}
                <div className="tf-rows__main">
                  <Heading level={ctx.itemLevel} className="tf-title">
                    {item.title}
                  </Heading>
                  {present(item.summary) ? (
                    <RichText
                      source={item.summary}
                      className="tf-compact tf-second"
                      input={input}
                    />
                  ) : null}
                  <Links
                    links={(item.links ?? []).map((link) => ({
                      url: link.url,
                      text: linkText(link),
                    }))}
                    input={input}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A hero past the opening: its line at headline size on the axis, its tagline under it. */
export function SecondHeroBody({ section, input }: SectionRendererProps<SectionOf<'hero'>>) {
  const line = [section.tagline, section.name].find(present);
  return (
    <div className="tf-standalone">
      {line ? <p className="tf-headline">{line}</p> : null}
      {said(section.subtagline) ? <p className="tf-second">{section.subtagline}</p> : null}
      {section.ctas?.length ? (
        <Links
          links={section.ctas.map((cta) => ({ url: cta.url, text: cta.label }))}
          input={input}
        />
      ) : null}
    </div>
  );
}
