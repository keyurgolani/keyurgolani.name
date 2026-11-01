import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  deeper,
  githubSnapshot,
  Heading,
  type OutlineSection,
  type SectionFrameProps,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { countOf, kindWord, said, type Count, type Lamp } from '../model';
import { CountText, Lamps, Words } from '../parts';

// The panel: the one anatomy every section on the wall has. A title-bar
// strip (the section's own heading in the label voice, sentence case, its
// count at the end), the body, and an optional source foot. Cells inside a
// panel are split by hairlines, never boxed again. A section the kit's
// shared renderer draws gets the same bar: the frame hands the kit's
// renderer the section without its title and subtitle, so the kit's body
// sits under MC's bar, with its count (MC-M2, concept change 12). A panel
// with no title has its kind's word on the bar (the composition's, never the
// schema's id), as a label, not a heading the owner didn't write. Prose kinds (about, now, contact) carry no count:
// they have no items to count.

/** The id of a frame's heading, for the frame's accessible name. */
export const headId = (frame: SectionFrameProps['frame']) =>
  frame.id === undefined ? undefined : `${frame.id}--head`;

export const titleOf = (section: Section) =>
  'title' in section && said(section.title) ? section.title : undefined;
export const subtitleOf = (section: Section) =>
  'subtitle' in section && said(section.subtitle) ? section.subtitle : undefined;

/** A panel's title bar: the heading, then what the bar's end reports. */
export function Bar({
  level,
  id,
  title,
  meta,
  lang,
}: {
  level: SectionFrameProps['level'];
  id?: string;
  title: ReactNode;
  meta?: ReactNode;
  lang?: string;
}) {
  return (
    <header className="mc-bar">
      <Heading level={level} className="mc-bar__title">
        <span id={id} lang={lang}>
          {title}
        </span>
      </Heading>
      {meta ? <p className="mc-bar__meta">{meta}</p> : null}
    </header>
  );
}

/** An untitled panel's bar: its kind's word as a label, and what the bar's end reports. */
function KindBar({
  kind,
  meta,
  uiLang,
}: {
  kind: string;
  meta?: ReactNode;
  uiLang: 'en' | undefined;
}) {
  return (
    <header className="mc-bar">
      <p className="mc-bar__title">
        <Words lang={uiLang}>{kindWord(kind)}</Words>
      </p>
      {meta ? <p className="mc-bar__meta">{meta}</p> : null}
    </header>
  );
}

/**
 * What a panel's bar counts where the outline counts nothing: a github section's listed
 * repositories, as its renderer lists them.
 */
export function githubCount(section: Section, input: VariantRenderInput): Count | undefined {
  if (section.kind !== 'github') return undefined;
  if (section.showPinnedRepos === false) return undefined;
  const snapshot = githubSnapshot(section, input);
  if (snapshot?.state !== 'ready' || !('pinnedRepos' in snapshot.value)) return undefined;
  const excluded = new Set(section.excludeRepos ?? []);
  const n = snapshot.value.pinnedRepos.filter((repo) => !excluded.has(repo.name)).length;
  return n > 0 ? { n, one: 'repository', many: 'repositories' } : undefined;
}

/**
 * The section as the kit's renderer gets it under MC's bar: without its title and subtitle,
 * which the bar and the body's first line show, so the kit draws no header of its own. Its
 * SectionHeader reads each as absent when it's undefined, whatever the kind's schema requires.
 */
const untitled = (section: Section) =>
  ({ ...section, title: undefined, subtitle: undefined }) as unknown as Section;

/** The kit renderer's element a shared section's frame holds, if that's what it holds. */
function kitElement(
  children: ReactNode,
  section: Section,
): ReactElement<SectionRendererProps<Section>> | undefined {
  return isValidElement<SectionRendererProps<Section>>(children) &&
    children.props.section === section
    ? children
    : undefined;
}

/**
 * A folded panel's title bar, as its disclosure's summary: the heading and
 * its count, then the fold's cue. Closed, the bar is the whole panel.
 */
function FoldBar({
  level,
  id,
  title,
  meta,
}: {
  level: SectionFrameProps['level'];
  id?: string;
  title: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <summary className="mc-bar mc-fold__bar">
      <Heading level={level} className="mc-bar__title">
        <span id={id}>{title}</span>
      </Heading>
      {meta ? (
        <>
          {' '}
          <span className="mc-bar__meta">{meta}</span>
        </>
      ) : null}
    </summary>
  );
}

export interface PanelOptions {
  /** Whether a section is part of the full record, behind a closed disclosure (Design gate rule 8). */
  readonly foldsOf?: (section: Section) => boolean;
  /** The span each section takes on the wall, from the packer. */
  readonly spanOf: (section: Section) => number;
  readonly entryOf: (section: Section) => OutlineSection | undefined;
  /** What a bar counts where the outline counts nothing, such as a github section's repositories. */
  readonly countFor?: (section: Section) => Count | undefined;
  /** The lamps a section's bar carries, such as a now section's as-of date. */
  readonly lampsOf?: (section: Section) => readonly Lamp[];
  /** What opens a section's body before its own, such as the hero's tagline on About's lede. */
  readonly standfirstOf?: (section: Section) => ReactNode;
  readonly uiLang: 'en' | undefined;
}

/** The frame for every panel on a board. */
export function panelFrame(options: PanelOptions) {
  return function PanelFrame(props: SectionFrameProps) {
    const { section, frame, level } = props;
    const title = titleOf(section);
    const subtitle = subtitleOf(section);
    const span = options.spanOf(section);
    const labelled = title !== undefined && headId(frame) !== undefined;
    // A hero's title is its label line, not a header: a kit hero keeps its own markup.
    const kit =
      frame['data-renderer'] === 'shared' && section.kind !== 'hero'
        ? kitElement(props.children, section)
        : undefined;
    const entry = options.entryOf(section);
    const count =
      (entry ? countOf(entry) : undefined) ??
      options.countFor?.(section) ??
      (kit ? githubCount(section, kit.props.input) : undefined);
    // The subtitle opens the panel on the body's edge, whether the body pads itself (prose)
    // or runs its rows to the panel's edge (logs, cells): it sits in its own padded line (G1).
    const body = (
      <>
        {subtitle !== undefined ? (
          <div className="mc-panel__intro">
            <p className="mc-panel__sub">{subtitle}</p>
          </div>
        ) : null}
        <div className="mc-panel__body">
          {options.standfirstOf?.(section)}
          {kit
            ? cloneElement(kit, {
                section: untitled(section),
                // The kit puts a titled section's items a level under its heading; the
                // heading is the bar's now, so the items keep that level.
                level: title !== undefined ? deeper(level) : level,
              })
            : props.children}
        </div>
      </>
    );
    if (title !== undefined && options.foldsOf?.(section)) {
      // The full record (Design gate rule 8): the bar is the summary, closed until asked. It
      // opens from a fragment link and prints open (the stylesheet, and the island's open).
      return (
        <section
          {...frame}
          className="mc-panel mc-panel--fold"
          {...(span > 0 ? { 'data-span': span } : { 'data-stacked': '' })}
          data-fold=""
          {...(labelled ? { 'aria-labelledby': headId(frame) } : {})}
        >
          <details className="mc-fold" data-mc-fold="">
            <FoldBar
              level={level}
              id={headId(frame)}
              title={title}
              meta={count ? <CountText count={count} uiLang={options.uiLang} /> : undefined}
            />
            {body}
          </details>
        </section>
      );
    }
    const lamps = options.lampsOf?.(section) ?? [];
    const meta =
      count || lamps.length > 0 ? (
        <>
          {lamps.length > 0 ? <Lamps lamps={lamps} uiLang={options.uiLang} /> : null}
          {count ? <CountText count={count} uiLang={options.uiLang} /> : null}
        </>
      ) : undefined;
    return (
      <section
        {...frame}
        className={kit ? 'mc-panel mc-panel--kit' : 'mc-panel'}
        {...(span > 0 ? { 'data-span': span } : { 'data-stacked': '' })}
        {...(labelled ? { 'aria-labelledby': headId(frame) } : {})}
      >
        {title !== undefined ? (
          <Bar level={level} id={headId(frame)} title={title} meta={meta} />
        ) : (
          <KindBar kind={section.kind} meta={meta} uiLang={options.uiLang} />
        )}
        {body}
      </section>
    );
  };
}
