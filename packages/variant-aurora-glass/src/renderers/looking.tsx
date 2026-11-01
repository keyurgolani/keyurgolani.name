import type { Placement, Section, Work } from '@portfolio/schema';
import { recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { formatNumber, present, squash } from '../model';
import { Img, Out, Phrase, readyImage, uiLang, Words } from '../parts';
import { workHref } from './work-href';

// The Looking stage (brief §5.2): image series and photography as the one
// place the page gives a photograph the full width of the band. The first
// image leads at full bleed, the next two sit beside each other as frames,
// and the rest run as a strip. Each keeps the owner's caption and credit
// under one caption system (the kit's figure). The series' title and
// summary sit in the band's lite above it.

type Works = Extract<Section, { kind: 'works' }>;

/** The place a photograph was taken, as a caption line under it. */
function Where({ place }: { place: string | undefined }) {
  return present(place) ? (
    <p className="ag-looking__where" data-type-role="caption">
      {place}
    </p>
  ) : null;
}

export function Looking({
  works,
  section,
  input,
}: {
  works: readonly Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  const lang = uiLang(input.portfolio.locale);
  return (
    <>
      {works.map((work) => {
        const href = workHref(work, input);
        const placements = [work.cover, ...(work.media ?? [])].filter(
          (each, index, all): each is Placement =>
            each !== undefined && all.findIndex((other) => other?.asset === each.asset) === index,
        );
        const images = placements.flatMap((placement) => {
          const placed = readyImage(placement, input);
          return placed ? [placed] : [];
        });
        // Where each photograph was taken, the owner's own line under it (the content sweep).
        const whereOf = new Map(
          placements
            .filter((each) => present(each.location))
            .map((each) => [each.asset, each.location!]),
        );
        // A photograph that isn't ready to show still has the owner's words: its caption and place, as text.
        const unshown = placements.filter(
          (each) => !readyImage(each, input) && (present(each.caption) || present(each.location)),
        );
        const [lead, ...others] = images;
        const frames = others.slice(0, 2);
        const strip = others.slice(2);
        const summary = work.summary ?? work.description;
        // A series titled as its section would only say the heading again: no h4, the count is its caption.
        const echoes =
          present(section.title) &&
          squash(section.title).toLocaleLowerCase() === squash(work.title).toLocaleLowerCase();
        const count =
          images.length > 1 ? (
            <Words
              lang={lang}
            >{`${formatNumber(images.length, input.portfolio.locale)} photographs`}</Words>
          ) : null;
        return (
          <article
            key={work.id}
            className="ag-looking"
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            <header className="ag-looking__note">
              {echoes ? null : (
                <h4 className="ag-row__title" data-type-role="title">
                  {href ? (
                    <a href={href}>
                      {work.title}
                      <Out href={href} />
                    </a>
                  ) : (
                    work.title
                  )}
                </h4>
              )}
              {present(summary) ? (
                <p className="ag-row__sum" data-type-role="body-compact">
                  <Phrase source={summary} input={input} />
                </p>
              ) : null}
              {count || (echoes && href) ? (
                <p className="ag-row__foot" data-type-role="caption">
                  {echoes && href ? (
                    <a href={href}>
                      {/* The link says what it opens: the series' title, hidden since the heading shows it, then the count. */}
                      {count ? (
                        <>
                          <span className="ag-hidden">{`${work.title}, `}</span>
                          {count}
                        </>
                      ) : (
                        work.title
                      )}
                      <Out href={href} />
                    </a>
                  ) : (
                    count
                  )}
                </p>
              ) : null}
            </header>
            {lead ? (
              <div className="ag-looking__lead">
                <Img
                  placed={lead}
                  input={input}
                  sizes="100vw"
                  inline={false}
                  className="ag-looking__img"
                />
                <Where place={whereOf.get(lead.asset)} />
              </div>
            ) : null}
            {frames.length > 0 ? (
              <div className="ag-looking__frames" data-count={String(frames.length)}>
                {frames.map((placed) => (
                  <div key={placed.asset} className="ag-looking__frame">
                    <Img
                      placed={placed}
                      input={input}
                      sizes="(min-width: 48rem) 50vw, 100vw"
                      inline={false}
                      className="ag-looking__img"
                    />
                    <Where place={whereOf.get(placed.asset)} />
                  </div>
                ))}
              </div>
            ) : null}
            {strip.length > 0 ? (
              <div className="ag-looking__strip" role="list">
                {strip.map((placed) => (
                  <div key={placed.asset} role="listitem">
                    <Img
                      placed={placed}
                      input={input}
                      sizes="(min-width: 48rem) 20vw, 50vw"
                      inline={false}
                      className="ag-looking__img"
                    />
                    <Where place={whereOf.get(placed.asset)} />
                  </div>
                ))}
              </div>
            ) : null}
            {unshown.length > 0 ? (
              <ul className="ag-rows ag-looking__unshown" role="list">
                {unshown.map((placement, index) => (
                  <li key={`${placement.asset}-${index}`} className="ag-row">
                    {present(placement.caption) ? (
                      <p className="ag-row__title" data-type-role="body-compact">
                        {placement.caption}
                      </p>
                    ) : null}
                    {present(placement.location) ? (
                      <p className="ag-row__where" data-type-role="caption">
                        {placement.location}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </>
  );
}
