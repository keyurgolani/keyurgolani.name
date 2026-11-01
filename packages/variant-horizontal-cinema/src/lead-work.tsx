import type { Evidence, Work } from '@portfolio/schema';
import {
  DateText,
  evidenceByIds,
  isRoutedWork,
  LinkText,
  MediaFigure,
  placedMedia,
  present,
  renderContext,
  type HeadingLevel,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { mediumLabel } from './model';
import { ownId, uiLang, Words, yearOf } from './parts';

// The signature work's frame (redesign, scene 2): its still across seven
// columns with the press beneath it, and its words in a column of four,
// the medium and the year it started, the title at display size, the
// summary, the highlights as ruled rows, then the case study and the
// work's own links. It's the work again, not its record: the works section
// that lists it renders in Journey and keeps its anchor, so this article
// takes an id of the composition's own.

/** How wide the still shows, for the renditions a browser picks. */
const SIZES = '(min-width: 64rem) 55vw, 100vw';

/** The first evidence with words to quote: press with an excerpt, or a testimonial. */
function quoted(evidence: readonly Evidence[]): Evidence | undefined {
  return evidence.find(
    (entry) =>
      (entry.type === 'press' && present(entry.excerpt)) ||
      (entry.type === 'testimonial' && present(entry.statement)),
  );
}

/** A piece of evidence as one ruled row: what it is, who gave it, and when. */
function rowOf(entry: Evidence): string {
  const parts: (string | undefined)[] = [entry.title];
  if (entry.type === 'award') parts.push(entry.organization, entry.receivedAt);
  if (entry.type === 'press') parts.push(entry.publication);
  return parts.filter(present).join(', ');
}

export function LeadWork({
  work,
  input,
  level,
}: {
  work: Work;
  input: VariantRenderInput;
  /** The level of its title. */
  level: HeadingLevel;
}) {
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: 'lead' }, level);
  const lang = uiLang(input.portfolio.locale);
  const titleId = ownId(input.ids.prefix, `lead-${work.id}`);
  const Title = `h${level}` as const;
  const placements = [...(work.cover ? [work.cover] : []), ...(work.media ?? [])];
  const stills = placements.flatMap((placement) => {
    const placed = placedMedia(placement, ctx);
    return placed && !placed.decorative ? [{ placement, placed }] : [];
  });
  const still = stills[0];
  const year = yearOf(work.period?.start ?? work.publishedAt);
  const evidence = evidenceByIds(work.evidence, input);
  const quote = quoted(evidence);
  const rows = [
    ...(work.highlights ?? []),
    ...evidence.filter((entry) => entry !== quote && present(entry.title)).map(rowOf),
  ];
  const medium = mediumLabel(work);
  const study = isRoutedWork(work)
    ? routeHref(input, { route: 'work', slug: work.slug })
    : undefined;
  const links = [...(present(work.url) ? [{ url: work.url }] : []), ...(work.links ?? [])];
  return (
    <article
      className="hc-lead"
      data-media={still ? 'image' : 'none'}
      aria-labelledby={titleId}
      lang={work.lang}
    >
      {still ? (
        <div className="hc-lead__still hc-still">
          <MediaFigure
            placed={{
              ...still.placed,
              caption: (
                <span className="hc-cap">
                  <span className="hc-cap__words">
                    {present(still.placement.caption) ? (
                      still.placement.caption
                    ) : (
                      <>
                        <strong>{work.title}</strong>
                        {work.tools?.length ? `, in ${work.tools.join(', ')}` : null}
                      </>
                    )}
                  </span>
                  {year ? <span>{year}</span> : null}
                </span>
              ),
            }}
            ctx={ctx}
            eager
            sizes={SIZES}
          />
        </div>
      ) : null}
      {quote ? (
        <blockquote className="hc-lead__press">
          <p data-type-role="title">
            {'“'}
            {quote.type === 'press'
              ? quote.excerpt
              : quote.type === 'testimonial'
                ? quote.statement
                : ''}
            {'”'}
          </p>
          <footer data-type-role="label">
            {quote.type === 'press' ? (
              <>
                {present(quote.author) ? quote.author : null}
                {present(quote.author) && present(quote.publication) ? ', ' : null}
                {present(quote.publication) ? <cite>{quote.publication}</cite> : null}
                {present(quote.publishedAt) ? (
                  <>
                    {', '}
                    <DateText raw={quote.publishedAt} ctx={ctx} />
                  </>
                ) : null}
              </>
            ) : quote.type === 'testimonial' ? (
              [quote.source?.name, quote.source?.role, quote.source?.organization]
                .filter(present)
                .join(', ')
            ) : null}
          </footer>
        </blockquote>
      ) : null}
      <div className="hc-lead__words">
        {medium || work.period ? (
          <p className="hc-lead__medium" data-type-role="label">
            {medium ? <Words lang={lang}>{medium}</Words> : null}
            {medium && work.period ? ', ' : null}
            {work.period ? (
              <>
                <Words lang={lang}>{work.period.end ? 'from' : 'since'}</Words>{' '}
                <DateText raw={work.period.start} ctx={ctx} />
              </>
            ) : null}
          </p>
        ) : null}
        <Title id={titleId} className="hc-lead__title" data-type-role="display">
          {work.title}
        </Title>
        {present(work.summary) ? (
          <p className="hc-lead__summary" data-type-role="title">
            {work.summary}
          </p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="hc-rules hc-lead__rows" role="list">
            {rows.map((row, index) => (
              <li key={index}>{row}</li>
            ))}
          </ul>
        ) : null}
        {study !== undefined ? (
          <a className="hc-lead__study" href={study} data-type-role="title">
            <Words lang={lang}>Read the case study</Words>
            <span className="hc-visually-hidden">{`: ${work.title}`}</span>
          </a>
        ) : null}
        {links.length > 0 ? (
          <p className="hc-lead__links" data-type-role="body-compact">
            {links.map((link, index) => (
              <LinkText key={index} link={link} ctx={ctx} />
            ))}
          </p>
        ) : null}
      </div>
    </article>
  );
}
