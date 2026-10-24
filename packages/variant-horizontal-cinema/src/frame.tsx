import type { Work } from '@portfolio/schema';
import { Surface } from '@portfolio/appearance/primitives';
import {
  EvidenceEntry,
  evidenceByIds,
  isSignature,
  LinkText,
  MediaFigure,
  placedMedia,
  renderContext,
  RichText,
  type HeadingLevel,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { contentAnchor, mediumLabel, present } from './model';
import { ownId, uiLang, Words } from './parts';

// A frame (#17): one work as a framed scene, its media beside its
// evidence. The media is the work's cover, else the first image it
// places, never decoration: a decorative image is ambience, never the
// thing a frame shows. It sits on a matte, #19's Surface, so a design
// language whose texture is grain grains the matte and nothing else, and
// its words, the caption, the credit, and the rights, are the owner's, as
// #10 holds them, below it, so the figure reads on its own. The evidence
// the work cites reads beside it, and on its own too: an image that never
// arrives keeps its box and its label, and the title, the evidence, and the
// links stay where they were. A work with nothing to show is a text frame,
// with no empty matte.

/** How wide a frame's media shows, for the renditions a browser picks. */
const SIZES = '(min-width: 64rem) 50vw, 100vw';

export function Frame({
  work,
  input,
  level,
  eager,
}: {
  work: Work;
  input: VariantRenderInput;
  /** The level of its title. */
  level: HeadingLevel;
  /** Load its media at once: Prologue's lead frame alone, which the first view shows. */
  eager: boolean;
}) {
  const ctx = renderContext(input, { id: work.id, lang: work.lang, title: 'frame' }, level);
  const lang = uiLang(input.portfolio.locale);
  const titleId = ownId(input.ids.prefix, `frame-${work.id}`);
  const Title = `h${level}` as const;
  // The first meaningful image the work places, the cover first.
  const placements = [...(work.cover ? [work.cover] : []), ...(work.media ?? [])];
  const media = placements
    .map((placement) => placedMedia(placement, ctx))
    .find((placed) => placed !== undefined && !placed.decorative);
  const evidence = evidenceByIds(work.evidence, input);
  const nested = { ...ctx, level: level < 6 ? ((level + 1) as HeadingLevel) : level };
  const medium = mediumLabel(work);
  const meta = [work.role, work.organization].filter(present);
  const study =
    work.caseStudy !== undefined && work.slug !== undefined
      ? routeHref(input, { route: 'work', slug: work.slug })
      : undefined;
  const links = [...(present(work.url) ? [{ url: work.url }] : []), ...(work.links ?? [])];

  return (
    <article
      id={contentAnchor(input, work.id)}
      className="hc-frame"
      data-work-id={work.id}
      data-media={media ? 'image' : 'none'}
      aria-labelledby={titleId}
      lang={work.lang}
    >
      {media ? (
        <Surface
          emphasis={isSignature(work, input) ? 'prominent' : 'subtle'}
          className="hc-frame__matte"
        >
          <MediaFigure
            placed={media}
            ctx={ctx}
            className="hc-frame__image"
            eager={eager}
            sizes={SIZES}
          />
        </Surface>
      ) : null}
      <div className="hc-frame__words">
        {medium ? (
          <p className="hc-frame__medium" data-type-role="label">
            <Words lang={lang}>{medium}</Words>
          </p>
        ) : null}
        <Title id={titleId} className="hc-frame__title" data-type-role="headline">
          {work.title}
        </Title>
        {meta.length > 0 ? (
          <p className="hc-frame__meta" data-type-role="caption">
            {meta.join(' · ')}
          </p>
        ) : null}
        {present(work.summary) ? (
          <div className="hc-frame__summary">
            <RichText source={work.summary} input={input} />
          </div>
        ) : null}
        {evidence.length > 0 ? (
          <ul className="pf-evidence hc-frame__evidence" role="list">
            {evidence.map((entry) => (
              <EvidenceEntry key={entry.id} entry={entry} ctx={nested} />
            ))}
          </ul>
        ) : null}
        {study !== undefined || links.length > 0 ? (
          <ul className="hc-frame__links" role="list">
            {study !== undefined ? (
              <li>
                <a href={study}>
                  <Words lang={lang}>Case study</Words>
                  <span className="hc-visually-hidden">{`: ${work.title}`}</span>
                </a>
              </li>
            ) : null}
            {links.map((link, index) => (
              <li key={index}>
                <LinkText link={link} ctx={ctx} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
