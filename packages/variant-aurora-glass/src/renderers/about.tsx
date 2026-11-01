import type { Section } from '@portfolio/schema';
import { hrefFor, type SectionRendererProps } from '@portfolio/kit/sections';
import { openingOf, present, thesisSectionOf } from '../model';
import { LinkLine, Out, Phrase, Prose, uiLang, When, Words } from '../parts';

// The owner's own words (brief §5.2, About and the unlabelled band): the
// lede as running prose at the measure, Now with its date, focus and fun
// facts as short ruled lists, the practice's groups as a definition list
// (a group's name, then its items as one sentence, never chip soup), the
// quote set off by size alone, and custom items as rows. The first thesis
// section is the opening's standfirst: the rest of the thesis, under the h1.

type Of<K extends Section['kind']> = Extract<Section, { kind: K }>;

export function LedeRenderer({ section, input }: SectionRendererProps<Of<'lede'>>) {
  return <Prose source={section.body} input={input} className="ag-prose" />;
}

export function NowRenderer({ section, input }: SectionRendererProps<Of<'now'>>) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <>
      {section.asOf ? (
        <p className="ag-row__foot" data-type-role="caption">
          <Words lang={lang}>As of </Words>
          <When raw={section.asOf} lang={lang} />
        </p>
      ) : null}
      <Prose source={section.body} input={input} className="ag-prose" />
    </>
  );
}

export function FocusRenderer({ section }: SectionRendererProps<Of<'focus'>>) {
  return (
    <ul className="ag-list" data-type-role="body">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function FunFactsRenderer({ section }: SectionRendererProps<Of<'fun-facts'>>) {
  return (
    <ul className="ag-list ag-list--facts" data-type-role="body">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function QuoteRenderer({ section, input }: SectionRendererProps<Of<'quote'>>) {
  const cite = [section.attribution, section.source].filter(present);
  return (
    <figure className="ag-quote">
      <blockquote className="ag-quote__text" data-type-role="headline">
        <Phrase source={section.text} input={input} />
      </blockquote>
      {cite.length > 0 ? (
        <figcaption className="ag-quote__who" data-type-role="caption">
          {present(section.attribution) ? <span>{section.attribution}</span> : null}
          {present(section.source) ? (
            section.sourceUrl ? (
              <cite>
                <a href={hrefFor(section.sourceUrl, input)}>
                  {section.source}
                  <Out href={section.sourceUrl} />
                </a>
              </cite>
            ) : (
              <cite>{section.source}</cite>
            )
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function PracticeRenderer({ section, input }: SectionRendererProps<Of<'practice'>>) {
  const practice = input.portfolio.practice;
  if (section.part === 'thesis') {
    if (thesisSectionOf(input)?.id === section.id) {
      const { standfirst } = openingOf(input);
      // The section's own subtitle reads with the standfirst, its heading being hidden (blocker 2).
      const subtitle = present(section.subtitle) ? section.subtitle : undefined;
      return standfirst || subtitle ? (
        <>
          {subtitle ? (
            <p className="ag-standfirst__sub" data-type-role="caption">
              <Phrase source={subtitle} input={input} />
            </p>
          ) : null}
          {standfirst ? (
            <Prose source={standfirst} input={input} role="body" className="ag-standfirst__text" />
          ) : null}
        </>
      ) : null;
    }
    return present(practice?.thesis) ? (
      <Prose source={practice.thesis} input={input} role="title" className="ag-prose" />
    ) : null;
  }
  if (section.part === 'skills') {
    return (
      <dl className="ag-groups">
        {(practice?.skills ?? []).map((group, index) => (
          <div key={group.name ?? index} className="ag-group">
            {group.name ? <dt data-type-role="title">{group.name}</dt> : null}
            {present(group.description) ? (
              <dd className="ag-group__note" data-type-role="caption">
                {group.description}
              </dd>
            ) : null}
            <dd data-type-role="body-compact">{group.items.filter(present).join(', ')}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (section.part === 'tools') {
    return (
      <dl className="ag-groups">
        {(practice?.tools ?? []).map((group, index) => (
          <div key={group.name ?? index} className="ag-group">
            {group.name ? <dt data-type-role="title">{group.name}</dt> : null}
            {present(group.description) ? (
              <dd className="ag-group__note" data-type-role="caption">
                {group.description}
              </dd>
            ) : null}
            <dd data-type-role="body-compact">
              {group.items.map((tool, at) => (
                <span key={tool.name}>
                  {at > 0 ? ', ' : null}
                  {tool.url ? <a href={hrefFor(tool.url, input)}>{tool.name}</a> : tool.name}
                  {present(tool.version) ? ` ${tool.version}` : null}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <ul className="ag-rows ag-offers" role="list">
      {(practice?.services ?? []).flatMap((group) => [
        // A named group of offers is named once, over its rows.
        ...(present(group.name)
          ? [
              <li key={`group-${group.name}`} className="ag-row ag-offers__group">
                <p data-type-role="label">{group.name}</p>
              </li>,
            ]
          : []),
        ...group.items.map((service) => (
          <li key={`${group.name ?? ''}-${service.name}`} className="ag-row">
            <p className="ag-row__title" data-type-role="title">
              {service.url ? (
                <a href={hrefFor(service.url, input)}>
                  {service.name}
                  <Out href={service.url} />
                </a>
              ) : (
                service.name
              )}
            </p>
            {present(service.description) ? (
              <p className="ag-row__sum" data-type-role="body-compact">
                <Phrase source={service.description} input={input} />
              </p>
            ) : null}
            {present(service.pricing) ? (
              <p className="ag-row__foot" data-type-role="caption">
                {service.pricing}
              </p>
            ) : null}
            {service.highlights?.length ? (
              <ul className="ag-list" data-type-role="body-compact">
                {service.highlights.filter(present).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : null}
          </li>
        )),
      ])}
    </ul>
  );
}

export function CustomRenderer({ section, input }: SectionRendererProps<Of<'custom'>>) {
  return (
    <>
      {present(section.body) ? (
        <Prose source={section.body} input={input} className="ag-prose" />
      ) : null}
      {section.items?.length ? (
        <ul className="ag-rows" role="list">
          {section.items.map((item, index) => {
            const link = item.links?.find((each) => present(each.url));
            return (
              <li key={`${item.title}-${index}`} className="ag-row">
                <p className="ag-row__title" data-type-role="title">
                  {link ? (
                    <a href={hrefFor(link.url, input)}>
                      {item.title}
                      <Out href={link.url} />
                    </a>
                  ) : (
                    item.title
                  )}
                </p>
                {present(item.summary) ? (
                  <Prose
                    source={item.summary}
                    input={input}
                    role="body-compact"
                    className="ag-row__sum"
                  />
                ) : null}
                {/* The item's pictures' captions, as the owner wrote them, and its links by their labels. */}
                {item.media?.some((media) => present(media.caption)) ? (
                  <p className="ag-row__where" data-type-role="caption">
                    {item.media
                      .filter((media) => present(media.caption))
                      .map((media, at) => (
                        <span key={`${media.asset}-${at}`}>{media.caption}</span>
                      ))}
                  </p>
                ) : null}
                <LinkLine links={item.links} input={input} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
