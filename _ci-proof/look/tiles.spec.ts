import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { incompleteContrastFindings } from '../quality/lib/a11y/contrast';

// The CI proof's look (copied in, never committed): Aurora Glass in Glassmorphism (warm-parchment, humanist-ui,
// the display mode L1_PROBE_MODE) on the complete fixture at 390 and 320, default and more
// contrast: the identity pane's stat tiles (.ag-tiles), read as the quality cells read them. axe's
// color-contrast runs over them, its violations and its passes' ratios are printed, its incomplete
// nodes and every tile text go to the cells' contrast sampler, and each text's colour, ground,
// size and weight are printed. Shots to PROOF_LOOK_OUT: the tiles.

const MODE = process.env.L1_PROBE_MODE ?? 'system';
const OUT = process.env.PROOF_LOOK_OUT ?? '';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, 'designLanguage: glassmorphism')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, `displayMode: ${MODE}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const width of [390, 320])
  for (const row of ['default', 'contrast-more'] as const)
    test(`probe: Aurora Glass identity tiles in glassmorphism ${MODE} at ${width}, ${row}`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      if (OUT) mkdirSync(OUT, { recursive: true });
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({
        media: null,
        reducedMotion: 'reduce',
        forcedColors: 'none',
        contrast: row === 'contrast-more' ? 'more' : 'no-preference',
      });
      await pinFaces(page, await optionalFaces(page), 'designed');
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const boundary = page.locator('[data-variant]').first();
      await expect(boundary).toHaveAttribute('data-variant', 'aurora-glass');
      await expect(boundary).toHaveAttribute('data-design-language', 'glassmorphism');
      const at = `${MODE} ${width} ${row}`;
      const tag = `${MODE}-${width}-${row}`;
      const figures = page.locator('.ag-tiles').first();
      const has = (await figures.count()) > 0;
      console.log(`probe tiles ${at}: identity tiles ${has ? 'present' : 'ABSENT'}`);
      if (has) {
        await figures.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
        if (OUT)
          writeFileSync(
            path.join(OUT, `${tag}-tiles.png`),
            await figures.screenshot({ animations: 'disabled', caret: 'hide' }),
          );
        const axe = await new AxeBuilder({ page })
          .include('.ag-tiles')
          .withRules(['color-contrast'])
          .analyze();
        for (const v of axe.violations)
          for (const n of v.nodes)
            console.log(
              `probe tiles ${at} axe VIOLATION ${n.target.join(' ')}: ${(n.any[0]?.message ?? '').slice(0, 240)}`,
            );
        for (const v of axe.passes)
          for (const n of v.nodes)
            console.log(
              `probe tiles ${at} axe pass ${n.target.join(' ')}: ${JSON.stringify(n.any[0]?.data ?? {}).slice(0, 240)}`,
            );
        console.log(
          `probe tiles ${at} axe: ${axe.violations.reduce((k, v) => k + v.nodes.length, 0)} violation node(s), ${axe.incomplete.reduce((k, v) => k + v.nodes.length, 0)} incomplete, ${axe.passes.reduce((k, v) => k + v.nodes.length, 0)} pass`,
        );
        const fromAxe = await incompleteContrastFindings(page, axe);
        console.log(
          `probe tiles ${at} sampler over axe's incomplete: ${fromAxe.length} finding(s) ${JSON.stringify(fromAxe).slice(0, 600)}`,
        );
        const texts = await page.evaluate(() => {
          const list: { sel: string; words: string; cls: string; style: string }[] = [];
          let k = 0;
          for (const el of document.querySelectorAll('.ag-tiles *')) {
            const own = [...el.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
            );
            if (!own || el.getClientRects().length === 0) continue;
            k += 1;
            el.setAttribute('data-l1-c', String(k));
            const s = getComputedStyle(el);
            let ground = 'none';
            for (let a: Element | null = el; a; a = a.parentElement) {
              const g = getComputedStyle(a);
              if (g.backgroundColor !== 'rgba(0, 0, 0, 0)' || g.backgroundImage !== 'none') {
                ground = `${a.tagName.toLowerCase()}.${[...a.classList].slice(0, 2).join('.')} ${g.backgroundColor} ${g.backgroundImage.slice(0, 80)} opacity ${g.opacity}`;
                break;
              }
            }
            list.push({
              sel: `[data-l1-c="${k}"]`,
              words: (el.textContent ?? '').trim().slice(0, 30),
              cls: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`,
              style: `color ${s.color} size ${s.fontSize} weight ${s.fontWeight} opacity ${s.opacity} on ${ground}`,
            });
          }
          return list;
        });
        console.log(`probe tiles ${at}: ${texts.length} tile texts`);
        for (const t of texts) {
          const findings = await incompleteContrastFindings(page, {
            incomplete: [{ id: 'color-contrast', nodes: [{ target: [t.sel] }] }],
            violations: [],
            passes: [],
          } as unknown as Parameters<typeof incompleteContrastFindings>[1]);
          console.log(
            `probe tiles ${at} contrast ${findings.length ? 'LOW' : 'ok'} ${t.cls} "${t.words}" (${t.style}): ${JSON.stringify(findings).slice(0, 400)}`,
          );
        }
      }
    });
