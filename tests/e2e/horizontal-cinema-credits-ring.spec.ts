import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { load, ringContrast, type RingSide } from './horizontal-cinema-model';

// Horizontal Cinema's end credits (row 46, HC family 2): the roll is a band of the matte, its links in
// the matte's ink, so a credit link focused from the keyboard rings at 3:1 on every side of its centre
// line and passes the quality walk's focus check, under more contrast, at rest and under forced colors.
// Under prefers-contrast: more the scheme renders its high-contrast set, whose focus color is the
// text color, dark on the dark matte in light: rc-preflight read "0, 2 or 4 changed pixels reach
// 3:1" on `#hc--credits > div:nth-child(2) > div:nth-child(1|2|3) > p:nth-child(2) > span:nth-child(N)
// > a:nth-child(1)`, complete/light at 1440, 1024 and 390; there the ring is the matte's ink, on-scrim,
// as the bars and the matte scenes ring. The default row and forced colors are held at the same bar,
// so the matte's ink costs no row its ring. On the complete contract fixture at 1440x900, 1024x768 and
// 390x844, on the cells' tuple (platform-neutral, warm-parchment, humanist-ui, light), the scheme and
// the mode picked by the visitor's appearance cookie and read back from the boundary.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

/** The credit links' paths, as the walk's probe names them (the preflight keys' family). */
const CREDIT_LINK =
  /^#hc--credits > div:nth-child\(2\) > div:nth-child\([123]\) > p:nth-child\(2\) > span:nth-child\(\d+\) > a:nth-child\(1\)$/;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** The rows: the media each emulates, and what the page's queries must read once it's rendered. */
const ROWS = {
  'more contrast': {
    media: { contrast: 'more', forcedColors: 'none' },
    reads: { more: true, forced: false },
  },
  'the default row': {
    media: { contrast: 'no-preference', forcedColors: 'none' },
    reads: { more: false, forced: false },
  },
  'forced colors': {
    media: { contrast: 'no-preference', forcedColors: 'active' },
    reads: { more: false, forced: true },
  },
} as const;
type Row = keyof typeof ROWS;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});

/** Home in `row` on the cells' tuple, by the visitor's cookie, and what rendered. */
async function loadRow(page: Page, origin: string, row: Row): Promise<void> {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme: 'warm-parchment', mode: 'light' }).toString(),
      url: origin,
    },
  ]);
  await page.emulateMedia(ROWS[row].media);
  await load(page);
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', 'platform-neutral');
  await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
  await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
  await expect(boundary).toHaveAttribute('data-display-mode', 'light');
  const reads = await page.evaluate(() => ({
    more: matchMedia('(prefers-contrast: more)').matches,
    forced: matchMedia('(forced-colors: active)').matches,
  }));
  expect(reads, row).toEqual(ROWS[row].reads);
}

/** The color `role` computes to inside the credits, read off a probe span there. */
const inkInCredits = (stop: Locator, role: string) =>
  stop.evaluate((element, role) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--color-${role})`;
    element.closest('.hc-credits')!.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, role);

for (const row of Object.keys(ROWS) as Row[]) {
  for (const viewport of VIEWPORTS) {
    const at = `${viewport.width}x${viewport.height}`;
    test(
      `${row} at ${at}: two credit links focused from the keyboard ring at 3:1 on every side and pass the focus check (row 46)`,
      { annotation, tag },
      async ({ page, app }) => {
        await page.setViewportSize(viewport);
        await loadRow(page, app.origin, row);
        // The links this width shows: a phone hides the credits the film's own scenes list (data-in-film).
        const links = page.locator(
          '#hc--credits .hc-credits__credit:not([data-phone-only]) .hc-credits__sentence a:visible',
        );
        expect(await links.count(), at).toBeGreaterThan(1);
        // A link whose next text after `</a>` in its sentence starts with punctuation has that glyph in
        // its ring's right band (row 90b's lesson, an RC2 note): there the focus check's verdict holds
        // that one side, not the per-side bar. Read from the DOM, and at least one link here has it.
        const stops = [
          ['the first visible credit link', links.first()],
          ['the last visible credit link', links.last()],
        ] as const;
        const nextText = (stop: Locator) =>
          stop.evaluate((link) => {
            const sentence = link.closest('p')!;
            const walker = document.createTreeWalker(sentence, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const after = link.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
              if (after && !link.contains(node) && (node.textContent ?? '') !== '')
                return node.textContent!;
            }
            return '';
          });
        const following = await Promise.all(stops.map(([, stop]) => nextText(stop)));
        const punctuated = following.map((text) => /^[,.;:]/.test(text));
        expect(
          punctuated,
          `${at}: the text after each link ${JSON.stringify(following)}`,
        ).toContain(true);
        for (const [index, [name, stop]] of stops.entries()) {
          const sidesHeld: readonly RingSide[] = punctuated[index]
            ? ['top', 'bottom', 'left']
            : ['top', 'right', 'bottom', 'left'];
          if (punctuated[index]) expect(following[index], name).toMatch(/^[,.;:]/);
          await page.keyboard.press('Shift');
          await stop.focus();
          expect(await stop.evaluate((el) => el.matches(':focus-visible')), name).toBe(true);
          const active = await inPage<Active>(page, { kind: 'active' });
          expect(active.path, name).toMatch(CREDIT_LINK);
          // Every point of its centre line, on each side held, at 3:1, and the focus check's verdict.
          const measured = await ringContrast(page, stop);
          const sides = sidesHeld.map((side) => {
            const { points, strong } = measured.sides[side];
            return { side, inView: points > 0, atThreeToOne: strong === points };
          });
          expect(sides, `${name}: its ring's centre line ${JSON.stringify(measured)}`).toEqual(
            sides.map(({ side }) => ({ side, inView: true, atThreeToOne: true })),
          );
          expect(
            await focusFindings(page, active),
            `${name}: its ring's centre line ${JSON.stringify(measured)}`,
          ).toEqual([]);
          if (row === 'more contrast') {
            const ring = await stop.evaluate((el) => getComputedStyle(el).outlineColor);
            expect(ring, name).toBe(await inkInCredits(stop, 'on-scrim'));
          }
        }
      },
    );
  }
}
