import type { Section } from '@portfolio/schema';
import {
  hrefFor,
  LabeledDate,
  placedImage,
  renderContext,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { Img } from '../media';
import { firstSentence, plainInline, present } from '../model';
import { Out, Paren, Phrase, Prose, uiLang, Words } from '../parts';
import { RuledTable } from './ruled-table';

// The owner's words (brief §5.1, components 14, 15 and 16): the lede in
// two columns, Now with its date, focus as a ruled list, practice groups
// four-up with versions in tabular figures, services as a ruled table,
// the facts four-up on rules, the quote as a poster, and custom content
// as prose with ruled items.

type Of<K extends Section['kind']> = Extract<Section, { kind: K }>;

export function LedeRenderer({ section, input }: SectionRendererProps<Of<'lede'>>) {
  return <Prose source={section.body} input={input} className="ss-cols" />;
}

export function NowRenderer({ section, input }: SectionRendererProps<Of<'now'>>) {
  const ctx = renderContext(input, section, 3);
  return (
    <div className="ss-now">
      {section.asOf ? (
        <p className="ss-muted" data-type-role="caption">
          <LabeledDate label="As of" raw={section.asOf} ctx={ctx} />
        </p>
      ) : null}
      <Prose source={section.body} input={input} />
    </div>
  );
}

export function FocusRenderer({ section, input }: SectionRendererProps<Of<'focus'>>) {
  return (
    <ul className="ss-ruled ss-focus" data-type-role="body">
      {section.items.filter(present).map((item, index) => (
        <li key={index}>
          <Phrase source={item} input={input} />
        </li>
      ))}
    </ul>
  );
}

export function FunFactsRenderer({ section, input }: SectionRendererProps<Of<'fun-facts'>>) {
  return (
    <ul className="ss-facts">
      {section.items.filter(present).map((item, index) => (
        <li key={index} data-type-role="body">
          <Phrase source={item} input={input} />
        </li>
      ))}
    </ul>
  );
}

/** The quote as a poster: hanging marks, the attribution as the parenthetical. */
export function QuoteRenderer({ section, input }: SectionRendererProps<Of<'quote'>>) {
  const source = present(section.source) ? (
    section.sourceUrl ? (
      <a href={hrefFor(section.sourceUrl, input)}>
        <cite>{section.source}</cite>
        <Out href={section.sourceUrl} />
      </a>
    ) : (
      <cite>{section.source}</cite>
    )
  ) : null;
  return (
    <figure className="ss-quote-poster">
      <blockquote data-type-role="headline">
        <p>
          {'“'}
          {section.text}
          {'”'}
        </p>
      </blockquote>
      {present(section.attribution) || source ? (
        <figcaption>
          <Paren signal>
            {section.attribution}
            {present(section.attribution) && source ? ', ' : null}
            {source}
          </Paren>
        </figcaption>
      ) : null}
    </figure>
  );
}

export function CustomRenderer({ section, input }: SectionRendererProps<Of<'custom'>>) {
  return (
    <div className="ss-custom">
      {present(section.body) ? <Prose source={section.body} input={input} /> : null}
      {section.items?.length ? (
        <ul className="ss-ruled">
          {section.items.map((item, index) => (
            <li key={index}>
              <p className="ss-strong" data-type-role="body">
                {item.title}
              </p>
              {present(item.summary) ? (
                <Prose source={item.summary} input={input} role="body-compact" />
              ) : null}
              {item.links?.length ? (
                <p className="ss-links" data-type-role="body-compact">
                  {item.links.map((link) => (
                    <a key={link.url} href={hrefFor(link.url, input)}>
                      {link.label ?? link.platform ?? link.url}
                      <Out href={link.url} />
                    </a>
                  ))}
                </p>
              ) : null}
              {(item.media ?? []).map((placement, i) => {
                const placed = placedImage(placement, input);
                if (!placed) return null;
                const caption = placement.caption ?? placed.alt;
                return (
                  <figure key={i} className="ss-custom__fig">
                    <Img placed={placed} input={input} sizes="(min-width: 48rem) 25vw, 100vw" />
                    {present(caption) ? (
                      <figcaption data-type-role="caption">{caption}</figcaption>
                    ) : null}
                  </figure>
                );
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Practice: the thesis as a statement, skill and tool groups four-up, services as a table. */
export function PracticeRenderer({ section, input }: SectionRendererProps<Of<'practice'>>) {
  const practice = input.portfolio.practice;
  const lang = uiLang(input.portfolio.locale);
  if (section.part === 'thesis') {
    if (!present(practice?.thesis)) return null;
    const { lead, rest } = firstSentence(plainInline(practice.thesis));
    return (
      <p className="ss-statement" data-type-role="quote">
        <strong data-type-role="headline">{lead}</strong>
        {rest ? ` ${rest}` : null}
      </p>
    );
  }
  if (section.part === 'services') {
    // A group the owner named heads its services as a row group of the table.
    const items = (practice?.services ?? []).flatMap((group) =>
      group.items.map((item) => ({ item, group: present(group.name) ? group.name : undefined })),
    );
    return (
      <RuledTable
        caption={section.title ?? 'Services'}
        lang={lang}
        columns={[
          { label: 'Engagement', span: 4 },
          { label: 'What it involves', span: 6, wide: true },
          { label: 'Enquire', span: 2, end: true },
        ]}
        rows={items.map(({ item, group }, index) => {
          const what = present(item.description) ? (
            <Prose source={item.description} input={input} role="body-compact" />
          ) : null;
          const points = (item.highlights ?? []).filter(present);
          const detail = (
            <>
              {what}
              {points.length ? (
                <ul className="ss-ruled ss-ruled--quiet">
                  {points.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </>
          );
          const enquire = item.url ? (
            <a href={hrefFor(item.url, input)}>
              <Words lang={lang}>{/^mailto:/i.test(item.url) ? 'Ask by email' : 'Details'}</Words>
              <Out href={item.url} />
            </a>
          ) : null;
          return {
            key: String(index),
            ...(group ? { group } : {}),
            cells: [
              <>
                <span className="ss-strong" data-type-role="body">
                  {item.name}
                </span>
                {present(item.pricing) ? <span className="ss-sub">{item.pricing}</span> : null}
              </>,
              detail,
              enquire,
            ],
            narrow: detail,
          };
        })}
      />
    );
  }
  const groups =
    section.part === 'skills'
      ? (practice?.skills ?? []).map((group) => ({
          name: group.name,
          description: group.description,
          items: group.items.map((name) => ({
            name,
            version: undefined as string | undefined,
            url: undefined as string | undefined,
          })),
        }))
      : (practice?.tools ?? []).map((group) => ({
          name: group.name,
          description: group.description,
          items: group.items.map((item) => ({
            name: item.name,
            version: item.version,
            url: item.url,
          })),
        }));
  return (
    <ul className="ss-groups">
      {groups.map((group, index) => (
        <li key={index} className="ss-group">
          {present(group.name) ? <h4 data-type-role="title">{group.name}</h4> : null}
          {present(group.description) ? (
            <p className="ss-group__aside" data-type-role="body-compact">
              <Paren>{group.description}</Paren>
            </p>
          ) : null}
          <ul className="ss-ruled" data-type-role="body-compact">
            {group.items.map((item, i) => (
              <li key={i}>
                <span>
                  {item.url ? (
                    <a href={hrefFor(item.url, input)}>
                      {item.name}
                      <Out href={item.url} />
                    </a>
                  ) : (
                    item.name
                  )}
                </span>
                {item.version ? <span className="ss-muted ss-num">{item.version}</span> : null}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
