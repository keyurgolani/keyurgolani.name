import type { ReactElement } from 'react';
import type { CoreSection, ExtensionSection, SectionKind } from '@portfolio/schema';
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
 * in the section element, so a renderer never renders its own. It's
 * synchronous and reads only its props: no clock, no randomness, no fetch.
 */
export type SectionRenderer<S> = (props: SectionRendererProps<S>) => ReactElement | null;

/** A renderer for every core kind. */
export type CoreRenderers = { readonly [K in SectionKind]: SectionRenderer<SectionOf<K>> };

/** A variant's own renderers: any core kind, and extension kinds by `<namespace>/<name>`. */
export type BespokeRenderers = Partial<CoreRenderers> & {
  readonly [kind: `${string}/${string}`]: SectionRenderer<ExtensionSection> | undefined;
};
