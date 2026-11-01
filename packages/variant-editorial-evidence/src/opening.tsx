import type { CSSProperties } from 'react';
import { Action, Disclosure, Surface } from '@portfolio/appearance/primitives';
import type { Work } from '@portfolio/schema';
import {
  evidenceByIds,
  PeriodText,
  placedMedia,
  present,
  renderContext,
  RichText,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { renderOpening } from './frames';
import { DISPLAY_SENTENCE, isRoutedWork, plateId, type HomeModel } from './model';
import { Caption, Figure, regionId, uiLang, Words } from './parts';
import { BylineFacts } from './renderers/hero';

// The opening, the issue's first view (F4, F5): the thesis at display size
// across the page; under it the contents in the head column, the lead work
// on Pl. 1 on the text column with its caption foot-aligned in the margin,
// and the standfirst at the margin's head; then the byline on the bottom
// band. The thesis and the hero are framed sections of their own; the
// contents and the plate are the issue's. Source order is the reading
// order: thesis, contents, plate, byline.

const MEDIUMS: Readonly<Record<string, string>> = {
  interface: 'Interface',
  system: 'System',
  software: 'Software',
  photography: 'Photography',
  'image-series': 'Image series',
  writing: 'Writing',
  research: 'Research',
  music: 'Music',
  'audio-video': 'Audio and video',
  object: 'Object',
};

/**
 * Where Pl. 1's marks sit on its artwork (EDI-1): a diagonal through the
 * cover's focal point, a tenth of the width and a ninth of the height
 * apart, note 1 highest. The point is held in far enough that the whole
 * diagonal stays inside the picture's middle 80%. Note 1 is rightmost (x)
 * where the notes sit under the marks, beside the head column, and leftmost
 * (mx) where they sit over them; either way no leader crosses another.
 */
export function pinsAt(focal: { x: number; y: number } | undefined, n: number) {
  const half = (n - 1) / 2;
  const hold = (v: number, step: number) =>
    Math.min(0.9 - half * step, Math.max(0.1 + half * step, v));
  const fx = hold(focal?.x ?? 0.5, 0.1);
  const fy = hold(focal?.y ?? 0.5, 0.11);
  return Array.from({ length: n }, (_, i) => ({
    x: fx + (half - i) * 0.1,
    mx: fx - (half - i) * 0.1,
    y: fy + (i - half) * 0.11,
  }));
}

const percent = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** The issue's contents: five chapters, each with a line of links to its sections. */
function Contents({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const label = regionId(input, 'contents-label');
  return (
    <nav className="ee-contents" aria-labelledby={label}>
      <p id={label} className="ee-contents__label" data-type-role="body-compact">
        <Words input={input}>In this issue</Words>
      </p>
      {/* The language's own Disclosure primitive; EE lays its summary and content out. */}
      <Disclosure
        className="ee-contents__details"
        summary={
          <>
            <span lang={uiLang(input)} data-type-role="body-compact">
              {model.chapters.map(({ label: name }) => name).join(', ')}
            </span>
            <span className="ee-contents__cue" aria-hidden="true" />
          </>
        }
      >
        <ol id={regionId(input, 'contents')} className="ee-contents__list" role="list">
          {model.chapters.map((chapter) => {
            const titled = chapter.sections.filter(
              (section) =>
                present(section.title) &&
                section.href !== undefined &&
                section.id !== model.thesisSection?.id,
            );
            return (
              <li key={chapter.id} className="ee-contents__chapter">
                <a href={chapter.href} className="ee-contents__link">
                  <span className="ee-n" aria-hidden="true">
                    {chapter.number}
                  </span>{' '}
                  <span className="ee-contents__name">
                    <Words input={input}>{chapter.label}</Words>
                  </span>
                </a>
                {titled.length > 0 ? (
                  <p className="ee-contents__sections" data-type-role="body-compact">
                    {titled.map((section, index) => (
                      <span key={section.id}>
                        {index > 0 ? ', ' : null}
                        <a href={section.href} lang={section.lang}>
                          {section.title}
                        </a>
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Disclosure>
    </nav>
  );
}

/** Pl. 1: the lead work's cover, or its words where it has none, with its caption in the margin. */
function LeadPlate({
  work,
  input,
  model,
}: {
  work: Work;
  input: VariantRenderInput;
  model: HomeModel;
}) {
  const ctx = renderContext(input, { id: work.id, lang: work.lang }, 2);
  const cover = placedMedia(work.cover ?? work.media?.[0], ctx);
  const titleId = `${plateId(input, work)}--title`;
  const page = isRoutedWork(work)
    ? routeHref(input, { route: 'work', slug: work.slug })
    : undefined;
  const lines = (work.highlights?.filter(present) ?? []).concat(
    work.highlights?.length
      ? []
      : evidenceByIds(work.evidence, input)
          .slice(0, 3)
          .flatMap((entry) => (present(entry.title) ? [entry.title] : [])),
  );
  // Up to three evidence lines, each keyed to a numbered mark on the plate.
  const notes = lines.slice(0, 3).map((text, index) => ({
    id: `${plateId(input, work)}--note-${index + 1}`,
    text,
  }));
  const pins = pinsAt(cover?.focalPoint, notes.length);
  const medium = work.medium !== undefined ? MEDIUMS[work.medium] : undefined;
  const more = page ?? (model.selection ? `#${input.ids.prefix}${model.selection}` : undefined);
  return (
    <figure
      id={plateId(input, work)}
      className={`ee-lead${cover ? '' : ' ee-lead--text'}`}
      aria-labelledby={titleId}
      lang={work.lang}
    >
      {cover ? (
        <Surface className="ee-lead__frame">
          <Figure
            placed={cover}
            ctx={ctx}
            className="ee-media ee-lead__media"
            eager
            sizes="(min-width: 81.25rem) 40rem, (min-width: 48rem) 60vw, 100vw"
          />
          {notes.length > 0 ? (
            <ol className="ee-lead__pins" aria-hidden="true">
              {notes.map((note, index) => (
                <li
                  key={note.id}
                  className="ee-lead__pin"
                  style={
                    {
                      '--layout-ee-pin-x': percent(pins[index]!.x),
                      '--layout-ee-pin-mx': percent(pins[index]!.mx),
                      '--layout-ee-pin-y': percent(pins[index]!.y),
                      anchorName: `--ee-pin-${index + 1}`,
                    } as CSSProperties
                  }
                >
                  {index + 1}
                </li>
              ))}
            </ol>
          ) : null}
        </Surface>
      ) : present(work.summary) ? (
        <div className="ee-lead__words" data-type-role="headline">
          <RichText source={work.summary} input={input} />
        </div>
      ) : null}
      <figcaption className="ee-lead__caption">
        <Caption
          title={<span id={titleId}>{work.title}</span>}
          index={<Words input={input}>Pl. 1</Words>}
        >
          {medium || work.period ? (
            <p>
              {medium ? <Words input={input}>{medium}</Words> : null}
              {medium && work.period ? ', ' : null}
              {work.period ? <PeriodText period={work.period} ctx={ctx} /> : null}
            </p>
          ) : null}
        </Caption>
        {/* Each note leads with its key, its mark's numeral; its leader follows the caption. */}
        {notes.length > 0 ? (
          <ol className="ee-ruled ee-lead__lines" role="list">
            {notes.map((note, index) => (
              <li key={note.id} id={note.id}>
                {cover ? (
                  <>
                    <span
                      className="ee-n ee-lead__key"
                      aria-hidden="true"
                      style={{ anchorName: `--ee-key-${index + 1}` } as CSSProperties}
                    >
                      {index + 1}
                    </span>{' '}
                  </>
                ) : null}
                {note.text}
              </li>
            ))}
          </ol>
        ) : null}
        {more ? (
          <p className="ee-lead__go">
            <Action href={more}>
              <Words input={input}>{page ? 'Read the case study' : 'More about this work'}</Words>
            </Action>
          </p>
        ) : null}
      </figcaption>
      {/* Last, so both its anchors are laid out before it: a run from each key, a rise to its mark. */}
      {cover && notes.length > 0 ? (
        <span className="ee-lead__leaders" aria-hidden="true">
          {notes.map((note, index) => (
            <span
              key={note.id}
              className="ee-lead__leader"
              style={
                {
                  '--layout-ee-pin': `--ee-pin-${index + 1}`,
                  '--layout-ee-key': `--ee-key-${index + 1}`,
                } as CSSProperties
              }
            >
              <span className="ee-lead__rise" />
              <span className="ee-lead__run" />
            </span>
          ))}
        </span>
      ) : null}
    </figure>
  );
}

/** The page's one h1 when no practice section places the thesis. */
function Headline({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const { thesis, hero } = model;
  if (thesis) {
    return (
      <div className="ee-opening__thesis">
        <h1 className={`ee-thesis__title${thesis.whole ? ' ee-thesis__title--whole' : ''}`}>
          <RichText source={thesis.headline} inline input={input} />
        </h1>
        {thesis.standfirst ? (
          <p className="ee-thesis__stand" data-type-role="quote">
            <RichText source={thesis.standfirst} inline input={input} />
          </p>
        ) : null}
      </div>
    );
  }
  const { identity } = input.portfolio;
  const text = [hero?.tagline, identity.tagline].find(present) ?? identity.name;
  return (
    <div className="ee-opening__thesis">
      <h1
        className={`ee-thesis__title${text.length > DISPLAY_SENTENCE ? ' ee-thesis__title--whole' : ''}`}
      >
        {text}
      </h1>
    </div>
  );
}

export function Opening({ input, model }: { input: VariantRenderInput; model: HomeModel }) {
  const thesis = model.thesisSection ? renderOpening(model.thesisSection, input, model, 1) : null;
  return (
    <div className={`ee-opening${model.lead ? '' : ' ee-opening--bare'}`}>
      {thesis ?? <Headline input={input} model={model} />}
      {model.chapters.length > 0 ? <Contents input={input} model={model} /> : null}
      {/* On one column: thesis, the chapter line, then the byline's facts before Pl. 1 (C2, EE-S4). */}
      {model.hero && model.lead ? (
        <BylineFacts
          section={model.hero}
          input={input}
          className="ee-byline__facts ee-opening__write"
        />
      ) : null}
      {model.lead ? <LeadPlate work={model.lead} input={input} model={model} /> : null}
      {model.hero ? renderOpening(model.hero, input, model, 2) : null}
    </div>
  );
}
