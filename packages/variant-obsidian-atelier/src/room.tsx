import { Disclosure, Surface } from '@portfolio/appearance/primitives';
import {
  isSignature,
  MediaFigure,
  placedMedia,
  renderContext,
  RichText,
  type PlacedImage,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { Case, hasCase } from './case';
import { mediumLabel, present, treatmentOf, type Chapter, type Treatment } from './model';
import { ownId, Words } from './parts';

// A chapter's room (#15): one work, its medium's own way. The room's
// header holds where the chapter is, its medium, its title, and its premise
// in a narrow analytical column; the artifact takes the room's full width
// beside or below it; and the rest of the case is behind Unfold the case, a
// native details element, closed on the server. Plain previous, index, and
// next links end it.
//
// The artifact is the work's cover, else the first image it places, and
// how it shows comes from the work's authored medium alone: a photograph is
// a plate across the room, an interface a screen on a matte, a system or
// research a diagram on a matte, writing its own excerpt, and anything else
// an object on a matte. None is cropped: each keeps its own aspect, within
// the room's height, so a portrait, a panorama, a transparent image, a page
// of text, and a small image all read whole. Its words, the alt text, the
// caption, the credit, and the rights, are the owner's, as #10 holds them,
// and sit below it, never over it. A work with no artifact is a text room:
// nothing reserves an empty frame for it.

/** How wide the artifact shows, for the renditions a browser picks. */
const SIZES: Readonly<Record<Treatment, string>> = {
  plate: '100vw',
  screen: '(min-width: 64rem) 66vw, 100vw',
  diagram: '(min-width: 64rem) 66vw, 100vw',
  object: '(min-width: 64rem) 50vw, 100vw',
  text: '(min-width: 64rem) 40vw, 100vw',
};

/** A link to another chapter, by its title. */
function Step({
  chapter,
  rel,
  input,
}: {
  chapter: Chapter | undefined;
  rel: 'Previous' | 'Next';
  input: VariantRenderInput;
}) {
  if (!chapter) return null;
  return (
    <li className={`oa-pager__${rel.toLowerCase()}`}>
      <a href={`#${chapter.anchor}`}>
        <span className="oa-pager__label" data-type-role="label">
          <Words input={input}>{rel}</Words>
        </span>{' '}
        <span className="oa-pager__title" lang={chapter.work.lang}>
          {chapter.work.title}
        </span>
      </a>
    </li>
  );
}

export function Room({
  chapter,
  total,
  previous,
  next,
  input,
}: {
  chapter: Chapter;
  total: number;
  previous: Chapter | undefined;
  next: Chapter | undefined;
  input: VariantRenderInput;
}) {
  const { work } = chapter;
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: 'room' }, 2);
  const treatment = treatmentOf(work);
  const titleId = ownId(input, `title-${work.id}`);
  const medium = mediumLabel(work);

  // Every image placement the work has, the cover first, so the case shows each once.
  const placements = [...(work.cover ? [work.cover] : []), ...(work.media ?? [])];
  const images = placements.flatMap((placement) => {
    const placed = placedMedia(placement, ctx);
    return placed ? [placed] : [];
  });
  const leadExcerpt = treatment === 'text' && present(work.excerpt);
  const artifact: PlacedImage | undefined = leadExcerpt ? undefined : images[0];
  const media = artifact ? images.slice(1) : images;
  const shape = leadExcerpt ? 'excerpt' : artifact ? 'image' : 'none';
  const meta = [work.role, work.organization, work.publication].filter(present);

  return (
    <article
      id={chapter.anchor}
      className="oa-room"
      data-treatment={treatment}
      data-medium={work.medium}
      data-artifact={shape}
      aria-labelledby={titleId}
    >
      <Surface
        emphasis={isSignature(work, input) ? 'prominent' : 'subtle'}
        className="oa-room__premise"
      >
        <p className="oa-room__position" data-type-role="label">
          <Words input={input}>{`Chapter ${chapter.number} of ${total}`}</Words>
          {medium ? (
            <>
              {' '}
              <span aria-hidden="true">·</span>{' '}
              <span className="oa-room__medium">
                <Words input={input}>{medium}</Words>
              </span>
            </>
          ) : null}
        </p>
        <h2 id={titleId} className="oa-room__title" data-type-role="headline" lang={work.lang}>
          {work.title}
        </h2>
        {meta.length > 0 ? (
          <p className="oa-room__meta" data-type-role="caption" lang={work.lang}>
            {meta.map((part, index) => (
              <span key={index}>
                {index > 0 ? (
                  <>
                    {' '}
                    <span aria-hidden="true">·</span>{' '}
                  </>
                ) : null}
                {part}
              </span>
            ))}
          </p>
        ) : null}
        {present(work.summary) ? (
          <div className="oa-room__summary" lang={work.lang}>
            <RichText source={work.summary} input={input} />
          </div>
        ) : null}
      </Surface>
      {shape === 'excerpt' ? (
        <div className="oa-room__artifact" lang={work.lang}>
          <blockquote className="oa-room__excerpt" data-type-role="quote">
            <RichText source={work.excerpt!} input={input} />
          </blockquote>
        </div>
      ) : artifact ? (
        <div className="oa-room__artifact" lang={work.lang}>
          <MediaFigure
            placed={artifact}
            ctx={ctx}
            className="oa-room__image"
            eager={chapter.number === 1}
            sizes={SIZES[treatment]}
          />
        </div>
      ) : null}
      {hasCase(work, media, leadExcerpt) ? (
        <Disclosure
          className="oa-room__case"
          summary={<Words input={input}>Unfold the case</Words>}
        >
          <Case work={work} ctx={ctx} media={media} leadExcerpt={leadExcerpt} level={3} />
        </Disclosure>
      ) : null}
      <ul className="oa-pager" role="list">
        <Step chapter={previous} rel="Previous" input={input} />
        <li className="oa-pager__index">
          <a href={`#${ownId(input, 'index')}`}>
            <Words input={input}>Index</Words>
          </a>
        </li>
        <Step chapter={next} rel="Next" input={input} />
      </ul>
    </article>
  );
}
