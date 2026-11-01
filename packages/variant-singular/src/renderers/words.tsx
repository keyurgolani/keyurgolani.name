import {
  evidenceByIds,
  hrefFor,
  MediaFigure,
  placedImage,
  renderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { linkText, nestedCtasOf, present, squash } from '../model';
import { Phrase, Prose, urlHref } from '../parts';
import { Entries, Entry } from './entry';

// The record's own words (brief §5.7, step 5): the lede and Now as prose,
// focus and fun facts as plain lines, a quote as one figure with its
// source, a call to action as its line and its actions, and a custom
// section as its body and its items. All at the record's one size.

const deeper = (level: number) => Math.min(6, level + 1) as 3 | 4 | 5 | 6;

export function LedeRenderer({ section, input }: SectionRendererProps<SectionOf<'lede'>>) {
  return <Prose source={section.body} input={input} className="sg-rec__prose" />;
}

export function NowRenderer({ section, input }: SectionRendererProps<SectionOf<'now'>>) {
  return <Prose source={section.body} input={input} className="sg-rec__prose" />;
}

export function FocusRenderer({ section }: SectionRendererProps<SectionOf<'focus'>>) {
  return (
    <ul className="sg-rec__lines" role="list">
      {section.items.filter(present).map((item, i) => (
        <li key={`${i}-${item}`}>{squash(item)}</li>
      ))}
    </ul>
  );
}

export function FunFactsRenderer({ section }: SectionRendererProps<SectionOf<'fun-facts'>>) {
  return (
    <ul className="sg-rec__lines" role="list">
      {section.items.filter(present).map((item, i) => (
        <li key={`${i}-${item}`}>{squash(item)}</li>
      ))}
    </ul>
  );
}

export function QuoteRenderer({ section, input }: SectionRendererProps<SectionOf<'quote'>>) {
  const source = present(section.source) ? squash(section.source) : undefined;
  return (
    <figure className="sg-rec__quote">
      <blockquote className="sg-rec__said" data-type-role="quote">
        <p>“{squash(section.text)}”</p>
      </blockquote>
      {present(section.attribution) || source ? (
        <figcaption className="sg-rec__muted">
          {present(section.attribution) ? squash(section.attribution) : null}
          {present(section.attribution) && source ? ', ' : null}
          {source ? (
            <cite>
              {section.sourceUrl ? (
                <a href={urlHref(section.sourceUrl, input)}>{source}</a>
              ) : (
                source
              )}
            </cite>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function CtaRenderer({ section, input }: SectionRendererProps<SectionOf<'cta'>>) {
  // Nested in the contact panel, its actions join the panel's links and its band: its words alone here.
  const nested = nestedCtasOf(input).some((cta) => cta.id === section.id);
  const actions = nested
    ? []
    : [section.primaryAction, section.secondaryAction].filter((a) => a !== undefined);
  return (
    <>
      {present(section.description) ? (
        <p className="sg-rec__line">{squash(section.description)}</p>
      ) : null}
      {actions.length > 0 ? (
        <ul className="sg-rec__links" role="list">
          {actions.map((action) => (
            <li key={action.url}>
              <a href={hrefFor(action.url.trim(), input)}>{squash(action.label)}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function CustomRenderer({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'custom'>>) {
  const items = section.items ?? [];
  return (
    <>
      {present(section.body) ? (
        <Prose source={section.body} input={input} className="sg-rec__prose" />
      ) : null}
      {items.length > 0 ? (
        <Entries>
          {items.map((item, i) => {
            const ctx = renderContext(input, { id: section.id, title: item.title }, deeper(level));
            const image = placedImage(item.media?.[0], input, item.media?.[0]?.caption);
            const cited = evidenceByIds(item.evidence, input);
            return (
              <Entry key={`${i}-${item.title}`} title={squash(item.title)} level={deeper(level)}>
                {present(item.summary) ? (
                  <p className="sg-rec__muted">
                    <Phrase source={item.summary} input={input} />
                  </p>
                ) : null}
                {image ? (
                  <div className="sg-rec__figure">
                    <MediaFigure placed={image} ctx={ctx} sizes="(min-width: 48rem) 40vw, 100vw" />
                  </div>
                ) : null}
                {cited.length > 0 ? (
                  <p className="sg-rec__muted">
                    {cited
                      .map((entry) => (present(entry.title) ? squash(entry.title) : undefined))
                      .filter(present)
                      .join(', ')}
                  </p>
                ) : null}
                {item.links?.length ? (
                  <ul className="sg-rec__links" role="list">
                    {item.links.map((link) => (
                      <li key={link.url}>
                        <a href={hrefFor(link.url.trim(), input)}>{linkText(link)}</a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Entry>
            );
          })}
        </Entries>
      ) : null}
    </>
  );
}
