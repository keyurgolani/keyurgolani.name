import type { ReactElement, ReactNode } from 'react';
import {
  Heading,
  renderSection,
  worksOf,
  type SectionComposition,
  type SectionFrameProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { Band, HomeModel, ViewSection } from './model';
import { present } from './model';
import type { Env } from './env';
import { workFigure, workImages } from './figures';
import { renderersFor } from './renderers';
import { Words } from './parts';

// The frames every section renders in (stream E's SectionComposition): each
// is the section's own <section>, carrying the attributes renderSection()
// gives it, so every section the page renders has a landmark of its own
// with its own id, wherever the issue sets it.
//
// - A band: the section's head hanging in the head column, held in view
//   while its section reads, the 1 px spine beside it, and the body on the
//   text and notes columns. Short sections set in its margin are frames of
//   their own, inside it.
// - A margin note: a small head and its body, in a band's notes column.
// - The opening's: the thesis and the byline, which the opening places.

/** The id of a frame's heading, for the frame's accessible name. */
const headId = (frame: SectionFrameProps['frame']) =>
  frame.id === undefined ? undefined : `${frame.id}--head`;

const titleOf = (section: SectionFrameProps['section']) =>
  'title' in section && present(section.title) ? section.title : undefined;
const subtitleOf = (section: SectionFrameProps['section']) =>
  'subtitle' in section && present(section.subtitle) ? section.subtitle : undefined;

/** The section's head: its title at the frame's level, and its subtitle under it. */
function Head({
  props,
  className,
}: {
  props: SectionFrameProps;
  className: string;
}): ReactElement | null {
  const title = titleOf(props.section);
  const subtitle = subtitleOf(props.section);
  if (title === undefined && subtitle === undefined) return null;
  return (
    <div className={className}>
      {title !== undefined ? (
        <Heading level={props.level} className={`${className}-title`}>
          <span id={headId(props.frame)}>{title}</span>
        </Heading>
      ) : null}
      {subtitle !== undefined ? (
        <p className={`${className}-meta`} data-type-role="body-compact">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

/** Named by its title when it has one, so a titled section is a region. */
function named(props: SectionFrameProps) {
  return titleOf(props.section) !== undefined ? { 'aria-labelledby': headId(props.frame) } : {};
}

/** A count in words: "1 group", "3 groups". */
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a band says on its one line when it folds behind its head on one
 * column (overlap 9; OWN-7), else undefined. A band folds there when it's a
 * list to look things up in or a set of things to look at or hear, never the
 * owner's account, nor the work and proof the issue argues with:
 *
 * - the practice's lists: Skills, Stack, and its offers (services), each
 *   counted by what it lists;
 * - a works section set wholly as figures, every work in it photographs or
 *   tracks (in the sample, Looking and Listening), counted in photographs or
 *   tracks for one work, in works for more.
 *
 * Beside the head column every one of them reads open.
 */
function phoneFold(
  props: SectionFrameProps,
  input: VariantRenderInput,
  model: HomeModel,
): string | undefined {
  const { section } = props;
  if (section.kind === 'practice') {
    const practice = input.portfolio.practice;
    const groups =
      section.part === 'skills'
        ? practice?.skills?.length
        : section.part === 'tools'
          ? practice?.tools?.length
          : undefined;
    if (groups) return counted(groups, 'group', 'groups');
    if (section.part !== 'services') return undefined;
    const offers = (practice?.services ?? []).reduce((sum, group) => sum + group.items.length, 0);
    return offers ? counted(offers, 'offer', 'offers') : undefined;
  }
  if (section.kind !== 'works' || section.id === model.selection) return undefined;
  const works = worksOf(section, input);
  const figures = works.map((work) => (model.plates.has(work.id) ? null : workFigure(work, input)));
  if (works.length === 0 || figures.includes(null)) return undefined;
  if (works.length > 1) return counted(works.length, 'work', 'works');
  const work = works[0]!;
  return figures[0] === 'album'
    ? counted(work.tracks?.length ?? 0, 'track', 'tracks')
    : counted(workImages(work, input).length, 'photograph', 'photographs');
}

function bandFrame(margin: readonly ReactElement[], input: VariantRenderInput, model: HomeModel) {
  return function BandFrame(props: SectionFrameProps) {
    const kind = props.section.kind;
    const fold = phoneFold(props, input, model);
    const body = (
      <div className="ee-band__body">
        {props.children}
        {margin.length > 0 ? <div className="ee-band__margin">{margin}</div> : null}
      </div>
    );
    return (
      <section
        {...props.frame}
        {...named(props)}
        className={`ee-band ee-band--${kind.replace('/', '-')}${margin.length ? ' ee-band--margined' : ''}`}
      >
        <div className="ee-band__head">
          <Head props={props} className="ee-head" />
        </div>
        {fold ? (
          // Open beside the head column; folded to one line under its head on one column.
          <details className="ee-band__fold">
            <summary className="ee-band__fold-summary" data-type-role="body-compact">
              <span className="ee-archive__cue" aria-hidden="true" />{' '}
              <Words input={input}>{fold}</Words>
            </summary>
            {body}
          </details>
        ) : (
          body
        )}
      </section>
    );
  };
}

function MarginFrame(props: SectionFrameProps) {
  return (
    <section
      {...props.frame}
      {...named(props)}
      className={`ee-aside ee-aside--${props.section.kind}`}
    >
      <Head props={props} className="ee-aside__head" />
      {props.children}
    </section>
  );
}

// The opening sets no head: the thesis is the page's h1 and the byline needs
// none. A titled section's title names its region instead, so it still says
// what it is to whoever moves through the page by landmarks.
function OpeningFrame(props: SectionFrameProps) {
  const title = titleOf(props.section);
  const id = headId(props.frame);
  return (
    <section
      {...props.frame}
      {...(title !== undefined && id !== undefined ? { 'aria-labelledby': id } : {})}
      className={`ee-opening__${props.section.kind}`}
    >
      {title !== undefined && id !== undefined ? (
        <span id={id} hidden>
          {title}
        </span>
      ) : null}
      {props.children}
    </section>
  );
}

function compositionFor(env: Env, Frame: SectionComposition['Frame']): SectionComposition {
  return { renderers: renderersFor(env), Frame };
}

/** One band of a chapter, with its margin's sections, at `level`. */
export function renderBand(
  band: Band,
  input: VariantRenderInput,
  model: HomeModel,
  level: 2 | 3,
): ReactElement | null {
  const note = compositionFor({ model, place: 'margin' }, MarginFrame);
  const margin = band.margin.flatMap((section) => {
    const element = renderSection(section, input, note, { level: (level + 1) as 3 | 4 });
    return element ? [element] : [];
  });
  return renderSection(
    band.section,
    input,
    compositionFor({ model, place: 'band' }, bandFrame(margin, input, model)),
    { level },
  );
}

/** A section the opening sets, the thesis or the hero, in its own frame. */
export function renderOpening(
  section: ViewSection,
  input: VariantRenderInput,
  model: HomeModel,
  level: 1 | 2,
): ReactNode {
  return renderSection(section, input, compositionFor({ model, place: 'opening' }, OpeningFrame), {
    level,
  });
}
