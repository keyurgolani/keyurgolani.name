import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customViewport,
  fitScale,
  FRAME_ATTRIBUTES,
  frameOrigin,
  frameSandbox,
  frameSource,
  frameTitle,
  heldToSystem,
  linkTarget,
  REDUCED_MOTION,
  viewportLabel,
  VIEWPORTS,
} from './preview-frame';

// A preview frame's element (#7, Slice 4): its sandbox, source, title, and
// the viewports Studio simulates.

test('a frame runs scripts alone, and only an owner frame on a configured preview origin adds allow-same-origin, demo never (#7, Slice 4)', () => {
  assert.equal(frameSandbox('owner', undefined, true), 'allow-scripts');
  assert.equal(frameSandbox('owner', null, true), 'allow-scripts');
  assert.equal(
    frameSandbox('owner', 'https://preview.rowan.test', true),
    'allow-scripts allow-same-origin',
  );
  for (const profile of ['demo', 'read-only']) {
    assert.equal(
      frameSandbox(profile, 'https://preview.rowan.test', true),
      'allow-scripts',
      profile,
    );
    assert.equal(frameSandbox(profile, undefined, true), 'allow-scripts', profile);
  }
  // JavaScript off: an empty sandbox, which runs nothing, whatever the profile or origin.
  for (const profile of ['owner', 'demo']) {
    assert.equal(frameSandbox(profile, 'https://preview.rowan.test', false), '', profile);
    assert.equal(frameSandbox(profile, undefined, false), '', profile);
  }
  // Never a token that lets the frame out.
  for (const sandbox of [
    frameSandbox('owner', 'https://preview.rowan.test', true),
    frameSandbox('demo', undefined, true),
  ]) {
    assert.doesNotMatch(sandbox, /allow-(?:popups|top-navigation|forms|modals|downloads)/);
  }
  assert.deepEqual(FRAME_ATTRIBUTES, { referrerPolicy: 'no-referrer', allow: '' });
});

test('a frame loads below /preview, on the preview origin when one is set (#7, Slice 4)', () => {
  const grant = 'GgGgGgGgGgGgGgGgGgGgGg';
  assert.equal(frameSource(undefined, grant), `/preview/${grant}`);
  assert.equal(
    frameSource('https://preview.rowan.test', grant),
    `https://preview.rowan.test/preview/${grant}`,
  );
});

test("a frame's origin is the preview origin when it has allow-same-origin, and none when it's opaque (#7, Slice 4)", () => {
  const preview = 'https://preview.rowan.test';
  assert.equal(frameOrigin('allow-scripts allow-same-origin', preview), preview);
  assert.equal(frameOrigin('allow-scripts allow-same-origin', `${preview}/`), preview);
  assert.equal(frameOrigin('allow-scripts', preview), undefined);
  assert.equal(frameOrigin('', preview), undefined);
  // allow-same-origin with no preview origin would be Studio's own, which no frame gets.
  assert.equal(frameOrigin('allow-scripts allow-same-origin', null), undefined);
});

test("Studio works out what a link is from its href, never the frame's word, and offers nothing but web pages, email, and phone links (#7, Slice 4)", () => {
  const studio = 'https://rowan.test';
  const preview = 'https://preview.rowan.test';
  assert.deepEqual(linkTarget('https://example.test/talk', studio), {
    href: 'https://example.test/talk',
    description: 'another site',
  });
  assert.deepEqual(linkTarget('https://rowan.test/studio', studio), {
    href: 'https://rowan.test/studio',
    description: 'a page of this site',
  });
  // A page on the preview origin, which serves only previews, is the site's own.
  assert.deepEqual(linkTarget(`${preview}/work/a?x=1#top`, studio, preview), {
    href: 'https://rowan.test/work/a?x=1#top',
    description: 'a page of this site',
  });
  assert.deepEqual(linkTarget('mailto:robin@example.test', studio), {
    href: 'mailto:robin@example.test',
    description: 'an email link',
  });
  assert.deepEqual(linkTarget('tel:+15550100', studio), {
    href: 'tel:+15550100',
    description: 'a phone link',
  });
  for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'blob:x', 'not a url', '']) {
    assert.equal(linkTarget(href, studio), null, href);
  }
});

test('the presets are width simulations, a custom width holds to 320 and up, and the title names state, variant, and viewport (#7, Slice 4)', () => {
  assert.deepEqual(
    VIEWPORTS.map((viewport) => viewportLabel(viewport)),
    ['Desktop 1440 by 900', 'Tablet 1024 by 768', 'Mobile 390 by 844'],
  );
  assert.deepEqual(customViewport(200), { id: 'custom', width: 320, height: 900 });
  assert.deepEqual(customViewport(800.4), { id: 'custom', width: 800, height: 900 });
  assert.deepEqual(customViewport(Number.NaN), { id: 'custom', width: 320, height: 900 });
  assert.equal(customViewport(99_999).width, 2560);
  assert.equal(
    frameTitle('draft', 'fallback', VIEWPORTS[0]!),
    'Preview — not live, fallback, Desktop 1440 by 900',
  );
  assert.equal(
    frameTitle('revision', 'fallback', VIEWPORTS[2]!),
    'Preview — live, fallback, Mobile 390 by 844',
  );
  assert.equal(
    frameTitle('fixture', null, VIEWPORTS[1]!),
    'Preview — fixture, variant unknown, Tablet 1024 by 768',
  );
});

test("a grant's motion is held to the owner's system: reduced when the system reduces it, whatever the controls said, and as asked otherwise (#7, Slice 4)", () => {
  const asked = {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'system',
    enhancement: 'on',
  } as const;
  assert.deepEqual(heldToSystem(asked, true), { ...asked, motion: 'reduce' });
  assert.equal(heldToSystem(asked, false), asked);
  const reduced = { ...asked, motion: 'reduce' } as const;
  assert.equal(heldToSystem(reduced, true), reduced);
  assert.equal(heldToSystem(reduced, false), reduced);
  assert.equal(REDUCED_MOTION, '(prefers-reduced-motion: reduce)');
});

test('fit scales the frame down to the room it has, never up, so the layout width stays the preset (#7, Slice 4)', () => {
  assert.equal(fitScale(720, { width: 1440 }), 0.5);
  assert.equal(fitScale(2000, { width: 1440 }), 1);
  assert.equal(fitScale(0, { width: 1440 }), 1);
});
