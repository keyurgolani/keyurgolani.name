import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect } from '../harness/fixtures';

// The complete fixture through Obsidian Atelier as the quality cells serve it: every pack axis and
// the display mode the visitor's to pick, so one server renders any tuple, picked by the appearance
// cookie (design language / colour scheme / typography / display mode, the cells' order).

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

export const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** The complete fixture through Obsidian Atelier, every pack axis and the mode selectable. */
export function servingObsidianAtelier() {
  const site = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier')
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  if (!/\n {2}designLanguage: selectable\n[\s\S]*\n {2}typography: selectable\n/.test(site)) {
    throw new Error(
      "The complete fixture's visitor controls moved: update servingObsidianAtelier().",
    );
  }
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

/** A tuple as the cells name it: design language / colour scheme / typography / display mode. */
export type Tuple = `${string}/${string}/${string}/${string}`;

/** Loads `at` under `tuple`, the visitor's appearance cookie, and checks the boundary renders its packs. */
export async function openTuple(page: Page, origin: string, tuple: Tuple, at = '/') {
  const [language, scheme, type, mode] = tuple.split('/') as [string, string, string, string];
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ language, scheme, type, mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto(at, { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-variant', 'obsidian-atelier');
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-color-scheme', scheme);
  await expect(boundary).toHaveAttribute('data-typography', type);
  if (mode !== 'system') await expect(boundary).toHaveAttribute('data-display-mode', mode);
  await page.evaluate(() => document.fonts.ready);
}

/** The root text at `size`, as a reader's own setting does, and two frames drawn. */
export async function rootText(page: Page, size: string) {
  await page.evaluate(
    (value) => document.documentElement.style.setProperty('font-size', value, 'important'),
    size,
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
