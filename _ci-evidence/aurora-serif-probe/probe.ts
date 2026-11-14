// Evidence only, never merged: which of a type pack's faces moves what at load on CI Linux. On
// Aurora Glass (platform-neutral, warm-parchment, the pack, dark: the load-shift pins' tuple), script
// on, under reduced motion, at each width: a fresh page's load read as the load-shift pins read it,
// every layout-shift entry with each source's node, its element, its text, its computed font and
// text-align, and its rects before and after; then the same load with each of the pack's face files
// refused in turn, and with every face file but that one refused. A face whose refusal clears an
// entry, or the only one left that keeps it, is the face whose late swap made it. One
// "l1-probe {json}" line a load.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../../tests/harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

const options = (pack: string) => ({
  portfolio: FIXTURE.files.portfolio,
  siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
    .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
    .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
    .replace(/typography: .*/, `typography: ${pack}`)
    .replace(/displayMode: .*/, 'displayMode: dark'),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
});

interface Face {
  readonly name: string;
  readonly path: string;
}

/** Every web face file of `pack` the page's stylesheets declare: its family, weight, style and range. */
async function faces(page: Page, pack: string): Promise<Face[]> {
  const html = await (await page.request.get('/')).text();
  const hrefs = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel="stylesheet"/.test(tag))
    .map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1])
    .filter((href): href is string => href !== undefined);
  const out = new Map<string, Face>();
  for (const href of [...new Set(hrefs)]) {
    const css = await (await page.request.get(href)).text();
    for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const value = (name: string) =>
        new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(block!)?.[1]?.trim() ?? '';
      const family = value('font-family').replace(/^"(.*)"$/, '$1');
      const url = /url\("?([^")]+)"?\)/.exec(value('src'))?.[1];
      if (!url || !family.startsWith(`${pack} `)) continue;
      const file = new URL(url, 'http://x').pathname;
      out.set(file, {
        name: `${family} ${value('font-weight')} ${value('font-style')} ${value('unicode-range').slice(0, 14)}`,
        path: file,
      });
    }
  }
  return [...out.values()];
}

const rect = (r?: { x: number; y: number; width: number; height: number }) =>
  r ? [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10) : null;

/** One fresh page's load at `width`, with `refused` face files refused: its entries, each source named. */
async function load(page: Page, width: number, refused: ReadonlySet<string>) {
  const fresh = await page.context().newPage();
  try {
    await fresh.setViewportSize({ width, height: 900 });
    await fresh.route(
      (url) => refused.has(url.pathname),
      (route) => route.abort('blockedbyclient'),
    );
    const cdp: CDPSession = await fresh.context().newCDPSession(fresh);
    const got: { value: number; input: boolean; sources: Record<string, unknown>[] }[] = [];
    cdp.on('PerformanceTimeline.timelineEventAdded', (payload) => {
      const d = (payload as unknown as { event: { layoutShiftDetails?: Record<string, unknown> } })
        .event.layoutShiftDetails;
      if (d)
        got.push({
          value: d.value as number,
          input: d.hadRecentInput as boolean,
          sources: d.sources as Record<string, unknown>[],
        });
    });
    await cdp.send('PerformanceTimeline.enable', { eventTypes: ['layout-shift'] });
    await fresh.goto('/', { waitUntil: 'networkidle' });
    await fresh.waitForTimeout(600);
    await cdp.send('DOM.getDocument', { depth: 0 });
    const describe = async (id?: number) => {
      if (!id) return { node: '(no node)' };
      try {
        const { object } = (await cdp.send('DOM.resolveNode', { backendNodeId: id })) as {
          object: { objectId: string };
        };
        const { result } = (await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          returnByValue: true,
          functionDeclaration: `function () {
            const n = this;
            const el = n.nodeType === 3 ? n.parentElement : n;
            const cs = el ? getComputedStyle(el) : null;
            const tag = (e) => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 3).map((c) => '.' + c).join('') : null;
            return {
              node: n.nodeType === 3 ? '#text' : n.nodeName.toLowerCase(),
              el: tag(el),
              parent: tag(el && el.parentElement),
              text: (n.textContent || '').trim().slice(0, 48),
              font: cs ? (cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontFamily).slice(0, 140) : null,
              align: cs ? cs.textAlign : null,
            };
          }`,
        })) as { result: { value: Record<string, unknown> } };
        return result.value;
      } catch {
        return { node: `(node ${id} gone)` };
      }
    };
    const out = [];
    for (const shift of got.filter((each) => !each.input))
      out.push({
        value: Math.round(shift.value * 10000) / 10000,
        sources: await Promise.all(
          shift.sources.map(async (s) => ({
            ...(await describe(s.nodeId as number | undefined)),
            prev: rect(s.previousRect as never),
            cur: rect(s.currentRect as never),
          })),
        ),
      });
    return out;
  } finally {
    await fresh.close();
  }
}

/** The probe for one pack at `widths`; each pack's spec file calls it once. */
export function probe(pack: string, widths: readonly number[]) {
  test.use({ appOptions: options(pack), contextOptions: { reducedMotion: 'reduce' } });
  test(`probe ${pack}: which face moves what at load, script on`, async ({ page }) => {
    test.setTimeout(900_000);
    const all = await faces(page, pack);
    console.log(`l1-probe-faces ${JSON.stringify({ pack, faces: all.map((f) => f.name) })}`);
    const say = (width: number, mode: string, entries: unknown) =>
      console.log(`l1-probe ${JSON.stringify({ pack, width, mode, entries })}`);
    for (const width of widths) {
      say(width, 'all', await load(page, width, new Set()));
      for (const face of all) {
        say(width, `without ${face.name}`, await load(page, width, new Set([face.path])));
        say(
          width,
          `only ${face.name}`,
          await load(page, width, new Set(all.filter((f) => f !== face).map((f) => f.path))),
        );
      }
      say(width, 'all again', await load(page, width, new Set()));
    }
  });
}
