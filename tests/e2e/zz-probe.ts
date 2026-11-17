import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { parse } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';

// Evidence only, never merged: two reads on CI Linux, each logged as `[probe] {json}` lines.
// Print: each composition's Appearance control under print media, after beforeprint, as it is and
// with the platform hiding it in print. Kinetic Cosmos: each work page's title at 1024 and 1440,
// with the root text at 100% and 200%, as it is and under candidate rules.

export function served(id: string, fixture: string) {
  const f = contractFixture(fixture);
  const dir = path.dirname(f.files.portfolio);
  return {
    portfolio: f.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(f.files.site, 'utf8'), id),
    sourceFiles: Object.fromEntries(
      f.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

export function workIds(fixture: string): string[] {
  const doc = parse(readFileSync(contractFixture(fixture).files.portfolio, 'utf8')) as {
    works?: { id: string }[];
  };
  return (doc.works ?? []).map((work) => work.id);
}

const log = (what: string, data: Record<string, unknown>) =>
  console.log(`[probe] ${JSON.stringify({ what, ...data })}`);

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const HIDE_IN_PRINT =
  '@media print { [data-appearance-boundary] [data-ui-slot="appearance-control"] { display: none !important; } }';

/** The Appearance control under print media, after beforeprint, as it is and hidden in print. */
export async function readPrint(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await settle(page);
  const read = () =>
    page.evaluate(() => {
      const shown = (el: Element) => (el as HTMLElement).checkVisibility?.() ?? true;
      const controls = [...document.querySelectorAll('[data-ui-slot="appearance-control"]')];
      const words = ['Appearance', 'Reset to site default', 'Color scheme', 'Display mode'];
      const texts = [...document.querySelectorAll('body *')]
        .filter((el) => el.childElementCount === 0 && shown(el))
        .map((el) => (el.textContent ?? '').trim())
        .filter((t) => words.some((w) => t.includes(w)));
      return {
        controls: controls.map((c) => {
          const r = c.getBoundingClientRect();
          const details = c.querySelector('details');
          return {
            shown: shown(c),
            rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            open: details?.open ?? null,
            parts: [...c.querySelectorAll('select, input, button, summary')].filter(shown).length,
          };
        }),
        texts: [...new Set(texts)].slice(0, 12),
      };
    });
  log('print', { id, as: 'is', ...(await read()) });
  await page.addStyleTag({ content: HIDE_IN_PRINT });
  await settle(page);
  log('print', { id, as: 'hidden', ...(await read()) });
}

/** The candidate rules for Kinetic Cosmos's title, on the 64rem layout. */
const CANDIDATES: Record<string, string> = {
  none: '',
  step: '--layout-step: clamp(0px, 50vw - 20rem, var(--space-3xl));',
  'step+cap12':
    '--layout-step: clamp(0px, 50vw - 20rem, var(--space-3xl)); font-size: min(var(--type-step-6), 12vw - 2rem);',
  'step+cap9':
    '--layout-step: clamp(0px, 50vw - 20rem, var(--space-3xl)); font-size: min(var(--type-step-6), 9vw - 1rem);',
  'step+cap8':
    '--layout-step: clamp(0px, 50vw - 20rem, var(--space-3xl)); font-size: min(var(--type-step-6), 8vw);',
};

/** Each work page's title: its box, its size and indent, and each word broken across lines. */
export async function readTitles(page: Page, fixture: string): Promise<void> {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const work of workIds(fixture)) {
      await page.goto(`/work/${work}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      for (const [name, rule] of Object.entries(CANDIDATES)) {
        for (const text of [1, 2]) {
          const out = await page.evaluate(
            ({ rule, text }) => {
              document.getElementById('probe-candidate')?.remove();
              if (rule) {
                const style = document.createElement('style');
                style.id = 'probe-candidate';
                style.textContent = `@media (min-width: 64rem) { [data-variant='kinetic-cosmos'] .kc-case-stage__title { ${rule} } }`;
                document.head.append(style);
              }
              document.documentElement.style.setProperty(
                'font-size',
                `${text * 100}%`,
                'important',
              );
              const title = document.querySelector<HTMLElement>('.kc-case-stage__title');
              if (!title) return null;
              const cs = getComputedStyle(title);
              const r = title.getBoundingClientRect();
              const broken: string[] = [];
              const words: string[] = [];
              const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                for (const m of (node.textContent ?? '').matchAll(/[^\s/\u2013-]+/g)) {
                  const range = document.createRange();
                  range.setStart(node, m.index!);
                  range.setEnd(node, m.index! + m[0].length);
                  const rects = [...range.getClientRects()].filter((x) => x.width > 0);
                  const lines = new Set(rects.map((x) => Math.round(x.top))).size;
                  const w = rects.reduce((s, x) => s + x.width, 0);
                  words.push(`${m[0]}:${w.toFixed(0)}`);
                  if (lines > 1) broken.push(`${m[0]} on ${lines} lines (${w.toFixed(1)} px)`);
                }
              }
              return {
                text: (title.textContent ?? '').trim(),
                box: [r.width.toFixed(2), r.height.toFixed(2), r.x.toFixed(2), r.y.toFixed(2)],
                fontSize: cs.fontSize,
                padStart: cs.paddingInlineStart,
                indent: cs.textIndent,
                family: cs.fontFamily.slice(0, 40),
                words,
                broken,
                scrollW: document.documentElement.scrollWidth,
              };
            },
            { rule, text },
          );
          log('title', { fixture, work, width, text: text * 100, candidate: name, ...out });
        }
      }
      await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    }
  }
}
