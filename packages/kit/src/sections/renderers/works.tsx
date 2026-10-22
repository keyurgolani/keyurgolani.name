import type { VariantRenderInput } from '@portfolio/variant-contract';
import { MediaFigure } from '../media';
import {
  deeper,
  ItemTitle,
  LinkList,
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
  isSignature,
  placedImage,
  recordAnchor,
  worksOf,
} from '../view';
import { EvidenceEntry } from './evidence';

// The works a works section lists, in its order (#10, slice 1, item 7).
// The shared renderer doesn't reorder them: featured and proof order is a
// composition's to use. A work in the portfolio's archive says so, with the
// fixed label Archive. A case study isn't linked until its route serves it.

type Work = NonNullable<VariantRenderInput['portfolio']['works']>[number];

/** The work's own media placements, each with its caption. */
function WorkMedia({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const placed = (work.media ?? []).flatMap((placement) => {
    const image = placedImage(
      placement,
      ctx.input,
      present(placement.caption) ? <p className="pf-caption">{placement.caption}</p> : undefined,
    );
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

/** The evidence the work cites, each as an evidence section shows it. */
function WorkEvidence({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const entries = evidenceByIds(work.evidence, ctx.input);
  if (entries.length === 0) return null;
  // Below the work's own heading.
  const nested: RenderContext = { ...ctx, itemLevel: deeper(ctx.itemLevel) };
  return (
    <ul className="pf-evidence" role="list">
      {entries.map((entry) => (
        <EvidenceEntry key={entry.id} entry={entry} ctx={nested} />
      ))}
    </ul>
  );
}

/** One work, as a list item whose id is the work's when this section lists it first. */
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
  const cover = placedImage(work.cover, input);
  return (
    <li id={anchor} className="pf-item pf-work" data-work-id={work.id} data-medium={work.medium}>
      {cover ? (
        <MediaFigure
          placed={cover}
          ctx={ctx}
          className="pf-cover"
          eager={isSignature(work, input)}
        />
      ) : null}
      {isArchived(work, input) ? (
        <p className="pf-label" data-label="archive">
          <Ui ctx={ctx}>Archive</Ui>
        </p>
      ) : null}
      <ItemTitle text={work.title} url={work.url} ctx={ctx} />
      <Meta
        parts={[
          work.role,
          work.organization,
          work.period && <PeriodText key="period" period={work.period} ctx={ctx} />,
        ]}
      />
      {present(work.summary) ? (
        <RichText source={work.summary} className="pf-summary" input={input} />
      ) : null}
      {present(work.description) ? <RichText source={work.description} input={input} /> : null}
      <TagList items={work.highlights} className="pf-highlights" />
      <TagList items={work.tools} />
      <WorkMedia work={work} ctx={ctx} />
      <WorkEvidence work={work} ctx={ctx} />
      <LinkList links={work.links} ctx={ctx} />
    </li>
  );
}

export function WorksSection({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ul className="pf-list" role="list">
        {worksOf(section, input).map((work) => (
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
