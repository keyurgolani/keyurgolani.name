// axe for the quality cells (#11, Slice 1, item 1): @axe-core/playwright
// with the WCAG 2.2 AA tags quality/thresholds.json's conformance names
// (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa), and nothing else.

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../quality/thresholds';

/** WCAG 2.0, 2.1, and 2.2 at levels A and AA, as the thresholds file lists them. */
export const AXE_TAGS: readonly string[] = loadThresholds().conformance.axeTags;

/** An axe run over the whole page with the cells' tags. */
export function axeFor(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags([...AXE_TAGS]);
}
