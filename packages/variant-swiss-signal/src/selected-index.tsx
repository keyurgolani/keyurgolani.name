import type { Work } from '@portfolio/schema';
import { anchorSection, pageOutline, recordAnchor, worksOf } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { readyImage, Img } from './media';
import {
  formatNumber,
  hasCaseStudy,
  mediumWord,
  partsOf,
  proofOf,
  selectedWorks,
  workWhen,
} from './model';
import { ownId, Paren, uiLang, Words } from './parts';

// The selected index (brief §5.1, the poster's proof): the curation as a
// ruled, numbered list, each row a thumbnail, the title linking its case
// study or its row in the works index, its medium and years, and one proof
// right-aligned in tabular figures.

/** Where a work's title links: its own page, else its row on this page, else its own address. */
export function workHref(work: Work, input: VariantRenderInput): string | undefined {
  if (hasCaseStudy(work)) return routeHref(input, { route: 'work', slug: work.slug! });
  const section = anchorSection(work, input);
  const anchor = section ? recordAnchor(section, work, input) : undefined;
  if (anchor) return `#${anchor}`;
  return work.url ?? work.links?.[0]?.url;
}

export function SelectedIndex({ input }: { input: VariantRenderInput }) {
  const works = selectedWorks(input);
  if (works.length === 0) return null;
  const lang = uiLang(input.portfolio.locale);
  const heading = ownId(input.ids.prefix, 'selected');
  const work = partsOf(input, () => pageOutline(input)).find((part) => part.id === 'work');
  const total = work
    ? work.sections.reduce((sum, section) => sum + worksOf(section, input).length, 0)
    : 0;
  return (
    <section className="ss-sel" aria-labelledby={heading}>
      <div className="ss-sel__head">
        <h2 id={heading} data-type-role="label">
          <Words lang={lang}>Selected work</Words>
        </h2>
        {work && total > works.length ? (
          <a href={`#${ownId(input.ids.prefix, 'part-work')}`} data-type-role="body-compact">
            <Words lang={lang}>All work</Words>{' '}
            <Paren>{formatNumber(total, input.portfolio.locale)}</Paren>
          </a>
        ) : null}
      </div>
      <ol className="ss-sel__list">
        {works.map((item, index) => {
          const href = workHref(item, input);
          const thumb = readyImage(item.cover ?? item.media?.[0], input);
          const medium = mediumWord(item);
          const when = workWhen(item);
          const proof = proofOf(input, item);
          return (
            <li key={item.id} className="ss-sel__row" data-thumb={thumb ? '' : undefined}>
              <span className="ss-sel__no" data-type-role="numeric" aria-hidden="true">
                {formatNumber(index + 1, input.portfolio.locale)}
              </span>
              {thumb ? (
                <span className="ss-sel__thumb">
                  <Img placed={thumb} input={input} sizes="6rem" decorative eager={index === 0} />
                </span>
              ) : null}
              <p className="ss-sel__title" data-type-role="body" lang={item.lang}>
                {href ? <a href={href}>{item.title}</a> : item.title}
              </p>
              {medium || when ? (
                <p className="ss-sel__meta" data-type-role="body-compact">
                  {medium ? <Words lang={lang}>{medium}</Words> : null}
                  {medium && when ? ', ' : null}
                  {when ? (
                    <span className="ss-num">
                      {when.open ? <Words lang={lang}>{when.text}</Words> : when.text}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {proof ? (
                <p className="ss-sel__proof ss-num" data-type-role="body-compact">
                  {proof.own ? <Words lang={lang}>{proof.text}</Words> : proof.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
