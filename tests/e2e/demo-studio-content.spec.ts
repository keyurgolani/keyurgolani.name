import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ElementHandle, Page } from '@playwright/test';
import { parse } from 'yaml';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { DEMO_FRAME, picker } from '../harness/studio-tasks';

// Demo Studio's Content in the split (DEM-1, the Wednesday cut's second
// blocker): every way to it, the bottom bar's Export setup, the phone menu's
// Export setup, and Content in the source menu's Tasks, keeps the split shell,
// its rail beside the same live stage, with the top bar, the look bar, undo
// and redo, Compare and Share as Appearance has them, and never the old
// frame's header, tab rail, or "Where things stand" cards. The rail is the
// Import and export panel: Export setup writes two YAML files a visitor can
// download, and the drop zone's "Choose two files" button, or a drop, imports
// a pair into /preview/local.

const ANNOTATION = [
  { type: 'route', description: '/studio' },
  { type: 'route', description: '/preview/local' },
  { type: 'profile', description: 'demo' },
];

const EXAMPLE = {
  portfolio: fileURLToPath(new URL('../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../site.example.yml', import.meta.url)),
};

// The local frame is opaque, so it can't register a service worker either way: allowing them
// only keeps Playwright's own init script from throwing in it (as demo-studio-import.spec.ts).
test.use({ appOptions: DEMO_APP, serviceWorkers: 'allow' });

const rail = (page: Page) => page.getByRole('region', { name: 'Export and import', exact: true });
const preview = (page: Page) => page.getByRole('region', { name: 'Preview', exact: true });

/** Opens Demo Studio on Appearance, at `width` by `height`, and waits for its stage. */
async function openAppearance(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await expect(page.locator('.studio-split')).toBeVisible();
  // At a phone's width the stage waits behind its poster until asked: the preview's region is there.
  await expect(preview(page)).toBeVisible();
}

/** The stage's frame once it shows the sample, as an element to hold across a task change. */
async function liveFrame(page: Page): Promise<ElementHandle<HTMLIFrameElement>> {
  const iframe = preview(page).locator(DEMO_FRAME);
  await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
  await expect(preview(page).locator('.preview-surface__stage')).toHaveAttribute(
    'data-phase',
    'ready',
  );
  return (await iframe.elementHandle()) as ElementHandle<HTMLIFrameElement>;
}

/**
 * Checks the page is Content in the split: the rail of its own beside the same stage, the
 * frame `held` still the one on it, at the src it had, and nothing of the old Content screen.
 */
async function inSplit(page: Page, held: ElementHandle<HTMLIFrameElement>, src: string) {
  await expect(page).toHaveURL(/#content$/);
  await expect(rail(page)).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'Export setup', exact: true })).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'Choose two files' })).toBeVisible();
  await expect(rail(page)).toContainText('Two files, YAML or JSON, up to 1 MiB each.');
  await expect(preview(page)).toBeVisible();
  // The same frame document, never loaded again: the stage stayed live.
  expect(await held.evaluate((node) => node.isConnected)).toBe(true);
  expect(await held.getAttribute('src')).toBe(src);
  await expect(preview(page).locator('iframe')).toHaveCount(1);
  // None of the old frame: its header, its Appearance and Content tab rail, its cards.
  await expect(page.locator('.studio-shell__header, .studio-shell__nav')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Where things stand' })).toHaveCount(0);
  await expect(page.locator('.studio-state__lines:visible')).toHaveCount(0);
  // The live region stays out of sight: what it said never shows as body text.
  const notice = page.locator('.studio-state__notice');
  expect(
    await notice.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.width <= 1 && box.height <= 1;
    }),
  ).toBe(true);
  await expect(page.locator('main')).not.toContainText('Stopped comparing.', {
    useInnerText: true,
  });
}

test(
  'the bottom bar’s Export setup opens Content in the split, beside the same live frame, with the top bar, the look bar, undo and redo, Compare and Share',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openAppearance(page, 1440, 900);
    // A comparison started and stopped first, whose "Stopped comparing." must stay out of the body.
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Compare A and B' })).toBeVisible();
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Compare A and B' })).toHaveCount(0);
    // The frame after it, which Content must keep.
    const held = await liveFrame(page);
    const src = (await held.getAttribute('src'))!;
    await page.locator('.studio-split__bottom').getByRole('link', { name: 'Export setup' }).click();
    await inSplit(page, held, src);
    // The top bar and the look bar as Appearance has them.
    await expect(page.getByRole('button', { name: /the content source$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
    const look = rail(page).getByRole('group', { name: 'The current look' });
    await expect(look).toBeVisible();
    // The rail's own content sits below the look bar, and the stage beside the rail.
    const lookBox = (await look.boundingBox())!;
    const exportBox = (await rail(page)
      .getByRole('button', { name: 'Export setup', exact: true })
      .boundingBox())!;
    expect(exportBox.y).toBeGreaterThan(lookBox.y + lookBox.height - 1);
    const railBox = (await rail(page).boundingBox())!;
    const stageBox = (await preview(page).locator('.preview-surface__stage').boundingBox())!;
    expect(stageBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1);
    expect(stageBox.y).toBeLessThan(900);
    // The way back: the bottom bar, then a look row, which opens its axis in Appearance.
    await expect(
      page.locator('.studio-split__bottom').getByRole('link', { name: 'Back to Appearance' }),
    ).toBeVisible();
    await look.getByRole('button', { name: /^Color scheme/ }).click();
    await expect(page).toHaveURL(/#appearance$/);
    await expect(picker(page, 'Color scheme')).toBeVisible();
    expect(await held.evaluate((node) => node.isConnected)).toBe(true);
  },
);

test(
  'Content in the source menu’s Tasks opens the same split, beside the same live frame',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openAppearance(page, 1440, 900);
    const held = await liveFrame(page);
    const src = (await held.getAttribute('src'))!;
    await page.getByRole('button', { name: /the content source$/ }).click();
    await page
      .getByRole('navigation', { name: 'Studio tasks' })
      .getByRole('link', { name: 'Content', exact: true })
      .click();
    await inSplit(page, held, src);
    await expect(
      page.locator('nav[aria-label="Studio tasks"] a.studio-shell__task[href="#content"]').first(),
    ).toHaveAttribute('aria-current', 'page');
  },
);

test(
  'at a phone’s width the menu’s Export setup opens the panel as the sheet, the frame keeping the top',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openAppearance(page, 390, 844);
    // The phone's preview waits to be asked; once asked, it is the frame the sheet must keep.
    await page.getByRole('button', { name: 'Show preview' }).click();
    const held = await liveFrame(page);
    const src = (await held.getAttribute('src'))!;
    await page.getByRole('button', { name: /^More:/ }).click();
    await page
      .locator('.studio-more')
      .getByRole('link', { name: 'Export setup', exact: true })
      .click();
    await inSplit(page, held, src);
    // The sheet is the panel: no axis tabs. The frame keeps the top of the screen.
    await expect(rail(page).getByRole('tablist')).toHaveCount(0);
    const railBox = (await rail(page).boundingBox())!;
    const stageBox = (await preview(page).locator('.preview-surface__stage').boundingBox())!;
    expect(stageBox.y).toBeLessThan(railBox.y);
    expect(railBox.y).toBeGreaterThan(844 * 0.4);
    // Export setup, the panel's main action, is at least 44px tall to touch.
    const action = (await rail(page)
      .getByRole('button', { name: 'Export setup', exact: true })
      .boundingBox())!;
    expect(action.height).toBeGreaterThanOrEqual(44);
  },
);

/** Clicks the download link for `name`, and returns the file's name and text. */
async function download(page: Page, name: string) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    rail(page)
      .getByRole('link', { name: `Download ${name}`, exact: true })
      .click(),
  ]);
  return { name: file.suggestedFilename(), text: readFileSync((await file.path())!, 'utf8') };
}

test(
  'Export setup in the panel downloads the sample as portfolio.yml and site.yml, each a schema document the disclosure names',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openAppearance(page, 1440, 900);
    await page.locator('.studio-split__bottom').getByRole('link', { name: 'Export setup' }).click();
    await rail(page).getByRole('button', { name: 'Export setup', exact: true }).click();
    const disclosure = rail(page).locator('.studio-export__disclosure');
    await expect(disclosure).toContainText('Schema versions:');
    const versions = /portfolio (\d+), site (\d+)\./.exec((await disclosure.textContent()) ?? '');
    expect(versions, 'the disclosure names both schema versions').not.toBeNull();
    const portfolio = await download(page, 'portfolio.yml');
    const site = await download(page, 'site.yml');
    expect([portfolio.name, site.name]).toEqual(['portfolio.yml', 'site.yml']);
    const read = { portfolio: parse(portfolio.text), site: parse(site.text) } as Record<
      'portfolio' | 'site',
      Record<string, unknown>
    >;
    expect(read.portfolio.schemaVersion).toBe(Number(versions![1]));
    expect(read.site.schemaVersion).toBe(Number(versions![2]));
    // The sample's own documents: the portfolio names its person, the site has its appearance.
    expect(read.portfolio.identity).toEqual(expect.objectContaining({ name: expect.any(String) }));
    expect(read.site.appearance).toEqual(expect.any(Object));
    // Still the split.
    await expect(preview(page).locator('iframe')).toHaveCount(1);
  },
);

test(
  "the drop zone's Choose two files opens the picker for two files, and the pair it takes shows in /preview/local in the same split",
  { annotation: ANNOTATION },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/studio#content');
    await expect(rail(page)).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      rail(page).getByRole('button', { name: 'Choose two files' }).click(),
    ]);
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles([EXAMPLE.portfolio, EXAMPLE.site]);
    const report = rail(page).locator('.studio-import__report');
    await expect(report).toHaveAttribute('data-import', 'imported');
    await expect(report.locator('[role="status"]')).toContainText('Imported.');
    const local = preview(page).locator('[data-source="local"]');
    await expect(local).toHaveAttribute('data-phase', 'ready');
    await expect(local.locator(DEMO_FRAME)).toHaveAttribute(
      'src',
      /^\/preview\/local#nonce=[A-Za-z0-9_-]{22}$/,
    );
    await expect(rail(page)).toContainText('Writes your imported documents as two YAML files.');
    await expect(page.getByRole('button', { name: /the content source$/ })).toContainText(
      'Your documents',
    );
  },
);

test(
  'two files dropped on the drop zone import as the button’s pick does, and the zone shows the drag while it lasts',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/studio#content');
    const zone = rail(page).locator('.studio-drop');
    await expect(zone).toBeVisible();
    const texts = [readFileSync(EXAMPLE.portfolio, 'utf8'), readFileSync(EXAMPLE.site, 'utf8')];
    const transfer = await page.evaluateHandle(([portfolio, site]) => {
      const data = new DataTransfer();
      data.items.add(new File([portfolio!], 'portfolio.yml', { type: 'application/yaml' }));
      data.items.add(new File([site!], 'site.yml', { type: 'application/yaml' }));
      return data;
    }, texts);
    await zone.dispatchEvent('dragenter', { dataTransfer: transfer });
    await zone.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(zone).toHaveAttribute('data-over', 'true');
    await zone.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(zone).not.toHaveAttribute('data-over', 'true');
    const report = rail(page).locator('.studio-import__report');
    await expect(report).toHaveAttribute('data-import', 'imported');
    await expect(preview(page).locator('[data-source="local"]')).toHaveAttribute(
      'data-phase',
      'ready',
    );
  },
);
