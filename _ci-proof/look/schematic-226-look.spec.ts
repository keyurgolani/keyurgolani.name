// Look for Schematic's words (not for commit): the foot's title block and the schedule, base and head,
// where they broke words (200% text; the foot's four columns at 100% under wide faces) and at 100%
// text where nothing may move ("still-", where every word already held). PNGs under $PROOF_LOOK_OUT; the same bytes at both sides.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test } from '../harness/fixtures';
import { openTuple, servingSchematic, type Tuple } from './schematic-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSchematic() });
test.describe.configure({ timeout: 180_000 });

const ACCESSIBLE: Tuple = 'material-3-inspired/control-room/accessible-reading/dark';
const SERIF: Tuple = 'platform-neutral/warm-parchment/field-serif/system';
const HUMANIST: Tuple = 'platform-neutral/warm-parchment/humanist-ui/system';
const FOOT = '.sx-foot .sx-tb';
const SCHEDULE = '.sx-schedule';

const SHOTS: readonly {
  stem: string;
  tuple: Tuple;
  width: number;
  height: number;
  text?: number;
  selector: string;
}[] = [
  {
    stem: 'foot-accessible-1024-200',
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    text: 2,
    selector: FOOT,
  },
  { stem: 'foot-serif-1024-200', tuple: SERIF, width: 1024, height: 768, text: 2, selector: FOOT },
  {
    stem: 'foot-accessible-1440-200',
    tuple: ACCESSIBLE,
    width: 1440,
    height: 900,
    text: 2,
    selector: FOOT,
  },
  {
    stem: 'schedule-accessible-1024-200',
    tuple: ACCESSIBLE,
    width: 1024,
    height: 768,
    text: 2,
    selector: SCHEDULE,
  },
  {
    stem: 'schedule-accessible-1440-200',
    tuple: ACCESSIBLE,
    width: 1440,
    height: 900,
    text: 2,
    selector: SCHEDULE,
  },
  {
    stem: 'schedule-accessible-320',
    tuple: ACCESSIBLE,
    width: 320,
    height: 568,
    selector: SCHEDULE,
  },
  { stem: 'foot-accessible-1024', tuple: ACCESSIBLE, width: 1024, height: 768, selector: FOOT },
  {
    stem: 'foot-accessible-1440',
    tuple: 'platform-neutral/warm-parchment/accessible-reading/system',
    width: 1440,
    height: 900,
    selector: FOOT,
  },
  {
    stem: 'foot-shell-mono-1280',
    tuple: 'platform-neutral/warm-parchment/shell-mono/system',
    width: 1280,
    height: 800,
    selector: FOOT,
  },
  { stem: 'foot-humanist-1152', tuple: HUMANIST, width: 1152, height: 800, selector: FOOT },
  {
    stem: 'foot-drafting-grotesk-1280',
    tuple: 'platform-neutral/warm-parchment/drafting-grotesk/system',
    width: 1280,
    height: 800,
    selector: FOOT,
  },
  {
    stem: 'foot-paste-up-1280',
    tuple: 'platform-neutral/warm-parchment/paste-up/system',
    width: 1280,
    height: 800,
    selector: FOOT,
  },
  {
    stem: 'foot-shell-mono-1366',
    tuple: 'platform-neutral/warm-parchment/shell-mono/system',
    width: 1366,
    height: 800,
    selector: FOOT,
  },
  {
    stem: 'still-foot-technical-sans-mono-1152',
    tuple: 'platform-neutral/warm-parchment/technical-sans-mono/system',
    width: 1152,
    height: 800,
    selector: FOOT,
  },
  { stem: 'still-foot-humanist-1440', tuple: HUMANIST, width: 1440, height: 900, selector: FOOT },
  { stem: 'still-foot-humanist-1600', tuple: HUMANIST, width: 1600, height: 900, selector: FOOT },
  {
    stem: 'still-schedule-accessible-768',
    tuple: ACCESSIBLE,
    width: 768,
    height: 1024,
    selector: SCHEDULE,
  },
  {
    stem: 'still-schedule-humanist-390',
    tuple: HUMANIST,
    width: 390,
    height: 844,
    selector: SCHEDULE,
  },
  { stem: 'still-foot-humanist-390', tuple: HUMANIST, width: 390, height: 844, selector: FOOT },
];

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

for (const shot of SHOTS)
  test(`look ${shot.stem}`, async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await openTuple(page, app.origin, shot.tuple);
    if (shot.text)
      await page.evaluate(
        (scale) =>
          document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
        shot.text,
      );
    await frames(page);
    const el = page.locator(shot.selector).first();
    await el.scrollIntoViewIfNeeded();
    await frames(page);
    const box = await el.boundingBox();
    await el.screenshot({ path: path.join(OUT, `${shot.stem}.png`), animations: 'disabled' });
    writeFileSync(
      path.join(OUT, `${shot.stem}.json`),
      JSON.stringify({ selector: shot.selector, box }),
    );
  });
