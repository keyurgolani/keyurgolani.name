import { formatNames, renderContext } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { renderBand } from './frames';
import { present, type Band, type ChapterModel, type HomeModel } from './model';
import { regionId, Words } from './parts';

/**
 * The chapter's bands, its folded ones behind one closed disclosure, "The
 * rest of the record", where the first of them reads, named and counted as
 * the archive is: every folded section keeps its frame, id, and contents
 * entry, a fragment link into one opens it (natively, and scroll-spy.tsx
 * where the browser doesn't), it prints open, and it needs no JavaScript.
 * The open bands keep their order around it.
 */
function Bands({
  chapter,
  input,
  model,
}: {
  chapter: ChapterModel;
  input: VariantRenderInput;
  model: HomeModel;
}) {
  const folded = chapter.bands.filter((band) => band.folded);
  const first = chapter.bands.findIndex((band) => band.folded);
  const open = (bands: readonly Band[]) =>
    bands.filter((band) => !band.folded).map((band) => renderBand(band, input, model, 3));
  if (first < 0) return <>{open(chapter.bands)}</>;
  const outline = new Map(chapter.sections.map((section) => [section.id, section]));
  const ctx = renderContext(input, { id: chapter.anchor }, 3);
  const names = folded.flatMap(({ section }) => (present(section.title) ? [section.title] : []));
  const entries = folded.reduce(
    (sum, { section }) => sum + (outline.get(section.id)?.count ?? 0),
    0,
  );
  // Counted in entries where the folded sections list any, else in sections.
  const count =
    entries > 0
      ? entries === 1
        ? '1 entry'
        : `${entries} entries`
      : folded.length === 1
        ? '1 section'
        : `${folded.length} sections`;
  return (
    <>
      {open(chapter.bands.slice(0, first))}
      <details id={regionId(input, `fold-${chapter.id}`)} className="ee-fold">
        <summary className="ee-band ee-fold__summary">
          <span className="ee-band__head">
            {/* A head, as the bands' are, so the docked rail steps aside under it. */}
            <span className="ee-head">
              <span className="ee-head-title">
                <Words input={input}>The rest of the record</Words>
              </span>
            </span>
          </span>
          <span className="ee-band__body">
            <span className="ee-archive__summary">
              <span className="ee-archive__cue" aria-hidden="true" />
              <span className="ee-archive__title">
                <Words input={input}>{count}</Words>
              </span>{' '}
              <span className="ee-archive__count">{formatNames(names, ctx)}</span>
            </span>
          </span>
        </summary>
        {folded.map((band) => renderBand(band, input, model, 3))}
      </details>
      {open(chapter.bands.slice(first))}
    </>
  );
}

// A chapter of the issue: its opener, a full-page rule with the chapter's
// number hanging at the spine, its name, and the sections in it; then its
// bands, each section's head hanging beside it. Its number and name ride on
// data attributes for the running head (scroll-spy.tsx).

export function Chapter({
  chapter,
  input,
  model,
}: {
  chapter: ChapterModel;
  input: VariantRenderInput;
  model: HomeModel;
}) {
  const title = `${chapter.anchor}-title`;
  const toc = `${chapter.anchor}-toc`;
  const listed = chapter.sections.filter(
    (section) =>
      present(section.title) &&
      section.href !== undefined &&
      section.id !== model.thesisSection?.id,
  );
  return (
    <section
      id={chapter.anchor}
      className="ee-chapter"
      aria-labelledby={title}
      data-ee-chapter={chapter.number}
      data-ee-label={chapter.label}
    >
      <header className="ee-chapter__open">
        <h2 id={title} className="ee-chapter__title" data-type-role="headline">
          <span className="ee-chapter__n">{chapter.number}</span>{' '}
          <Words input={input}>{chapter.label}</Words>
        </h2>
        {listed.length > 1 ? (
          <nav className="ee-chapter__toc" aria-labelledby={`${toc} ${title}`}>
            <p id={toc} className="ee-chapter__toc-label" data-type-role="body-compact">
              <Words input={input}>In this chapter</Words>
            </p>{' '}
            <ul className="ee-chapter__toc-list" role="list" data-type-role="body-compact">
              {listed.map((section) => (
                <li key={section.id}>
                  <a href={section.href} lang={section.lang}>
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>
      <Bands chapter={chapter} input={input} model={model} />
    </section>
  );
}

/**
 * The chapter index (EE-M1, EE-M4): the issue's chapters, held in the head
 * column at the foot of the window on a wide screen, and pinned under the
 * masthead as a one-line chapter bar on a narrow one. The running head
 * (scroll-spy.tsx) marks the chapter being read `aria-current="location"`
 * and opens its sections under it; with no JavaScript it lists the
 * chapters alone.
 */
export function Rail({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const label = `${input.ids.prefix}ee--rail-label`;
  const folded = new Set(
    model.chapters.flatMap(({ bands }) =>
      bands.flatMap((band) => (band.folded ? [band.section.id] : [])),
    ),
  );
  return (
    <nav className="ee-rail" aria-labelledby={label}>
      <p id={label} className="ee-rail__label" data-type-role="body-compact">
        <Words input={input}>Chapters</Words>
      </p>
      <ol className="ee-rail__list" role="list" data-type-role="body-compact">
        {model.chapters.map((chapter) => (
          <li key={chapter.id} data-ee-rail={chapter.number}>
            <a href={chapter.href} className="ee-rail__link">
              <span className="ee-n">{chapter.number}</span>{' '}
              <Words input={input}>{chapter.label}</Words>
            </a>
            <ul className="ee-rail__sections" role="list">
              {chapter.sections
                .filter(
                  (section) =>
                    present(section.title) &&
                    section.href !== undefined &&
                    section.id !== model.thesisSection?.id,
                )
                .map((section) => (
                  <li key={section.id} data-ee-folded={folded.has(section.id) ? '' : undefined}>
                    <a href={section.href} lang={section.lang} data-ee-section={section.id}>
                      {section.title}
                    </a>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ol>
    </nav>
  );
}
