import type { ReactElement } from 'react';
import type { Section, SectionKind } from '@portfolio/schema';
import { languageDirection } from '@portfolio/schema/direction';
import { isExtensionSection } from '@portfolio/schema/ids';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { hostModules } from './host-modules';
import { SHARED_RENDERERS } from './renderers';
import type {
  FrameAttributes,
  HeadingLevel,
  SectionComposition,
  SectionFrameProps,
  SectionRenderer,
} from './types';
import { sectionShows } from './view';

export interface RenderSectionOptions {
  /** The section heading's level, 2 unless the caller says otherwise. */
  readonly level?: HeadingLevel;
}

/** What sectionRenders() reads: the portfolio, and what the manifest declares. */
type RenderedSource = Pick<VariantRenderInput, 'portfolio'> & {
  readonly capabilities: Pick<
    VariantRenderInput['capabilities'],
    'renderedKinds' | 'unsupportedKinds'
  >;
};

/**
 * Whether renderSection() puts the section on the page: the one rule it and
 * pageOutline() share, so a navigation never links a section that didn't
 * render. A kind in the manifest's `unsupportedKinds` renders nothing, and
 * so does a core section with nothing public to show (#10), such as works
 * whose every item is private. An extension kind renders when the manifest
 * renders it bespoke, or when its extension registered a renderer through
 * registerHostModules(), which Slice 5's compatibility check reports when
 * it didn't. Every other core kind renders, bespoke or shared.
 */
export function sectionRenders(section: Section, input: RenderedSource): boolean {
  const { renderedKinds, unsupportedKinds } = input.capabilities;
  if (unsupportedKinds.includes(section.kind)) return false;
  if (!isExtensionSection(section)) return sectionShows(section, input);
  return (
    renderedKinds.includes(section.kind) ||
    hostModules().extensionRenderers?.[section.kind] !== undefined
  );
}

/** The frame around a section the composition doesn't frame itself: a plain `<section>`. */
export function SharedFrame({ frame, children }: SectionFrameProps): ReactElement {
  return <section {...frame}>{children}</section>;
}

/**
 * The composition of a caller that renders every section the shared way:
 * the shared renderers, each in a plain `<section>`. The fallback
 * composition's, and any variant's that frames nothing itself.
 */
export const SHARED_SECTIONS: SectionComposition = { renderers: {}, Frame: SharedFrame };

/**
 * Renders one section inside the composition's frame, which spreads the
 * section's FrameAttributes on its root: the DOM id (the render's id prefix,
 * then the section's anchor, anchorOf()), `data-section-id`, `data-kind`, `data-renderer`
 * (`bespoke` for the variant's own renderer, `shared` otherwise), the
 * section's `lang`, and a `dir` when that language runs the other way from
 * the portfolio.
 *
 * It renders nothing where sectionRenders() says so. A kind in the
 * manifest's `renderedKinds` uses the composition's renderer; an extension
 * kind it doesn't render uses the one its extension registered; every other
 * core kind uses the shared renderer. A renderers map that disagrees with
 * `renderedKinds` throws, since it's a mistake in the variant, not the
 * content.
 */
export function renderSection(
  section: Section,
  input: VariantRenderInput,
  composition: SectionComposition,
  options: RenderSectionOptions = {},
): ReactElement | null {
  const { renderedKinds } = input.capabilities;
  // The map is checked first, so a mistake shows even for a kind that's skipped.
  const declared = renderedKinds.includes(section.kind);
  const own = composition.renderers[section.kind as SectionKind] as
    SectionRenderer<Section> | undefined;
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
  // A composition without the kit's layout (kitLayout: false, K-5) has none of the
  // shared markup's styles, so handing a declared kind back to the kit's renderer is
  // a mistake to catch here, as a renderers map that disagrees with renderedKinds is.
  const kitOwn: Readonly<Record<string, unknown>> = SHARED_RENDERERS;
  if (declared && own === kitOwn[section.kind] && input.capabilities.kitLayout === false) {
    throw new TypeError(
      `${input.variant} sets kitLayout: false but renders ${section.kind} with the kit's own renderer, whose markup has no layout without the kit's stylesheet. Give it a renderer of your own.`,
    );
  }
  if (!sectionRenders(section, input)) return null;
  const Renderer =
    own ??
    (isExtensionSection(section)
      ? (hostModules().extensionRenderers?.[section.kind] as SectionRenderer<Section>)
      : (SHARED_RENDERERS[section.kind] as SectionRenderer<Section>));
  const level = options.level ?? 2;
  const { Frame } = composition;
  // A composition that passes the kit's own renderer back renders the kit's markup: shared.
  const shared: Readonly<Record<string, unknown>> = SHARED_RENDERERS;
  const bespoke = own !== undefined && own !== shared[section.kind];

  return (
    <Frame
      key={section.id}
      frame={frameAttributes(section, input, bespoke, anchorOf(section, composition))}
      section={section}
      level={level}
    >
      <Renderer section={section} input={input} level={level} />
    </Frame>
  );
}

/**
 * The content id the section's frame takes as its anchor, before the id
 * prefix, or null for none: the composition's anchorOf(), else the
 * section's own id.
 */
export function anchorOf(
  section: Section,
  composition: Pick<SectionComposition, 'anchorOf'> | undefined,
): string | null {
  const anchor = composition?.anchorOf?.(section);
  return anchor === undefined ? section.id : anchor;
}

/**
 * The attributes of the section's frame, in the order the element writes
 * them. `anchor` is the content id its DOM id is made from, the section's
 * own by default, or null for a frame with no id.
 */
export function frameAttributes(
  section: Section,
  input: Pick<VariantRenderInput, 'ids' | 'portfolio'>,
  bespoke: boolean,
  anchor: string | null = section.id,
): FrameAttributes {
  const direction = section.lang === undefined ? undefined : languageDirection(section.lang);
  const dir =
    direction !== undefined && direction !== input.portfolio.direction ? direction : undefined;
  return {
    ...(anchor !== null ? { id: `${input.ids.prefix}${anchor}` } : {}),
    'data-section-id': section.id,
    'data-kind': section.kind,
    'data-renderer': bespoke ? 'bespoke' : 'shared',
    ...(section.lang !== undefined ? { lang: section.lang } : {}),
    ...(dir !== undefined ? { dir } : {}),
  };
}
