import type { Section } from '@portfolio/schema';
import { hrefFor, type SectionRendererProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { linkLabel, leadOf, paragraphsOf, present, posterLine, thesisSectionOf } from '../model';
import {
  captionedImage,
  Img,
  More,
  Out,
  Phrase,
  Prose,
  readyImage,
  uiLang,
  When,
  Words,
} from '../parts';

// About and the owner's own words (brief §5.10): the lede's first sentence
// set large (FX-S45: weight for two lines at most, and prose at body
// weight), the owner's portrait in a drop beside it when there's one; Now,
// focus and facts as short runs; a quote at headline size; skills and
// tools as chips that merge on a fine pointer's hover (S5: never over the
// words); services as titled rows. The thesis section's own frame carries
// the thesis after its first sentence, which the opening shows.

type Of<K extends Section['kind']> = Extract<Section, { kind: K }>;

export function LedeRenderer({ section, input }: SectionRendererProps<Of<'lede'>>) {
  const { lead, rest } = leadOf(section.body);
  const portrait = readyImage(input.portfolio.identity.avatar, input);
  return (
    <div className={portrait ? 'fx-about fx-about--portrait' : 'fx-about'}>
      {portrait ? (
        <div className="fx-about__drop">
          <Img
            placed={portrait}
            input={input}
            sizes="(min-width: 64rem) 28vw, 70vw"
            className="fx-about__img"
          />
        </div>
      ) : null}
      <div className="fx-about__words">
        <p className="fx-about__lead" data-type-role="headline">
          {lead}
        </p>
        {/* The lede's rest, folded on a phone: the first sentence carries it. */}
        {present(rest) ? (
          <More count={paragraphsOf(rest)} input={input}>
            <Prose source={rest} input={input} className="fx-prose" />
          </More>
        ) : null}
      </div>
    </div>
  );
}

export function NowRenderer({ section, input }: SectionRendererProps<Of<'now'>>) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <div className="fx-note">
      {section.asOf ? (
        <p className="fx-note__when" data-type-role="caption">
          <Words lang={lang}>As of </Words>
          <When raw={section.asOf} lang={lang} />
        </p>
      ) : null}
      <Prose source={section.body} input={input} className="fx-prose" />
    </div>
  );
}

export function FocusRenderer({ section }: SectionRendererProps<Of<'focus'>>) {
  return (
    <ul className="fx-run" role="list" data-type-role="body">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function FunFactsRenderer({ section, input }: SectionRendererProps<Of<'fun-facts'>>) {
  const items = section.items.filter(present);
  const list = (shown: readonly string[], from: number) => (
    <ul className="fx-run fx-run--facts" role="list" data-type-role="body">
      {shown.map((item, index) => (
        <li key={index + from}>{item}</li>
      ))}
    </ul>
  );
  // Two, then the rest folded on a phone.
  if (items.length <= 3) return list(items, 0);
  return (
    <div className="fx-run-more">
      {list(items.slice(0, 2), 0)}
      <More count={items.length - 2} input={input}>
        {list(items.slice(2), 2)}
      </More>
    </div>
  );
}

export function QuoteRenderer({ section, input }: SectionRendererProps<Of<'quote'>>) {
  return (
    <figure className="fx-quote">
      <blockquote className="fx-quote__words" data-type-role="headline">
        <Phrase source={section.text} input={input} />
      </blockquote>
      {present(section.attribution) || present(section.source) ? (
        <figcaption className="fx-quote__who" data-type-role="caption">
          {present(section.attribution) ? <span>{section.attribution}</span> : null}
          {present(section.attribution) && present(section.source) ? ', ' : null}
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

function Chips({ items }: { items: readonly { key: string; node: React.ReactNode }[] }) {
  return (
    <ul className="fx-chips" role="list" data-type-role="body-compact">
      {items.map((item) => (
        <li key={item.key} className="fx-chip">
          {item.node}
        </li>
      ))}
    </ul>
  );
}

export function PracticeRenderer({ section, input }: SectionRendererProps<Of<'practice'>>) {
  const practice = input.portfolio.practice;
  if (section.part === 'thesis') {
    if (!present(practice?.thesis)) return null;
    // The opening shows the first sentence as its key phrase; the frame keeps the rest.
    const opening =
      thesisSectionOf(input)?.id === section.id && posterLine(input).source === 'thesis';
    const rest = opening ? leadOf(practice.thesis).rest : practice.thesis;
    return present(rest) ? (
      <Prose source={rest} input={input} role="title" className="fx-thesis__words" />
    ) : null;
  }
  if (section.part === 'skills' || section.part === 'tools') {
    const groups =
      section.part === 'skills'
        ? (practice?.skills ?? []).map((group) => ({
            name: group.name,
            about: group.description,
            items: group.items.filter(present).map((item) => ({ key: item, node: item })),
          }))
        : (practice?.tools ?? []).map((group) => ({
            name: group.name,
            about: group.description,
            items: group.items.map((tool) => ({
              key: tool.name,
              node: (
                <>
                  {tool.url ? <a href={hrefFor(tool.url, input)}>{tool.name}</a> : tool.name}
                  {present(tool.version) ? ` ${tool.version}` : null}
                </>
              ),
            })),
          }));
    return (
      <div className="fx-groups">
        {groups.map((group, index) => (
          <div key={group.name ?? index} className="fx-group">
            {group.name ? (
              <h4 className="fx-group__name" data-type-role="label">
                {group.name}
              </h4>
            ) : null}
            {present(group.about) ? (
              <p className="fx-group__about" data-type-role="body-compact">
                {group.about}
              </p>
            ) : null}
            <Chips items={group.items} />
          </div>
        ))}
      </div>
    );
  }
  const groups = practice?.services ?? [];
  // One group's rows untitled; several, each titled by its name and what it says of itself.
  return (
    <>
      {groups.map((group, index) => (
        <div key={group.name ?? index} className="fx-services">
          {present(group.name) || present(group.description) ? (
            <div className="fx-services__head">
              {present(group.name) ? (
                <h4 className="fx-group__name" data-type-role="label">
                  {group.name}
                </h4>
              ) : null}
              {present(group.description) ? (
                <p className="fx-group__about" data-type-role="body-compact">
                  {group.description}
                </p>
              ) : null}
            </div>
          ) : null}
          <Services items={group.items} input={input} />
        </div>
      ))}
    </>
  );
}

type Service = NonNullable<
  NonNullable<VariantRenderInput['portfolio']['practice']>['services']
>[number]['items'][number];

/** A group's services: each titled, its description, its highlights as drops, its terms beside. */
function Services({ items, input }: { items: readonly Service[]; input: VariantRenderInput }) {
  // The first, then the rest folded on a phone.
  if (items.length > 1)
    return (
      <div className="fx-run-more">
        <Services items={items.slice(0, 1)} input={input} />
        <More count={items.length - 1} input={input}>
          <Services items={items.slice(1)} input={input} />
        </More>
      </div>
    );
  return (
    <ul className="fx-rows" role="list">
      {items.map((service) => (
        <li key={service.name} className="fx-row">
          <p className="fx-item__title" data-type-role="title">
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
            <div className="fx-row__sum">
              <Prose source={service.description} input={input} role="body-compact" />
            </div>
          ) : null}
          {service.highlights?.some(present) ? (
            <ul className="fx-drops" role="list" data-type-role="body-compact">
              {service.highlights.filter(present).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
          {present(service.pricing) ? (
            <div className="fx-row__aside">
              <p className="fx-row__foot" data-type-role="caption">
                {service.pricing}
              </p>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function CustomRenderer({ section, input }: SectionRendererProps<Of<'custom'>>) {
  return (
    <>
      {present(section.body) ? (
        <Prose source={section.body} input={input} className="fx-prose" />
      ) : null}
      {section.items?.length ? (
        <ul className="fx-rows" role="list">
          {section.items.map((item, index) => {
            const links = (item.links ?? []).filter((each) => present(each.url));
            // The title takes the first link when the owner gave it no name; named links keep theirs.
            const first = links[0];
            const titled = first && !present(first.label) ? first : undefined;
            const rest = links.filter((each) => each !== titled);
            const media = (item.media ?? []).flatMap((placement) => {
              const placed = captionedImage(placement, input);
              return placed ? [placed] : [];
            });
            return (
              <li key={`${item.title}-${index}`} className="fx-row">
                <p className="fx-item__title" data-type-role="title">
                  {titled ? (
                    <a href={hrefFor(titled.url, input)}>
                      {item.title}
                      <Out href={titled.url} />
                    </a>
                  ) : (
                    item.title
                  )}
                </p>
                {present(item.summary) ? (
                  <div className="fx-row__sum">
                    <Prose source={item.summary} input={input} role="body-compact" />
                  </div>
                ) : null}
                {media.length > 0 ? (
                  <ul className="fx-gallery__frames" role="list" data-count={String(media.length)}>
                    {media.map((placed, at) => (
                      <li key={placed.asset} className="fx-frame" data-shape={String(at % 3)}>
                        <Img
                          placed={placed}
                          input={input}
                          sizes="(min-width: 64rem) 28vw, 45vw"
                          inline={false}
                          className="fx-frame__img"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {rest.length > 0 ? (
                  <p className="fx-row__links" data-type-role="label">
                    {rest.map((each) => {
                      const href = hrefFor(each.url, input);
                      return (
                        <a key={each.url} className="fx-link" href={href}>
                          {linkLabel(each)}
                          <Out href={href} />
                        </a>
                      );
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
