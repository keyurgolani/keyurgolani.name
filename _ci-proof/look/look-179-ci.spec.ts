// Look shots for one CI read (laid in by the proof kit, never in a head's tree): Obsidian Atelier's
// entrance on the complete contract fixture in Art Deco, Iridescent Pearl and Neutral UI, high
// contrast, at 1024 under reduced transparency, as the quality cell reads it: the hero's label by
// the plaque, with 24 px round it. Beside the shot, the label's box, colour and grid place, and the
// layers under its centre.
// Out: $PROOF_LOOK_OUT/1024-reduced-transparency-label.png and .json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { PREFERENCE_ROWS } from '../quality/lib/matrix';
import { emulateRow } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
  viewport: { width: 1024, height: 768 },
});

const PACKS = {
  language: 'art-deco',
  scheme: 'iridescent-pearl',
  type: 'neutral-ui',
  mode: 'high-contrast',
} as const;

test('look 1024 high contrast reduced transparency hero label', async ({ page, app }) => {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams(PACKS).toString(),
      url: app.origin,
    },
  ]);
  await emulateRow(
    page,
    PREFERENCE_ROWS.find((each) => each.id === 'reduced-transparency')!,
  );
  await page.goto('/', { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-display-mode', PACKS.mode);
  await page.evaluate(() => document.fonts.ready);
  const label = page.locator('.oa-plaque__label').first();
  await expect(label).toHaveCount(1);
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((each) => each.finished.catch(() => undefined))),
  );
  const where = await label.evaluate((el) => {
    const r = (n: number) => Math.round(n * 10) / 10;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent ?? '').trim(),
      box: [r(b.left), r(b.top), r(b.right), r(b.bottom)],
      color: cs.color,
      background: cs.backgroundColor,
      gridArea: `${cs.gridRowStart} / ${cs.gridColumnStart}`,
      parent: `${el.parentElement!.localName}.${el.parentElement!.className}`,
      under: document
        .elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        .slice(0, 6)
        .map((layer) => {
          const s = getComputedStyle(layer);
          return `${layer.localName}.${typeof layer.className === 'string' ? layer.className : ''} bg ${s.backgroundColor} img ${s.backgroundImage.slice(0, 60)}`;
        }),
    };
  });
  writeFileSync(
    path.join(out, '1024-reduced-transparency-label.json'),
    `${JSON.stringify(where, null, 2)}\n`,
  );
  const box = (await label.boundingBox())!;
  const x = Math.max(0, box.x - 24);
  const y = Math.max(0, box.y - 24);
  await page.screenshot({
    path: path.join(out, '1024-reduced-transparency-label.png'),
    clip: {
      x,
      y,
      width: Math.min(1024 - x, box.width + 48),
      height: Math.min(768 - y, box.height + 48),
    },
    animations: 'disabled',
    caret: 'hide',
  });
});
