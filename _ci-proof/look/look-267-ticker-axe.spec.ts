// Look read for one CI run (laid in by the proof kit, never in a head's tree): Raw Grid's home on
// the complete contract fixture at 1024 by 768, the ticker running, in the default design language
// and in neobrutalist (warm parchment, humanist UI, system). At five times after the load, axe's
// color-contrast on the ticker alone: each incomplete or failing node, its message key, its related
// nodes, and every item at or past the track's end (box, text rects, what lies at its centre)
// against the track's and the pause cell's boxes, with the track's computed overflow and the belt's
// transform. Out: $PROOF_LOOK_OUT/<language>-axe.json and <language>-ticker.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TIMES_MS = [500, 1500, 3000, 5000, 8000];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
  contextOptions: { reducedMotion: 'no-preference' },
});

const LANGUAGES = {
  default: null,
  neobrutalist: {
    language: 'neobrutalist',
    scheme: 'warm-parchment',
    type: 'humanist-ui',
    mode: 'system',
  },
} as const;

for (const [name, appearance] of Object.entries(LANGUAGES)) {
  test(`look 1024 ${name}: axe on the running ticker at five times`, async ({ page, app }) => {
    test.setTimeout(180_000);
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    if (appearance)
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams(appearance).toString(),
          url: app.origin,
        },
      ]);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const start = await page.evaluate(() => performance.now());
    const reads = [];
    for (const at of TIMES_MS) {
      const now = await page.evaluate(() => performance.now());
      if (now - start < at) await page.waitForTimeout(at - (now - start));
      const geometry = await page.evaluate(() => {
        const box = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right) };
        };
        const belt = document.querySelector('.rg-ticker__belt');
        const track = document.querySelector('.rg-ticker__track');
        const trackStyle = track ? getComputedStyle(track) : null;
        return {
          overflow: trackStyle
            ? { overflow: trackStyle.overflow, x: trackStyle.overflowX, y: trackStyle.overflowY }
            : null,
          beltBox: box(belt),
          ticker: document.querySelector('.rg-ticker')?.getAttribute('data-ticker') ?? null,
          track: box(document.querySelector('.rg-ticker__track')),
          toggle: box(document.querySelector('.rg-ticker__toggle')),
          transform: belt ? getComputedStyle(belt).transform : null,
          items: [...document.querySelectorAll('.rg-ticker__run > li')].map((li, i) => {
            const texts = [...li.childNodes]
              .filter((n) => n.nodeType === 3)
              .flatMap((n) => {
                const range = document.createRange();
                range.selectNodeContents(n);
                return [...range.getClientRects()].map((r) => ({
                  left: Math.round(r.left),
                  right: Math.round(r.right),
                  top: Math.round(r.top),
                  bottom: Math.round(r.bottom),
                }));
              });
            const r = li.getBoundingClientRect();
            const at = (x: number, y: number) =>
              document
                .elementsFromPoint(x, y)
                .slice(0, 3)
                .map(
                  (e) =>
                    `${e.localName}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`,
                );
            return {
              i,
              copy: li.parentElement?.hasAttribute('data-copy') ?? false,
              text: (li.textContent ?? '').trim().slice(0, 24),
              ...box(li)!,
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              texts,
              atCentre: at(r.left + r.width / 2, r.top + r.height / 2),
            };
          }),
        };
      });
      const results = await new AxeBuilder({ page })
        .include('.rg-ticker')
        .withRules(['color-contrast'])
        .analyze();
      const nodes = [...results.incomplete, ...results.violations]
        .filter((rule) => rule.id === 'color-contrast')
        .flatMap((rule) =>
          rule.nodes.map((node) => ({
            target: node.target.join(' '),
            html: node.html.slice(0, 80),
            keys: node.any.map(
              (check) => (check.data as { messageKey?: string } | null)?.messageKey ?? check.id,
            ),
            related: node.any.flatMap((check) =>
              (check.relatedNodes ?? []).map((n) => n.target.join(' ')),
            ),
          })),
        );
      // The items whose box crosses the track's end.
      const edge = geometry.track?.right ?? null;
      const toggleRight = geometry.toggle?.right ?? null;
      const straddling =
        edge === null
          ? []
          : geometry.items.filter(
              (item) => item.right > edge - 1 && item.left < (toggleRight ?? edge) + 1,
            );
      reads.push({
        at,
        ticker: geometry.ticker,
        transform: geometry.transform,
        overflow: geometry.overflow,
        track: geometry.track,
        belt: geometry.beltBox,
        toggle: geometry.toggle,
        straddling,
        nodes,
      });
    }
    writeFileSync(
      path.join(out, `${name}-axe.json`),
      `${JSON.stringify({ language: name, reads }, null, 2)}\n`,
    );
    const ticker = page.locator('.rg-ticker');
    const b = (await ticker.boundingBox())!;
    await page.screenshot({
      path: path.join(out, `${name}-ticker.png`),
      clip: {
        x: 0,
        y: Math.max(0, b.y - 8),
        width: 1024,
        height: Math.min(768 - Math.max(0, b.y - 8), b.height + 16),
      },
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
