import { readFileSync } from 'node:fs';
import { expect, test } from '../harness/fixtures';
import { checkMode, MODES } from './modes';
import { DEMO, FIXED_TIME, projectTarget, SAMPLE_SELECTION } from './target';

// A registered composition on the bundled sample (#5, Slice 6), under demo
// at /sample, in every mode: the sample site's own selection, Editorial
// Evidence (#13), at /sample, and ?variant=<id> for every other. The
// fallback composition has no sample project: the sample selects a
// registered variant, so it never renders there. demo derives the sample's images from
// example-media/ once it starts, in the background (#10), and the page
// loads their renditions from /media, so every check waits for that first:
// a screenshot taken before it would show them unavailable.

/** Whether the server's log says its startup media derivation finished. */
const derived = (log: string) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.startsWith('{') && line.includes('"event":"media.startup.derived"'));

test.beforeAll(async ({ app }) => {
  await expect
    .poll(() => derived(app.log), { message: 'startup media derived', timeout: 60_000 })
    .toBe(true);
});

test(
  'the server runs on the fixed clock: every line it logs says 2026-01-01',
  { annotation: [DEMO] },
  async ({ app }) => {
    // demo's sitemap lists nothing (apps/web/src/app/sitemap.ts), so the
    // fixtures' sitemap check has no date to read here. Each JSON line the
    // server logs, from startup on, is stamped from its clock.
    const days = () =>
      readFileSync(app.log, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => (JSON.parse(line) as { ts: string }).ts.slice(0, 10));
    await expect.poll(days, { message: 'lines the server logged' }).not.toEqual([]);
    expect(new Set(days())).toEqual(new Set([FIXED_TIME.slice(0, 10)]));
  },
);

test(
  'the browser has no WebGL, so a shot is the document a device without a WebGL enhancement gets',
  { annotation: [DEMO] },
  async ({ page }) => {
    // playwright.config.ts launches Chromium with --disable-3d-apis. A browser
    // that ignored it would run a WebGL enhancement, whose canvas never
    // holds two frames the same: this fails first, by name.
    await page.setContent('<canvas></canvas>');
    expect(
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas')!;
        return [canvas.getContext('webgl2'), canvas.getContext('webgl')].every((gl) => gl === null);
      }),
    ).toBe(true);
  },
);

for (const mode of MODES) {
  test.describe(() => {
    const { reducedMotion, ...options } = mode.context;
    test.use({ ...options, contextOptions: { reducedMotion } });

    test(
      mode.name,
      { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
      async ({ page, context, request }, testInfo) => {
        const { variant } = projectTarget(testInfo);
        const { id } = variant.manifest;
        await checkMode({
          mode: mode.name,
          page,
          context,
          request,
          variant,
          testInfo,
          go: (target) =>
            target.goto(id === SAMPLE_SELECTION ? '/sample' : `/sample?variant=${id}`),
          shot: `${id}-sample-${mode.name}`,
          fixture: undefined,
        });
      },
    );
  });
}
