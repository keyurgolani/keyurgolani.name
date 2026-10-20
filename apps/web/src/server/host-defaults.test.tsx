import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteSchema } from '@portfolio/schema';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { listManifests } from '~/lib/registry';
import { createAppearanceCatalog } from './appearance-catalog';
import { HOST_SITE } from './host-defaults';

test('the interim site document is a valid site document', () => {
  assert.equal(SiteSchema.safeParse(HOST_SITE).success, true);
});

test('visitors may pick the color scheme and the display mode, and nothing else', () => {
  assert.deepEqual(HOST_SITE.visitorControls, {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  });
});

test('the interim catalog registers every appearance id the interim site names', () => {
  const catalog = createAppearanceCatalog(listManifests());
  for (const axis of ['variant', 'colorScheme', 'typography', 'displayMode'] as const) {
    const ids = catalog.ids(axis, HOST_SITE.appearance);
    assert.ok(ids?.includes(HOST_SITE.appearance[axis]), `${axis}: ${String(ids)}`);
  }
});
