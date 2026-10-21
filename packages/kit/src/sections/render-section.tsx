import type { ReactElement } from 'react';
import type { Section, SectionKind } from '@portfolio/schema';
import { isExtensionSection } from '@portfolio/schema/ids';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { hostModules } from './host-modules';
import { SHARED_RENDERERS } from './renderers';
import type { BespokeRenderers, HeadingLevel, SectionRenderer } from './types';

export interface RenderSectionOptions {
  /** The section heading's level, 2 unless the caller says otherwise. */
  readonly level?: HeadingLevel;
}

/**
 * Renders one section inside its section element, which carries the DOM id
 * (the render's id prefix, then the section id), `data-section-id`,
 * `data-kind`, `data-renderer` (`bespoke` for the variant's own renderer,
 * `shared` otherwise), and the section's `lang`.
 *
 * A kind in the manifest's `unsupportedKinds` renders nothing. One in its
 * `renderedKinds` uses the variant's renderer from `renderers`. An extension
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
  if (unsupportedKinds.includes(section.kind)) return null;
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
  const Renderer =
    own ??
    (isExtensionSection(section)
      ? (hostModules().extensionRenderers?.[section.kind] as SectionRenderer<Section> | undefined)
      : (SHARED_RENDERERS[section.kind] as SectionRenderer<Section>));
  if (!Renderer) return null;
  return (
    <section
      key={section.id}
      id={`${input.ids.prefix}${section.id}`}
      data-section-id={section.id}
      data-kind={section.kind}
      data-renderer={own ? 'bespoke' : 'shared'}
      lang={section.lang}
    >
      <Renderer section={section} input={input} level={options.level ?? 2} />
    </section>
  );
}
