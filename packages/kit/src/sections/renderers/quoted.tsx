import type { Quote } from '@portfolio/schema';
import {
  hostLabel,
  hrefFor,
  MaybeLink,
  Meta,
  present,
  renderContext,
  SectionHeader,
} from '../primitives';
import type { SectionRendererProps } from '../types';

/**
 * One quote, standing alone, so it has no heading unless it has a title.
 * Its source links where the owner says: the source's name when there is
 * one, else the attribution, else the address's host, never a word the
 * renderer adds. The quote is set off by its type role, not by an indent.
 */
export function QuoteSection({ section, input, level }: SectionRendererProps<Quote>) {
  const ctx = renderContext(input, section, level);
  const url = section.sourceUrl;
  const cite = url !== undefined ? hrefFor(url, input) : undefined;
  const source = present(section.source) ? section.source : undefined;
  const attribution = present(section.attribution) ? section.attribution : undefined;
  const parts = [
    attribution !== undefined && (
      <MaybeLink key="attribution" url={source === undefined ? url : undefined} ctx={ctx}>
        {attribution}
      </MaybeLink>
    ),
    source !== undefined && (
      <cite key="source">
        <MaybeLink url={url} ctx={ctx}>
          {source}
        </MaybeLink>
      </cite>
    ),
    attribution === undefined && source === undefined && url !== undefined && (
      <a key="url" href={cite}>
        {hostLabel(url)}
      </a>
    ),
  ];
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <figure className="pf-quote">
        <blockquote cite={cite} data-type-role="quote">
          <p>{section.text}</p>
        </blockquote>
        {attribution !== undefined || source !== undefined || url !== undefined ? (
          <figcaption>
            <Meta parts={parts} />
          </figcaption>
        ) : null}
      </figure>
    </>
  );
}
