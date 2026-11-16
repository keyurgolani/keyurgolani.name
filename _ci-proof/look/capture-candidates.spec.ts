// A look spec: which full-page capture shows a settled page's script nothing, so nothing a
// resize handler does can reach the shot? On CI Linux, a plain full-page capture fires one resize
// event, and a resize handler's change (at once, next frame, 0 ms timer) is in that shot every time.
// Growing the viewport first and capturing full-page still fires a resize and a media-query
// change. A first local run loaded the stand-in with setContent, where no init script runs, so
// every page now loads by navigation. The candidates, each ten captures at desktop and at mobile, launched as the variants
// projects launch Chromium:
// - beyond: today's capture, fullPage past the viewport (the control);
// - grown-viewport: the viewport grown to the page's height and settled, then a capture of the
//   viewport alone (fullPage false);
// - beyond-quiet: today's capture, with the page's resize listeners kept from the capture's resize
//   event (a capture-phase listener, added first, stops it while the shot is taken);
// - beyond-quiet-late: the same, with the capture-phase listener added just before the shot,
//   after the page's own (a capture-phase listener on window runs before its other listeners).
// Each logs what the page's script sees after the pre-capture mark and whether a resize handler's
// change shows in the shot. Logs, a first capture and its sha go to PROOF_LOOK_OUT.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<div id="now" style="height:200px;background:#fff"></div>
<div id="frame" style="height:200px;background:#fff"></div>
<div id="timer" style="height:200px;background:#fff"></div>
<div id="vh" style="height:100vh;background:#eee">100vh</div>
<div style="height:3000px"></div><p id="mark">mark</p>
<script>
const log = (k, v) => window.events.push({ t: performance.now(), k, v });
window.events = [];
addEventListener('resize', () => {
  log('resize', innerHeight);
  document.getElementById('now').style.background = 'rgb(255, 0, 0)';
  requestAnimationFrame(() => { document.getElementById('frame').style.background = 'rgb(0, 0, 255)'; });
  setTimeout(() => { document.getElementById('timer').style.background = 'rgb(0, 128, 0)'; }, 0);
});
new ResizeObserver((es) => { for (const e of es) log('ro-vh', Math.round(e.contentRect.height)); }).observe(document.getElementById('vh'));
matchMedia('(min-height: 2000px)').addEventListener('change', (e) => log('mq-min-height-2000', e.matches));
new IntersectionObserver((es) => { for (const e of es) log('io-mark', e.isIntersecting); }).observe(document.getElementById('mark'));
let last = '';
const sample = () => {
  const s = innerHeight + 'x' + document.documentElement.clientHeight;
  if (s !== last) { log('size', s); last = s; }
  requestAnimationFrame(sample);
};
requestAnimationFrame(sample);
</script></body></html>`;

/** Keeps the page's own resize listeners from a resize event while window.__shooting is set. */
function quietResize(): void {
  window.addEventListener(
    'resize',
    (event) => {
      if ((window as unknown as { __shooting?: boolean }).__shooting)
        event.stopImmediatePropagation();
    },
    true,
  );
}

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

function white(png: PNG, x: number, y: number): boolean {
  const at = (png.width * y + x) * 4;
  return png.data[at] === 255 && png.data[at + 1] === 255 && png.data[at + 2] === 255;
}

/** The stand-in's address, answered by the test itself. */
const ORIGIN = 'http://capture.test/';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const MODES = ['beyond', 'grown-viewport', 'beyond-quiet', 'beyond-quiet-late'] as const;

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    const name = `${mode}-${viewport.width}x${viewport.height}`;
    test(`a capture (${name}): what the page's script sees and what reaches the shot`, async ({
      playwright,
    }, testInfo) => {
      const out = process.env.PROOF_LOOK_OUT ?? testInfo.outputPath();
      mkdirSync(out, { recursive: true });
      const browser = await playwright.chromium.launch({ args: ['--disable-3d-apis'] });
      const lines = [`${name}: Chromium ${browser.version()} on ${process.platform}`];
      const count = { changed: 0, resized: 0, now: 0, frame: 0, timer: 0 };
      const shas = new Set<string>();
      try {
        for (let i = 1; i <= 10; i += 1) {
          const page = await browser.newPage({ viewport });
          if (mode === 'beyond-quiet') await page.addInitScript(quietResize);
          // A navigation, not setContent, so an init script runs before the page's own script, as
          // it does on the variants' pages.
          await page.route(ORIGIN, (route) =>
            route.fulfill({ body: PAGE, contentType: 'text/html' }),
          );
          await page.goto(ORIGIN);
          await settle(page);
          if (mode === 'grown-viewport') {
            const height = await page.evaluate(() =>
              Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
            );
            await page.setViewportSize({ width: viewport.width, height });
            await settle(page);
          }
          if (mode === 'beyond-quiet-late') await page.evaluate(quietResize);
          if (mode === 'beyond-quiet' || mode === 'beyond-quiet-late') {
            await page.evaluate(() => {
              (window as unknown as { __shooting?: boolean }).__shooting = true;
            });
          }
          const mark = await page.evaluate(() => performance.now());
          const shot = await page.screenshot({
            fullPage: mode !== 'grown-viewport',
            animations: 'disabled',
            caret: 'hide',
          });
          await settle(page);
          const events: Logged[] = await page.evaluate(
            () => (window as unknown as { events: Logged[] }).events,
          );
          const after = events.filter((e) => e.t > mark).map((e) => `${e.k}=${String(e.v)}`);
          const resized = events.filter((e) => e.t > mark && e.k === 'resize').length;
          const png = PNG.sync.read(shot);
          const x = Math.floor(viewport.width / 2);
          const seen = {
            now: !white(png, x, 100),
            frame: !white(png, x, 300),
            timer: !white(png, x, 500),
          };
          if (after.length > 0) count.changed += 1;
          if (resized > 0) count.resized += 1;
          for (const k of ['now', 'frame', 'timer'] as const) if (seen[k]) count[k] += 1;
          const sha = createHash('sha256').update(shot).digest('hex').slice(0, 12);
          shas.add(sha);
          if (i === 1) writeFileSync(path.join(out, `${name}.png`), shot);
          lines.push(
            `try ${i}: ${png.width}x${png.height} ${sha}; after the mark ${after.join(' ') || 'nothing'}; the shot shows now ${seen.now}, frame ${seen.frame}, timer ${seen.timer}`,
          );
          await page.close();
        }
      } finally {
        await browser.close();
      }
      lines.push(
        `${name}: of 10 captures, ${count.changed} showed the script anything after the mark (${count.resized} a resize); the shot showed a resize handler's change at once in ${count.now}, next frame in ${count.frame}, on a timer in ${count.timer}; ${shas.size} distinct shot(s)`,
      );
      writeFileSync(path.join(out, `${name}.txt`), `${lines.join('\n')}\n`);
      console.log(lines.at(-1));
      // A read: it fails only when nothing ran.
      expect(lines.length).toBe(12);
    });
  }
}
