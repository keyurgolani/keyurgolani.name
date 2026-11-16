import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Spatial Bento's dock on a phone holds the window's block end, and Tab stops each control above it.
// The dock casts the design language's overlay shadow, which paints above the dock's box: under
// neumorphic, a light in the canvas's colour 36px tall. Where Tab left a control just above the
// dock, its focus ring's foot lay under that light and washed out (the Record's folds, a repository
// link and the Appearance summary, at 1.8:1 to 2.2:1). Every control Tab stops at, with the dock
// shown, keeps its box's foot plus its ring's reach and 1px above the top of the dock's shadow,
// read from the dock's own computed box-shadow. Its own file, since a worker-scoped appOptions
// can't be set in a describe.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const site = parseDocument(
  fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
);
for (const [axis, value] of [
  ['designLanguage', 'neumorphic'],
  ['colorScheme', 'warm-parchment'],
  ['typography', 'humanist-ui'],
  ['displayMode', 'system'],
] as const) {
  site.setIn(['appearance', axis], value);
}

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: site.toString(),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  hasTouch: true,
  isMobile: true,
});

test(
  "at 390x844 under neumorphic: every control Tab stops at keeps its ring's foot above the dock's shadow",
  { annotation },
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const under: string[] = [];
    let measured = 0;
    let nearest = Infinity;
    for (let press = 0; press < 400; press += 1) {
      await page.keyboard.press('Tab');
      // Twice two frames with the scroll unmoved: where Tab left the page.
      await page.evaluate(async () => {
        const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
        let last = -1;
        for (let i = 0; i < 20; i += 1) {
          await frame();
          await frame();
          if (scrollY === last) return;
          last = scrollY;
        }
      });
      const read = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { done: true as const };
        const dock = document.querySelector<HTMLElement>('.sb-dock');
        if (!dock || el.closest('.sb-dock, .sb-menu-slot, dialog')) return { done: false as const };
        const look = getComputedStyle(dock);
        const shown =
          dock.getAttribute('data-state') !== 'hidden' &&
          look.visibility !== 'hidden' &&
          Number(look.opacity) > 0;
        if (!shown) return { done: false as const };
        // How far each outer layer paints above the dock: blur + spread - y, all in px as computed.
        let reach = 0;
        let depth = 0;
        let layer = '';
        const each: string[] = [];
        for (const char of `${look.boxShadow},`) {
          if (char === '(') depth += 1;
          if (char === ')') depth -= 1;
          if (char === ',' && depth === 0) {
            each.push(layer);
            layer = '';
          } else layer += char;
        }
        for (const one of each) {
          if (/\binset\b/.test(one)) continue;
          const lengths = [
            ...one.replace(/[a-z-]+\([^)]*\)/g, '').matchAll(/(-?\d*\.?\d+)px/g),
          ].map(([, n]) => Number(n));
          if (lengths.length < 2) continue;
          const [, y, blur = 0, spread = 0] = lengths as [number, number, number?, number?];
          reach = Math.max(reach, blur + spread - y);
        }
        const box = el.getBoundingClientRect();
        const dockBox = dock.getBoundingClientRect();
        const style = getComputedStyle(el);
        const ring = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${(el.textContent ?? '').trim().slice(0, 32)}`;
        return {
          done: false as const,
          name,
          inView: box.bottom > 0 && box.top < dockBox.top,
          foot: box.bottom + ring + 1,
          shadowTop: dockBox.top - reach,
        };
      });
      if (read.done) break;
      if (!('name' in read) || !read.inView) continue;
      measured += 1;
      nearest = Math.min(nearest, read.shadowTop - read.foot);
      if (read.foot > read.shadowTop) {
        under.push(
          `${read.name}: its ring's foot ${read.foot.toFixed(1)}, the shadow from ${read.shadowTop.toFixed(1)}`,
        );
      }
    }
    expect(measured, 'stops measured with the dock shown').toBeGreaterThan(10);
    expect(nearest, 'a stop came within 120px of the shadow').toBeLessThan(120);
    expect(under).toEqual([]);
  },
);
