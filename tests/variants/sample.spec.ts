import { test } from '../harness/fixtures';
import { checkMode, MODES } from './modes';
import { DEMO, FALLBACK_ID, projectTarget } from './target';

// A registered composition on the bundled sample (#5, Slice 6), under demo
// at /sample, in every mode: the sample site's own selection for the
// fallback composition, which stands in for it until #13, and
// ?variant=<id> for every other. The sample's photos live on picsum.photos,
// which stays blocked.

test.use({ blockedHosts: ['picsum.photos'] });

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
        });
      },
    );
  });
}
