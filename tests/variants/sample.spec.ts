import { readFileSync } from 'node:fs';
import { expect, test } from '../harness/fixtures';
import { checkMode, MODES } from './modes';
import { DEMO, FALLBACK_ID, FIXED_TIME, projectTarget } from './target';

// A registered composition on the bundled sample (#5, Slice 6), under demo
// at /sample, in every mode: the sample site's own selection for the
// fallback composition, which stands in for it until #13, and
// ?variant=<id> for every other. demo derives the sample's images from
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
          go: (target) => target.goto(id === FALLBACK_ID ? '/sample' : `/sample?variant=${id}`),
          shot: `${id}-sample-${mode.name}`,
          fixture: undefined,
        });
      },
    );
  });
}
