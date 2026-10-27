import type { Work } from '@portfolio/schema';
import { routeHref } from '@portfolio/variant-contract';
import { formatEpisodeDuration, formatTrackDuration } from '../../format';
import { MediaFigure } from '../media';
import { placedMedia } from '../placement';
import {
  DateText,
  deeper,
  formatFigure,
  formatMinutes,
  formatNames,
  hostLabelled,
  Heading,
  labelParts,
  LinkRow,
  MaybeLink,
  Meta,
  PeriodText,
  present,
  renderContext,
  SectionHeader,
  TagList,
  Ui,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';
import {
  evidenceByIds,
  isArchived,
  isRoutedWork,
  isSignature,
  recordAnchor,
  worksOf,
} from '../view';
import { EvidenceEntry } from './evidence';

// The works a works section lists, in its order (#10, slice 1, item 7).
// The shared renderer doesn't reorder them: the featured order and the proof
// strip are a composition's to use. An entry reads title, meta line,
// summary, then its cover and the rest, so what a work is comes before what
// it shows. A work in the portfolio's archive says so, with the fixed label
// Archive, first in its meta line, where its tools and tags fold in too.
// Its cover loads lazily unless it's the signature work's. A case study
// isn't linked until its route serves it; once it is, the title is that
// link, its target grown by padding, the cover links there too as a hidden
// duplicate, the entry's text stays selectable, and the work's own address
// joins its links.

/** The work's own media placements, each with its caption and, for a photo, when and where. */
function WorkMedia({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const placed = (work.media ?? []).flatMap((placement) => {
    const image = placedMedia(placement, ctx);
    return image ? [image] : [];
  });
  if (placed.length === 0) return null;
  return (
    <ul className="pf-gallery" role="list">
      {placed.map((image, index) => (
        <li key={`${image.asset}-${index}`}>
          <MediaFigure placed={image} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

/** The evidence the work cites, each as an evidence section shows it, below the work's heading. */
function WorkEvidence({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const entries = evidenceByIds(work.evidence, ctx.input);
  if (entries.length === 0) return null;
  const nested: RenderContext = { ...ctx, itemLevel: deeper(ctx.itemLevel) };
  return (
    <ul className="pf-evidence" role="list">
      {entries.map((entry) => (
        <EvidenceEntry key={entry.id} entry={entry} ctx={nested} />
      ))}
    </ul>
  );
}

/** A release's tracks, in order, each with its length. */
function Tracks({ work, ctx }: { work: Work; ctx: RenderContext }) {
  if (!work.tracks?.length) return null;
  return (
    <ol className="pf-tracks">
      {work.tracks.map((track, index) => (
        <li key={index}>
          <MaybeLink url={track.url} ctx={ctx}>
            {track.title}
          </MaybeLink>
          {track.durationSeconds !== undefined ? (
            <>
              {' '}
              <span className="pf-track__duration">
                {formatTrackDuration(track.durationSeconds)}
              </span>
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** One work, as a list item whose id is the work's on the first section that lists it. */
export function WorkEntry({
  work,
  ctx,
  anchor,
}: {
  work: Work;
  ctx: RenderContext;
  anchor?: string;
}) {
  const { input } = ctx;
  const cover = placedMedia(work.cover, ctx);
  // A work with a case study links its title there, and its cover as a
  // duplicate out of the tab order, named by its alt (MediaFigure's link);
  // its own address joins its links. Any other links its title to its address.
  const caseStudy = caseStudyHref(work, ctx);
  return (
    <li
      id={anchor}
      className={caseStudy !== undefined ? 'pf-item pf-work pf-work--linked' : 'pf-item pf-work'}
      data-work-id={work.id}
      data-medium={work.medium}
      lang={work.lang}
    >
      {present(work.title) ? (
        <Heading level={ctx.itemLevel} className="pf-item__title">
          {caseStudy !== undefined ? (
            <a className="pf-stretch" href={caseStudy}>
              {work.title}
            </a>
          ) : (
            <MaybeLink url={work.url} ctx={ctx}>
              {work.title}
            </MaybeLink>
          )}
        </Heading>
      ) : null}
      <Meta
        parts={[
          isArchived(work, input) && (
            <span key="archive" className="pf-label" data-label="archive">
              <Ui ctx={ctx}>Archive</Ui>
            </span>
          ),
          work.role,
          work.organization,
          work.artist,
          work.series,
          work.number !== undefined && (
            <data key="number" className="pf-work__number" value={work.number}>
              {formatFigure(work.number, ctx)}
            </data>
          ),
          work.publication,
          work.label,
          work.period && <PeriodText key="period" period={work.period} ctx={ctx} />,
          work.publishedAt !== undefined && (
            <DateText key="published" raw={work.publishedAt} ctx={ctx} field="publishedAt" />
          ),
          work.releasedAt !== undefined && (
            <DateText key="released" raw={work.releasedAt} ctx={ctx} field="releasedAt" />
          ),
          work.readingTimeMinutes !== undefined && (
            <span key="reading" data-field="readingTimeMinutes">
              {formatMinutes(work.readingTimeMinutes, ctx)}
            </span>
          ),
          work.durationMinutes !== undefined && (
            <Ui key="duration" ctx={ctx}>
              {formatEpisodeDuration(work.durationMinutes)}
            </Ui>
          ),
          work.guests?.length ? (
            <span key="guests" data-field="guests">
              {formatNames(work.guests, ctx)}
            </span>
          ) : null,
          ...labelParts(work.tools, 'tools', ctx),
          ...labelParts(work.tags, 'tags', ctx),
        ]}
      />
      {present(work.summary) ? (
        <RichText source={work.summary} className="pf-summary" input={input} />
      ) : null}
      {cover ? (
        <MediaFigure
          placed={cover}
          ctx={ctx}
          className="pf-cover"
          eager={isSignature(work, input)}
          link={caseStudy}
        />
      ) : null}
      {present(work.excerpt) ? (
        <blockquote className="pf-excerpt">
          <RichText source={work.excerpt} input={input} />
        </blockquote>
      ) : null}
      {present(work.description) ? <RichText source={work.description} input={input} /> : null}
      {present(work.showNotes) ? (
        <RichText source={work.showNotes} className="pf-show-notes" input={input} />
      ) : null}
      <TagList items={work.highlights} className="pf-highlights" />
      <Tracks work={work} ctx={ctx} />
      <WorkMedia work={work} ctx={ctx} />
      <WorkEvidence work={work} ctx={ctx} />
      <LinkRow fields={workFields(work, ctx)} links={work.links} ctx={ctx} />
    </li>
  );
}

/** The case study's address for a work its route serves, else none. */
function caseStudyHref(work: Work, ctx: RenderContext): string | undefined {
  return isRoutedWork(work) ? routeHref(ctx.input, { route: 'work', slug: work.slug }) : undefined;
}

/** The addresses a work's fields put in its links row. */
function workFields(work: Work, ctx: RenderContext): [field: string, url: string | undefined][] {
  return [
    ['audioUrl', work.audioUrl],
    ['videoUrl', work.videoUrl],
    ...(caseStudyHref(work, ctx) !== undefined
      ? [['url', work.url] as [string, string | undefined]]
      : []),
  ];
}

export function WorksSection({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const base = renderContext(input, section, level);
  const works = worksOf(section, input);
  // A link shown by its host reads apart from its siblings' on the same host.
  const ctx: RenderContext = {
    ...base,
    linkSiblings: works.flatMap((work) =>
      hostLabelled(
        workFields(work, base).map(([, url]) => url),
        work.links,
      ),
    ),
  };
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ul className="pf-list" role="list">
        {works.map((work) => (
          <WorkEntry
            key={work.id}
            work={work}
            ctx={ctx}
            anchor={recordAnchor(section, work, input)}
          />
        ))}
      </ul>
    </>
  );
}
