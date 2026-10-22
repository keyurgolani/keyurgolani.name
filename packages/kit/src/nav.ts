import type { CoreSection, SectionKind } from '@portfolio/schema';
import { isExtensionSection } from '@portfolio/schema/ids';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { rendersKind, sectionShows } from './sections/view';

export interface NavItem {
  label: string;
  href: string;
}

export interface DeriveNavItemsOptions {
  /** Cap on returned items. Defaults to no cap. */
  limit?: number;
  /** Section kinds to skip even if they have a title. */
  excludeKinds?: ReadonlyArray<SectionKind>;
  /** Override the label for a given section kind. Returns null to skip. */
  labelFor?: (section: CoreSection) => string | null;
}

/**
 * What the navigation reads: the public view's portfolio, and the render's
 * ids and the composition's capabilities when there's a render input.
 */
export interface NavSource {
  readonly portfolio: VariantRenderInput['portfolio'];
  readonly ids?: { readonly prefix: string };
  readonly capabilities?: { readonly unsupportedKinds: readonly string[] };
}

const DEFAULT_EXCLUDE: ReadonlyArray<SectionKind> = ['hero', 'cta'];

/**
 * Walk the public view's sections in their order and produce the `{ label,
 * href }` pairs a navigation shows: each section's own title, linking to its
 * content id, with the render's id prefix when given a render input. Skips
 * sections from content extensions (no variant renders them yet), sections
 * without a title and no `labelFor` label, kinds in `excludeKinds`, and the
 * sections renderSection() leaves off the page too: a kind the composition's
 * unsupportedKinds lists, and any section with nothing public to show.
 * Hidden sections never get here: the public view drops them.
 *
 * Variants render the result however they want (top bar, side rail, sticky
 * pill), but all draw from this one source, so the navigation stays in step
 * with what the page contains.
 */
export function deriveNavItems(view: NavSource, options: DeriveNavItemsOptions = {}): NavItem[] {
  const exclude = new Set(options.excludeKinds ?? DEFAULT_EXCLUDE);
  const prefix = view.ids?.prefix ?? '';
  const items: NavItem[] = [];

  for (const section of view.portfolio.sections) {
    if (isExtensionSection(section)) continue;
    if (exclude.has(section.kind)) continue;
    if (!rendersKind(section, view)) continue;
    if (!sectionShows(section, view)) continue;

    const override = options.labelFor?.(section);
    if (override === null) continue;

    const label = override ?? section.title ?? null;
    if (!label) continue;

    items.push({ label, href: `#${prefix}${section.id}` });

    if (options.limit !== undefined && items.length >= options.limit) break;
  }

  return items;
}
