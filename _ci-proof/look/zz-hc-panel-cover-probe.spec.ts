import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { startApp } from '../harness/app-server.mjs';
import { stuckCoverScript } from '../quality/lib/a11y/covers';
import { fixtureApp } from '../variants/target';
import { load } from './horizontal-cinema-model';

// A scratch probe, never committed: on platform-neutral, sepia-film, humanist-ui and light, at 1024
// and 1440 in the default row, the Appearance panel's third fieldset's fifth row's label, closed,
// open, and open with the label scrolled into view: its rects, the panel's box, scroll height and
// client height, the third fieldset's rows, the pin mark, what the page stacks at the label's line
// centre, and the quality walk's own cover script on the label. Each read is logged, and its line
// goes to <dir>/cover-<side>.jsonl beside a viewport shot <size>-<state>.png: <dir> is
// $PROOF_LOOK_OUT on CI (side $PROOF_LOOK_SIDE), else $PROBE_OUT (side $PROBE_SIDE), else the test's
// output dir.

const FIXTURE = CONTRACT_FIXTURES.find((fixture) => fixture.name === 'complete')!;
const HC = { manifest: { id: 'horizontal-cinema' } };
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;
const LABEL =
  '#appearance > div:nth-child(2) > form:nth-child(1) > fieldset:nth-child(3) > div:nth-child(5) > label:nth-child(1)';

function onTuple() {
  const app = fixtureApp(FIXTURE, HC);
  return {
    ...app,
    siteText: app
      .siteText!.replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: sepia-film')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: light'),
  };
}

const readState = (selector: string) => {
  const cssPath = (el: Element | null): string => {
    const parts: string[] = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const index = [...(node.parentElement?.children ?? [])].indexOf(node) + 1;
      const cls = node.classList[0] ? `.${node.classList[0]}` : '';
      parts.unshift(`${node.localName}${cls}:nth-child(${index})`);
    }
    return parts.join(' > ');
  };
  const box = (el: Element | null) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10);
  };
  const label = document.querySelector(selector);
  const details = document.querySelector<HTMLDetailsElement>('#appearance');
  const panel = document.querySelector<HTMLElement>(
    '#appearance > [data-ui-slot="disclosure.content"]',
  );
  const fieldset = label?.closest('fieldset') ?? null;
  const lines: number[][] = [];
  if (label) {
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects())
        lines.push([r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10));
    }
  }
  const centre = lines[0]
    ? [(lines[0][0]! + lines[0][2]!) / 2, (lines[0][1]! + lines[0][3]!) / 2]
    : null;
  const stack = centre
    ? document.elementsFromPoint(centre[0]!, centre[1]!).slice(0, 4).map(cssPath)
    : [];
  const ps = panel ? getComputedStyle(panel) : null;
  return {
    window: [innerWidth, innerHeight],
    scroll: [scrollX, scrollY],
    open: details?.open ?? null,
    pin: document.querySelector('.hc-shell')?.hasAttribute('data-pin') ?? null,
    view: document.querySelector('.hc')?.getAttribute('data-view') ?? null,
    label: label ? { text: label.textContent?.trim(), box: box(label), lines } : null,
    fieldset: fieldset
      ? {
          legend: fieldset.querySelector('legend')?.textContent?.trim(),
          rows: fieldset.querySelectorAll(':scope > div').length,
          box: box(fieldset),
        }
      : null,
    fieldsets: panel?.querySelectorAll('fieldset').length ?? null,
    panel: panel
      ? {
          box: box(panel),
          scrollHeight: panel.scrollHeight,
          clientHeight: panel.clientHeight,
          scrollTop: panel.scrollTop,
          position: ps!.position,
          maxBlockSize: ps!.maxBlockSize,
          overflowY: ps!.overflowY,
          contentVisibility: ps!.contentVisibility,
          display: ps!.display,
        }
      : null,
    band: box(document.querySelector('.hc-chrome')),
    frame: box(document.querySelector('.hc-frame')),
    frameStyle: (() => {
      const f = document.querySelector('.hc-frame');
      return f ? getComputedStyle(f).position : null;
    })(),
    centre,
    stack,
  };
};

async function record(page: Page, side: string, size: string, state: string) {
  const read = await page.evaluate(readState, LABEL);
  await page.evaluate(() => {
    (globalThis as unknown as { __name?: unknown }).__name ??= (f: unknown) => f;
  });
  const cover = await page
    .locator(LABEL)
    .evaluate(stuckCoverScript, 0)
    .catch((error: Error) => `error: ${error.message.slice(0, 200)}`);
  const dir = process.env.PROOF_LOOK_OUT || process.env.PROBE_OUT || test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ side, size, state, ...read, cover });
  console.log(`cover-probe ${line}`);
  appendFileSync(path.join(dir, `cover-${side}.jsonl`), `${line}\n`);
  await page.screenshot({
    path: path.join(dir, `${size}-${state.replace(/[^a-z0-9]+/g, '-')}.png`),
  });
  return read;
}

test.describe('cover probe: platform-neutral, sepia-film, humanist-ui, light', () => {
  test.describe.configure({ mode: 'default' });
  let app: Awaited<ReturnType<typeof startApp>>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    app = await startApp({
      ...onTuple(),
      logFile: test.info().outputPath('server.log'),
    });
  });
  test.afterAll(async () => {
    await app?.stop();
  });
  for (const size of SIZES)
    test(
      `cover probe at ${size.width}x${size.height}`,
      { tag: '@interaction' },
      async ({ browser }) => {
        const side = process.env.PROOF_LOOK_SIDE || process.env.PROBE_SIDE || 'side';
        const name = `${size.width}x${size.height}`;
        const context = await browser.newContext({
          viewport: size,
          baseURL: app.origin,
        });
        try {
          const page = await context.newPage();
          await load(page);
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          await page.waitForTimeout(400);
          await record(page, side, name, 'closed');
          const summary = page.locator('#appearance > summary');
          await page.keyboard.press('Shift');
          await summary.focus();
          await page.keyboard.press('Enter');
          await expect(page.locator('#appearance')).toHaveAttribute('open', '');
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          await record(page, side, name, 'open');
          await page
            .locator(LABEL)
            .evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          await record(page, side, name, 'open, label scrolled into view');
        } finally {
          await context.close();
        }
      },
    );
});
