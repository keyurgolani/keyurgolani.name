// A look spec: what does a Chromium full-page capture past the viewport show a page's script once
// the page has settled? A stand-in page logs every IntersectionObserver delivery (the viewport
// root, and a 100% bottom margin), resize events, the viewport's sizes each frame, a 100vh
// element's size and a min-height media query. Each test takes ten captures and marks the time
// just before each. It fails if anything but a resize event is logged after the mark; resize
// events are counted on their own (a local probe saw one in every capture, with the sizes the
// same). The paint tests read whether a resize handler's change reaches the capture: set at once,
// on the next frame, or on a timer. Every log and a first capture go to PROOF_LOOK_OUT.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<div id="vh" style="height:100vh;background:#eee">100vh</div>
<div style="height:3000px"></div><p id="mark">mark</p>
<script>
const log = (k, v) => window.events.push({ t: performance.now(), k, v });
window.events = [];
addEventListener('resize', () => log('resize', innerHeight));
new ResizeObserver((es) => { for (const e of es) log('ro-vh', Math.round(e.contentRect.height)); }).observe(document.getElementById('vh'));
new ResizeObserver((es) => { for (const e of es) log('ro-html', Math.round(e.contentRect.height)); }).observe(document.documentElement);
matchMedia('(min-height: 2000px)').addEventListener('change', (e) => log('mq-min-height-2000', e.matches));
new IntersectionObserver((es) => { for (const e of es) log('io-mark', e.isIntersecting); }).observe(document.getElementById('mark'));
new IntersectionObserver((es) => { for (const e of es) log('io-mark-margin', e.isIntersecting); }, { rootMargin: '0px 0px 100% 0px' }).observe(document.getElementById('mark'));
let last = '';
const sample = () => {
  const s = innerHeight + 'x' + document.documentElement.clientHeight + ' vv ' + Math.round(visualViewport.height);
  if (s !== last) { log('size', s); last = s; }
  requestAnimationFrame(sample);
};
requestAnimationFrame(sample);
</script></body></html>`;

interface Logged {
  readonly t: number;
  readonly k: string;
  readonly v: unknown;
}

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

async function settle(page: Page): Promise<void> {
  await frames(page);
  await page.waitForTimeout(300);
  await frames(page);
}

const LAUNCHES = [
  { name: 'default', args: [] as string[] },
  // As the variants projects launch Chromium.
  { name: 'no-webgl', args: ['--disable-3d-apis'] },
];
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
];
// beyond: the page as it is, captured past the viewport; grown: the viewport grown to the page's
// height first, so the capture fits it.
const MODES = ['beyond', 'grown'] as const;

for (const launch of LAUNCHES) {
  for (const viewport of VIEWPORTS) {
    for (const mode of MODES) {
      const name = `${launch.name}-${viewport.width}x${viewport.height}-${mode}`;
      test(`a full-page capture (${name}) shows the page's script nothing once it has settled`, async ({
        playwright,
      }, testInfo) => {
        const out = process.env.PROOF_LOOK_OUT ?? testInfo.outputPath();
        mkdirSync(out, { recursive: true });
        const browser = await playwright.chromium.launch({ args: launch.args });
        const lines = [`${name}: Chromium ${browser.version()} on ${process.platform}`];
        let changed = 0;
        let resizes = 0;
        try {
          for (let i = 1; i <= 10; i += 1) {
            const page = await browser.newPage({ viewport });
            await page.setContent(PAGE);
            await settle(page);
            if (mode === 'grown') {
              const height = await page.evaluate(() =>
                Math.max(
                  document.body.scrollHeight,
                  document.documentElement.scrollHeight,
                  document.body.offsetHeight,
                  document.documentElement.offsetHeight,
                  document.documentElement.clientHeight,
                ),
              );
              await page.setViewportSize({ width: viewport.width, height });
              await settle(page);
            }
            const mark = await page.evaluate(() => performance.now());
            const shot = await page.screenshot({
              fullPage: true,
              animations: 'disabled',
              caret: 'hide',
            });
            if (i === 1) writeFileSync(path.join(out, `${name}.png`), shot);
            await settle(page);
            const events: Logged[] = await page.evaluate(
              () => (window as unknown as { events: Logged[] }).events,
            );
            const say = (e: Logged) => `${e.k}=${String(e.v)}`;
            const after = events.filter((e) => e.t > mark && e.k !== 'resize').map(say);
            const resized = events.filter((e) => e.t > mark && e.k === 'resize').length;
            if (after.length > 0) changed += 1;
            if (resized > 0) resizes += 1;
            lines.push(
              `try ${i}: before the mark ${events
                .filter((e) => e.t <= mark)
                .map(say)
                .join(
                  ' ',
                )}; after it ${after.join(' ') || 'nothing'}, and ${resized} resize event(s)`,
            );
            await page.close();
          }
        } finally {
          await browser.close();
        }
        lines.push(`${name}: ${resizes} of 10 captures fired a resize event after the mark`);
        lines.push(`${name}: ${changed} of 10 captures showed the script a change after the mark`);
        writeFileSync(path.join(out, `${name}.txt`), `${lines.join('\n')}\n`);
        console.log(lines.at(-1));
        expect(changed, lines.join('\n')).toBe(0);
      });
    }
  }
}

// A resize handler's change, and whether the capture shows it: each block turns from white to its
// colour when the page gets a resize event, at once, on the next frame, or on a 0 ms timer.
const PAINT = `<!doctype html><html><body style="margin:0">
<div id="now" style="height:200px;background:#fff"></div>
<div id="frame" style="height:200px;background:#fff"></div>
<div id="timer" style="height:200px;background:#fff"></div>
<div style="height:3000px"></div>
<script>
window.resized = 0;
addEventListener('resize', () => {
  window.resized += 1;
  document.getElementById('now').style.background = 'rgb(255, 0, 0)';
  requestAnimationFrame(() => { document.getElementById('frame').style.background = 'rgb(0, 0, 255)'; });
  setTimeout(() => { document.getElementById('timer').style.background = 'rgb(0, 128, 0)'; }, 0);
});
</script></body></html>`;

/** Whether the pixel at (x, y) of a PNG is white. */
function white(png: PNG, x: number, y: number): boolean {
  const at = (png.width * y + x) * 4;
  return png.data[at] === 255 && png.data[at + 1] === 255 && png.data[at + 2] === 255;
}

for (const launch of LAUNCHES) {
  for (const viewport of VIEWPORTS) {
    const name = `paint-${launch.name}-${viewport.width}x${viewport.height}`;
    test(`a full-page capture (${name}): which of a resize handler's changes the shot shows`, async ({
      playwright,
    }, testInfo) => {
      const out = process.env.PROOF_LOOK_OUT ?? testInfo.outputPath();
      mkdirSync(out, { recursive: true });
      const browser = await playwright.chromium.launch({ args: launch.args });
      const lines = [`${name}: Chromium ${browser.version()} on ${process.platform}`];
      const shown = { now: 0, frame: 0, timer: 0, resized: 0 };
      try {
        for (let i = 1; i <= 10; i += 1) {
          const page = await browser.newPage({ viewport });
          await page.setContent(PAINT);
          await settle(page);
          const shot = await page.screenshot({
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
          });
          if (i === 1) writeFileSync(path.join(out, `${name}.png`), shot);
          await settle(page);
          const resized = await page.evaluate(
            () => (window as unknown as { resized: number }).resized,
          );
          const png = PNG.sync.read(shot);
          const x = Math.floor(viewport.width / 2);
          const seen = {
            now: !white(png, x, 100),
            frame: !white(png, x, 300),
            timer: !white(png, x, 500),
          };
          if (resized > 0) shown.resized += 1;
          for (const k of ['now', 'frame', 'timer'] as const) if (seen[k]) shown[k] += 1;
          lines.push(
            `try ${i}: ${resized} resize event(s); the shot shows now ${seen.now}, frame ${seen.frame}, timer ${seen.timer}`,
          );
          await page.close();
        }
      } finally {
        await browser.close();
      }
      lines.push(
        `${name}: of 10 captures, ${shown.resized} fired a resize; the shot showed the change made at once in ${shown.now}, on the next frame in ${shown.frame}, on a timer in ${shown.timer}`,
      );
      writeFileSync(path.join(out, `${name}.txt`), `${lines.join('\n')}\n`);
      console.log(lines.at(-1));
      // A read: it fails only when nothing ran.
      expect(lines.length).toBe(12);
    });
  }
}
