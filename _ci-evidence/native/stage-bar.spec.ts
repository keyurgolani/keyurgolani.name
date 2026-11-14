import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../../tests/harness/fixtures';
import { load } from '../../tests/e2e/horizontal-cinema-model';

// Evidence only, never merged: Horizontal Cinema's stage hides its own scrollbar, and the shared
// layer gives every scroller in a boundary WebKit's scrollbar parts. Read in each engine, on the
// complete fixture at 1440x900, whether the stage's bar stays hidden: its box less its borders and
// its client area, down and across. The strip needs a fine pointer that hovers; where the engine
// reports none, Horizontal Cinema stacks its scenes and the stage doesn't scroll sideways, so there
// the read checks that it's that media that stacked it. Its own file, since a worker-scoped
// appOptions can't be set in a describe.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test("Horizontal Cinema's stage keeps its own bar hidden", async ({ page }) => {
  await load(page);
  const read = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const style = getComputedStyle(stage) as CSSStyleDeclaration & { scrollbarWidth?: string };
    const px = (value: string) => Number.parseFloat(value) || 0;
    return {
      block:
        stage.offsetHeight -
        stage.clientHeight -
        px(style.borderTopWidth) -
        px(style.borderBottomWidth),
      inline:
        stage.offsetWidth -
        stage.clientWidth -
        px(style.borderLeftWidth) -
        px(style.borderRightWidth),
      offsetHeight: stage.offsetHeight,
      clientHeight: stage.clientHeight,
      overflowX: style.overflowX,
      scrollbarWidth: style.scrollbarWidth ?? null,
      readsWidth: CSS.supports('scrollbar-width', 'none'),
      scrolls: stage.scrollWidth > stage.clientWidth,
      strip: ['auto', 'scroll'].includes(style.overflowX),
      finePointer: matchMedia('(hover: hover) and (pointer: fine)').matches,
    };
  });
  const out = process.env.EV_OUT ?? 'native-evidence';
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, `stage-bar-${test.info().project.name}.json`),
    JSON.stringify(read, null, 1),
  );
  expect(read.block, "the stage's bar takes no room").toBe(0);
  if (read.strip) expect(read.scrolls, 'the strip scrolls sideways').toBe(true);
  else expect(read.finePointer, 'the scenes stack only where no fine pointer hovers').toBe(false);
});
