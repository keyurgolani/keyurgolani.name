import test from 'node:test';
import assert from 'node:assert/strict';
import { findPack, selectableIds } from '@portfolio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { PACK_STYLESHEET } from '~/preview/protocol';
import { registeredPacks, sampleChannel } from './sample-channel';

// What the /sample and /reference pages hand their agent (DEM-2): Studio's
// origin, the page's link base, and each pack this build registers on the
// three swapped axes with its build stylesheet, so the frame shows no pack
// the registry doesn't hold and links no sheet but the build's own.

test('the registered packs are each axis’s selectable packs with a build stylesheet, each the stylesheet the registry wrote for that id', () => {
  const packs = registeredPacks();
  for (const axis of ['designLanguage', 'colorScheme', 'typography'] as const) {
    const listed = Object.keys(packs[axis]);
    assert.ok(listed.length > 0, axis);
    const offered = selectableIds(APPEARANCE_REGISTRY, axis).filter(
      (id) => findPack(APPEARANCE_REGISTRY, axis, id)?.stylesheet?.url,
    );
    assert.deepEqual(listed, offered, axis);
    for (const [id, stylesheet] of Object.entries(packs[axis])) {
      assert.equal(PACK_STYLESHEET.exec(stylesheet)?.[1], id, `${axis} ${id}`);
      assert.equal(stylesheet, findPack(APPEARANCE_REGISTRY, axis, id)!.stylesheet!.url);
    }
  }
  // A plain object a client component may take as a prop, whose prototype no lookup reads.
  assert.equal(Object.getPrototypeOf(packs.colorScheme), Object.prototype);
  assert.equal(Object.hasOwn(packs.colorScheme, 'constructor'), false);
});

test("the channel names Studio's origin, the page's link base, the site's motion policy, the packs, and #19's query keys", () => {
  assert.deepEqual(sampleChannel('https://demo.test', '/reference', 'reduce'), {
    studioOrigin: 'https://demo.test',
    linkBase: '/reference',
    motionPolicy: 'reduce',
    registered: registeredPacks(),
    queryKeys: {
      designLanguage: 'language',
      colorScheme: 'scheme',
      typography: 'type',
      displayMode: 'mode',
    },
  });
});
