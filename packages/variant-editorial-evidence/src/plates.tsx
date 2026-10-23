import type { Work } from '@portfolio/schema';
import { Action, Surface } from '@portfolio/appearance/primitives';
import {
  EvidenceEntry,
  evidenceByIds,
  MediaFigure,
  placedMedia,
  RichText,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { isRoutedWork, present } from './model';
import { regionContext, Words } from './parts';

// The work plates (#13): the signature on the largest plate, and each
// featured work on a smaller one. A plate leads with the work's cover when
// it has one, and is text-led when it doesn't, with no empty frame. Its
// evidence notes sit beside it on wide screens and below it on narrow ones,
// in source order either way, so print and a page with no styles read the
// same. A work with a page of its own, a case study at a slug, links to it.

/** How many of a work's evidence records a plate notes. Its page shows them all. */
const NOTES = 3;

export function Plate({
  work,
  input,
  kind,
}: {
  work: Work;
  input: VariantRenderInput;
  kind: 'signature' | 'flagship';
}) {
  const ctx = regionContext(input, work.id, 3, work.lang);
  const titleId = `${input.ids.prefix}ee--title-${work.id}`;
  const cover = placedMedia(work.cover, ctx);
  const notes = evidenceByIds(work.evidence, input).slice(0, NOTES);
  const page = isRoutedWork(work)
    ? routeHref(input, { route: 'work', slug: work.slug })
    : undefined;
  const notesLabel = `${input.ids.prefix}ee--notes-${work.id}`;
  const meta = [work.role, work.organization].filter(present);
  return (
    <Surface
      as="article"
      id={`${input.ids.prefix}${work.id}`}
      emphasis={kind === 'signature' ? 'prominent' : 'default'}
      labelledBy={titleId}
      className={`ee-plate ee-plate--${kind}${cover ? '' : ' ee-plate--text'}`}
    >
      <div className="ee-plate__body" lang={work.lang}>
        {kind === 'signature' ? (
          <p className="ee-plate__label" data-type-role="label">
            <Words input={input}>Signature work</Words>
          </p>
        ) : null}
        <h3
          id={titleId}
          className="ee-plate__title"
          data-type-role={kind === 'signature' ? 'headline' : 'title'}
        >
          {page ? <a href={page}>{work.title}</a> : work.title}
        </h3>
        {meta.length > 0 ? (
          <p className="ee-plate__meta" data-type-role="caption">
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
          <RichText source={work.summary} className="ee-plate__summary" input={input} />
        ) : null}
        {page ? (
          <p className="ee-plate__action">
            <Action
              href={page}
              emphasis={kind === 'signature' ? 'primary' : 'secondary'}
              describedBy={titleId}
            >
              <Words input={input}>Read the case study</Words>
            </Action>
          </p>
        ) : null}
      </div>
      {cover ? (
        <div className="ee-plate__artifact">
          <MediaFigure
            placed={cover}
            ctx={ctx}
            className="ee-plate__image"
            eager={kind === 'signature'}
            sizes={
              kind === 'signature'
                ? '(min-width: 64rem) 66vw, 100vw'
                : '(min-width: 64rem) 50vw, 100vw'
            }
          />
        </div>
      ) : null}
      {notes.length > 0 ? (
        <aside className="ee-plate__notes" aria-labelledby={`${notesLabel} ${titleId}`}>
          <span id={notesLabel} hidden>
            <Words input={input}>Evidence for</Words>
          </span>
          <ul className="pf-evidence" role="list">
            {notes.map((entry) => (
              <EvidenceEntry key={entry.id} entry={entry} ctx={{ ...ctx, itemLevel: 4 }} />
            ))}
          </ul>
        </aside>
      ) : null}
    </Surface>
  );
}
