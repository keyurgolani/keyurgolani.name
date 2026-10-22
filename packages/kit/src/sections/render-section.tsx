import type { ReactElement } from 'react';
import type { Section, SectionKind } from '@portfolio/schema';
import { languageDirection } from '@portfolio/schema/direction';
import { isExtensionSection } from '@portfolio/schema/ids';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { hostModules } from './host-modules';
import { SHARED_RENDERERS } from './renderers';
import type { BespokeRenderers, HeadingLevel, SectionRenderer } from './types';
import { sectionShows } from './view';

export interface RenderSectionOptions {
  /** The section heading's level, 2 unless the caller says otherwise. */
  readonly level?: HeadingLevel;
}

/**
 * Renders one section inside its section element, which carries the DOM id
 * (the render's id prefix, then the section id), `data-section-id`,
 * `data-kind`, `data-renderer` (`bespoke` for the variant's own renderer,
 * `shared` otherwise), the section's `lang`, and a `dir` when that language
 * runs the other way from the portfolio.
 *
 * A kind in the manifest's `unsupportedKinds` renders nothing, and so does a
 * section with nothing public to show (#10), such as works whose every
 * item is private. One in its `renderedKinds` uses the variant's renderer
 * from `renderers`. An extension
 * kind uses the renderer its extension registered through
 * registerHostModules(), and renders nothing without one, which Slice 5's
 * compatibility check reports. Every other core kind uses the shared renderer.
 * A `renderers` map that disagrees with `renderedKinds` throws, since it's a
 * mistake in the variant, not the content.
 */
export function renderSection(
  section: Section,
  input: VariantRenderInput,
  renderers: BespokeRenderers,
  options: RenderSectionOptions = {},
): ReactElement | null {
  const { renderedKinds, unsupportedKinds } = input.capabilities;
  // The map is checked first, so a mistake shows even for a kind that's skipped.
  const declared = renderedKinds.includes(section.kind);
  const own = renderers[section.kind as SectionKind] as SectionRenderer<Section> | undefined;
  if (declared && !own) {
    throw new TypeError(
      `${input.variant} declares ${section.kind} in renderedKinds but passes no renderer for it.`,
    );
  }
  if (own && !declared) {
    throw new TypeError(
      `${input.variant} passes a renderer for ${section.kind}, which its renderedKinds doesn't list.`,
    );
  }
  if (unsupportedKinds.includes(section.kind)) return null;
  if (!isExtensionSection(section) && !sectionShows(section, input)) return null;
  const Renderer =
    own ??
    (isExtensionSection(section)
      ? (hostModules().extensionRenderers?.[section.kind] as SectionRenderer<Section> | undefined)
      : (SHARED_RENDERERS[section.kind] as SectionRenderer<Section>));
  if (!Renderer) return null;
  const direction = section.lang === undefined ? undefined : languageDirection(section.lang);
  return (
    <section
      key={section.id}
      id={`${input.ids.prefix}${section.id}`}
      data-section-id={section.id}
      data-kind={section.kind}
      data-renderer={own ? 'bespoke' : 'shared'}
      lang={section.lang}
      dir={
        direction !== undefined && direction !== input.portfolio.direction ? direction : undefined
      }
    >
      <Renderer section={section} input={input} level={options.level ?? 2} />
    </section>
  );
}
