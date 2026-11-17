import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The CI probe's look (copied in, never committed): Aurora Glass on the long-text fixture at phone
// widths, home and a work page. Every text line is read for whether it runs past the viewport,
// past its card (the nearest .ag-pane, .ag-lite or .ag-sheet) or past an ancestor that clips its
// overflow; the page's own sideways scroll is read too. For the About section's unbreakable word
// (id about) each ancestor up to .ag is printed with its display, its width, its scroll width and
// its grid tracks, so the box that grows is named. Shots to PROOF_LOOK_OUT: the About section.

const OUT = process.env.PROOF_LOOK_OUT ?? '';
const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const width of [320, 390, 414])
  for (const route of ['/', '/work/same-name'])
    test(`probe: Aurora Glass long text at ${width}, ${route}`, async ({ page }) => {
      test.setTimeout(120_000);
      if (OUT) mkdirSync(OUT, { recursive: true });
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const res = await page.goto(route, { waitUntil: 'networkidle' });
      if (!res || res.status() >= 400) {
        console.log(`probe overflow ${width} ${route}: status ${res?.status()}`);
        return;
      }
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'aurora-glass',
      );
      const read = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out: string[] = [];
        const name = (el: Element) =>
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;
        const inner = (el: Element) => {
          const c = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            left: c.left + parseFloat(cs.borderLeftWidth),
            right: c.right - parseFloat(cs.borderRightWidth),
          };
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          if (!text.trim()) continue;
          const parent = node.parentElement!;
          const s = getComputedStyle(parent);
          if (s.visibility === 'hidden' || s.display === 'none') continue;
          if (parent.closest('[hidden], dialog:not([open]), .ag-hidden, [aria-hidden="true"]'))
            continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          let clip: Element | null = null;
          for (let a: Element | null = parent; a; a = a.parentElement) {
            const o = getComputedStyle(a).overflowX;
            if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') {
              clip = a;
              break;
            }
          }
          const card = parent.closest('.ag-pane, .ag-lite, .ag-sheet');
          for (const r of [...range.getClientRects()]) {
            if (r.width < 1 || r.height < 1) continue;
            const off = r.right > vw + 0.5 || r.left < -0.5;
            const marks: string[] = [];
            if (off) marks.push('OFF-PAGE');
            if (clip && clip !== document.documentElement && clip !== document.body) {
              const c = inner(clip);
              if (r.right > c.right + 0.5 || r.left < c.left - 0.5)
                marks.push(
                  `CLIPPED by ${name(clip)} [${c.left.toFixed(1)}, ${c.right.toFixed(1)}]`,
                );
            }
            if (card) {
              const c = inner(card);
              if (r.right > c.right + 0.5 || r.left < c.left - 0.5)
                marks.push(`PAST-CARD ${name(card)} [${c.left.toFixed(1)}, ${c.right.toFixed(1)}]`);
            }
            if (marks.length)
              out.push(
                `${marks.join(' + ')} "${text.trim().slice(0, 40)}" in ${name(parent)} rect [${r.left.toFixed(1)}, ${r.right.toFixed(1)}] vw ${vw} section ${parent.closest('section, [id]')?.id ?? ''}`,
              );
          }
        }
        const chain: string[] = [];
        const word = [...document.querySelectorAll('#about p, [id$="about"] p')].find((p) =>
          (p.textContent ?? '').includes('Llanfair'),
        );
        for (let a: Element | null = word ?? null; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          const b = a.getBoundingClientRect();
          chain.push(
            `${name(a)} display ${cs.display} w ${b.width.toFixed(1)} [${b.left.toFixed(1)}, ${b.right.toFixed(1)}] scrollW ${a.scrollWidth} clientW ${a.clientWidth} minW ${cs.minWidth} ow ${cs.overflowWrap} ox ${cs.overflowX}${cs.display.includes('grid') ? ` cols ${cs.gridTemplateColumns.slice(0, 120)}` : ''}${a.parentElement && getComputedStyle(a.parentElement).display.includes('grid') ? ` col ${cs.gridColumn}` : ''}`,
          );
          if (a.classList.contains('ag')) break;
        }
        const se = document.scrollingElement!;
        return {
          out,
          chain,
          found: Boolean(word),
          scrollWidth: se.scrollWidth,
          clientWidth: se.clientWidth,
        };
      });
      console.log(
        `probe overflow ${width} ${route}: page ${read.scrollWidth} of ${read.clientWidth}, ${read.out.length} line(s) past an edge`,
      );
      for (const line of [...new Set(read.out)].slice(0, 40))
        console.log(`probe overflow ${width} ${route}: ${line}`);
      if (read.found)
        for (const line of read.chain)
          console.log(`probe overflow ${width} ${route} chain: ${line}`);
      else console.log(`probe overflow ${width} ${route}: the About word isn't on this page`);
      const about = page.locator('#about').first();
      if (OUT && (await about.count())) {
        await about.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(200);
        const box = (await about.boundingBox())!;
        const y = Math.max(0, Math.floor(box.y));
        writeFileSync(
          path.join(OUT, `${width}-${route === '/' ? 'home' : 'work'}-about.png`),
          await page.screenshot({
            clip: { x: 0, y, width, height: Math.min(844 - y, Math.ceil(box.height)) },
            animations: 'disabled',
            caret: 'hide',
          }),
        );
      }
    });
