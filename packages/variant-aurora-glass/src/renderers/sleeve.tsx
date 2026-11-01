import type { Section, Work } from '@portfolio/schema';
import { recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { present, yearOf } from '../model';
import { Img, LinkLine, Out, Phrase, readyImage, Tracks } from '../parts';
import { Sheet } from '../surfaces/sheet';
import { workHref } from './work-href';

// The sleeve (brief §5.2): music as its cover on a sheet beside the track
// list, numbered because a record's order is real, each track's length in
// tabular figures.

type Works = Extract<Section, { kind: 'works' }>;

export function Sleeve({
  works,
  section,
  input,
}: {
  works: readonly Work[];
  section: Works;
  input: VariantRenderInput;
}) {
  return (
    <>
      {works.map((work) => {
        const href = workHref(work, input);
        const cover = readyImage(work.cover ?? work.media?.[0], input);
        const tracks = work.tracks ?? [];
        const summary = work.summary ?? work.description;
        const year = yearOf(work.releasedAt);
        return (
          <article
            key={work.id}
            className={cover ? 'ag-sleeve' : 'ag-sleeve ag-sleeve--text'}
            id={recordAnchor(section, work, input)}
            lang={work.lang}
          >
            {cover ? (
              <Sheet as="div" className="ag-sleeve__cover">
                <Img
                  placed={cover}
                  input={input}
                  sizes="(min-width: 48rem) 20rem, 60vw"
                  className="ag-sleeve__img"
                />
              </Sheet>
            ) : null}
            <div className="ag-sleeve__body">
              <h4 className="ag-row__title" data-type-role="headline">
                {href ? (
                  <a href={href}>
                    {work.title}
                    <Out href={href} />
                  </a>
                ) : (
                  work.title
                )}
              </h4>
              {present(work.artist) || present(work.label) || present(work.role) || year ? (
                <p className="ag-row__foot" data-type-role="caption">
                  {present(work.artist) ? <span>{work.artist}</span> : null}
                  {present(work.role) ? <span>{work.role}</span> : null}
                  {present(work.label) ? <span>{work.label}</span> : null}
                  {year ? <span className="ag-num">{year}</span> : null}
                </p>
              ) : null}
              {present(summary) ? (
                <p className="ag-row__sum" data-type-role="body-compact">
                  <Phrase source={summary} input={input} />
                </p>
              ) : null}
              <Tracks tracks={tracks} input={input} />
              <LinkLine links={work.links} input={input} />
            </div>
          </article>
        );
      })}
    </>
  );
}
