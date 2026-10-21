import type { Press, Quote, Testimonials } from '@portfolio/schema';
import {
  ContentImage,
  DateText,
  deeper,
  Heading,
  hrefFor,
  MaybeLink,
  Meta,
  NamedLinks,
  renderContext,
  SectionHeader,
  Ui,
} from '../primitives';
import type { SectionRendererProps } from '../types';

export function TestimonialsSection({ section, input, level }: SectionRendererProps<Testimonials>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Testimonials" />
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <figure className="pf-quote">
              <blockquote
                cite={item.sourceUrl !== undefined ? hrefFor(item.sourceUrl, input) : undefined}
              >
                <p>{item.quote}</p>
              </blockquote>
              <figcaption>
                {item.authorAvatar ? (
                  <ContentImage image={item.authorAvatar} className="pf-avatar" inline />
                ) : null}
                <Meta
                  parts={[
                    <MaybeLink key="author" url={item.authorUrl} ctx={ctx}>
                      {item.author}
                    </MaybeLink>,
                    item.authorRole,
                    item.authorOrganization,
                  ]}
                />
                <NamedLinks links={[['Source', item.sourceUrl]]} ctx={ctx} />
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PressSection({ section, input, level }: SectionRendererProps<Press>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} fallback="Press" />
      <ul className="pf-list">
        {section.items.map((item, index) => (
          <li key={index} className="pf-item">
            <Heading level={deeper(level)} className="pf-item__title">
              <MaybeLink url={item.url} ctx={ctx}>
                {item.title}
              </MaybeLink>
            </Heading>
            <Meta
              parts={[
                item.publication,
                item.author !== undefined && (
                  <span key="author">
                    <Ui ctx={ctx}>By</Ui> {item.author}
                  </span>
                ),
                item.publishedAt !== undefined && (
                  <DateText key="published" raw={item.publishedAt} ctx={ctx} />
                ),
              ]}
            />
            {item.excerpt !== undefined ? (
              <blockquote className="pf-excerpt">
                <p>{item.excerpt}</p>
              </blockquote>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** One quote, standing alone, so it has no heading unless it has a title. */
export function QuoteSection({ section, input, level }: SectionRendererProps<Quote>) {
  const ctx = renderContext(input, section, level);
  const cite = section.sourceUrl !== undefined ? hrefFor(section.sourceUrl, input) : undefined;
  const hasCaption = section.attribution !== undefined || section.source !== undefined;
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <figure className="pf-quote">
        <blockquote cite={cite}>
          <p>{section.text}</p>
        </blockquote>
        {hasCaption || section.sourceUrl !== undefined ? (
          <figcaption>
            <Meta
              parts={[
                section.attribution,
                section.source !== undefined && (
                  <cite key="source">
                    <MaybeLink url={section.sourceUrl} ctx={ctx}>
                      {section.source}
                    </MaybeLink>
                  </cite>
                ),
              ]}
            />
            {section.source === undefined ? (
              <NamedLinks links={[['Source', section.sourceUrl]]} ctx={ctx} />
            ) : null}
          </figcaption>
        ) : null}
      </figure>
    </>
  );
}
