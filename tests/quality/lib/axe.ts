// axe for the quality cells (#11, Slice 1, item 1): @axe-core/playwright
// with the WCAG 2.2 AA tags the body names, and nothing else.

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** WCAG 2.0, 2.1, and 2.2 at levels A and AA. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** An axe run over the whole page with the cells' tags. */
export function axeFor(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags([...AXE_TAGS]);
}
