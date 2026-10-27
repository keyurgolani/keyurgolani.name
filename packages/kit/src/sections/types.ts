import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { CoreSection, ExtensionSection, Section, SectionKind } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';

/** A heading element's level, h1 to h6. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** The core section of one kind. */
export type SectionOf<K extends SectionKind> = Extract<CoreSection, { kind: K }>;

export interface SectionRendererProps<S> {
  readonly section: S;
  readonly input: VariantRenderInput;
  /** The level of the section's own heading. Item headings go one deeper. */
  readonly level: HeadingLevel;
}

/**
 * Renders one section's heading and content. renderSection() wraps the result
 * in the composition's frame, so a renderer never renders its own. It's
 * synchronous and reads only its props: no clock, no randomness, no fetch.
 */
export type SectionRenderer<S> = (props: SectionRendererProps<S>) => ReactElement | null;

/** A renderer for every core kind. */
export type CoreRenderers = { readonly [K in SectionKind]: SectionRenderer<SectionOf<K>> };

/** A variant's own renderers: any core kind, and extension kinds by `<namespace>/<name>`. */
export type BespokeRenderers = Partial<CoreRenderers> & {
  readonly [kind: `${string}/${string}`]: SectionRenderer<ExtensionSection> | undefined;
};

/**
 * A variant's `.` export: a synchronous component of its render input alone.
 * composePages() also sets `unknownView`, which says whether the render is
 * a view's note for parameters that name nothing (K-3), so the host leaves
 * that noindex page without a canonical link.
 */
export type VariantComponent = ComponentType<{ readonly input: VariantRenderInput }> & {
  readonly unknownView?: (input: VariantRenderInput) => boolean;
};

/**
 * The attributes every section's frame carries on its root element, which
 * renderSection() works out and the frame spreads as they are: the DOM id
 * (the render's id prefix, then the section's anchor, which is its id unless
 * the composition's anchorOf() says otherwise, and none when it says the
 * section takes no anchor), `data-section-id`,
 * `data-kind`, `data-renderer`, the section's `lang`, and a `dir` when that
 * language runs the other way from the portfolio. The host's tests, the
 * outline check, and #6's trace all find sections by them.
 */
export interface FrameAttributes {
  readonly id?: string;
  readonly 'data-section-id': string;
  readonly 'data-kind': string;
  readonly 'data-renderer': 'bespoke' | 'shared';
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}

export interface SectionFrameProps {
  /** What the frame's root element spreads: a `<section>` or an `<article>`. */
  readonly frame: FrameAttributes;
  readonly section: Section;
  /** The level of the section's own heading, as its renderer gets it. */
  readonly level: HeadingLevel;
  /** The section's renderer's output. */
  readonly children: ReactNode;
}

/**
 * The element a composition puts around each section: its own markup, which
 * spreads `frame` on its root, a `<section>` or an `<article>`, and holds
 * `children`. Synchronous, and it reads only its props.
 */
export type SectionFrame = (props: SectionFrameProps) => ReactElement;

/**
 * What a composition hands renderSection(): its own renderers, by kind, and
 * the frame around every section. A kind with no renderer here uses the
 * shared one, unless the manifest skips it.
 */
export interface SectionComposition {
  readonly renderers: BespokeRenderers;
  readonly Frame: SectionFrame;
  /**
   * The content id a section's frame takes as its anchor, before the render's
   * id prefix, or null when it takes none: for a composition whose own
   * element already holds that id, such as Horizontal Cinema's chapter
   * anchors. The section's own id when it's left out or returns undefined.
   * pageOutline() and checkOutline() read the same answer, so no link names
   * an anchor the section doesn't have.
   */
  readonly anchorOf?: (section: Section) => string | null | undefined;
}
