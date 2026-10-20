import type { CoreSection, Portfolio, SectionKind } from '@portfolio/schema';
import { isExtensionSection } from '@portfolio/schema/ids';
import { ensureSectionId } from './format';

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

const DEFAULT_EXCLUDE: ReadonlyArray<SectionKind> = ['hero', 'cta'];

/**
 * Walk the portfolio's sections in declaration order and produce the
 * same `{ label, href }` pairs a manual nav config would. Skips hidden
 * sections, sections from content extensions (no variant renders them yet),
 * sections without a derivable label (no title, no fallback in `labelFor`),
 * and kinds in `excludeKinds`.
 *
 * Variants render the result however they want — top bar, side rail,
 * sticky pill — but all draw from this single source of truth so the
 * nav stays in sync with what the page actually contains.
 */
export function deriveNavItems(
  portfolio: Portfolio,
  options: DeriveNavItemsOptions = {},
): NavItem[] {
  const exclude = new Set(options.excludeKinds ?? DEFAULT_EXCLUDE);
  const items: NavItem[] = [];

  for (const section of portfolio.sections) {
    if (section.hidden || isExtensionSection(section)) continue;
    if (exclude.has(section.kind)) continue;

    const override = options.labelFor?.(section);
    if (override === null) continue;

    const label = override ?? section.title ?? null;
    if (!label) continue;

    const id = ensureSectionId(section.id, section.title ?? section.kind);
    items.push({ label, href: `#${id}` });

    if (options.limit !== undefined && items.length >= options.limit) break;
  }

  return items;
}
