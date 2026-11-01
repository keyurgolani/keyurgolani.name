import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { browserBackend } from '~/lib/demo/browser-backend';
import { demoStore } from '~/lib/demo/storage';
import { CATALOG, DEFAULTS, FakeStorage, SCHEME_MODES, UNIT } from '~/lib/demo/test-support';
import { VIEWPORTS } from '~/lib/preview-frame';
import { DEMO_FRAME_SANDBOX, DemoFrame, isDemoFrameSource } from './demo-frame';
import { DemoStudio } from './demo-studio';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The read-only reference in Demo Studio (#9, 9-4a): offered only when the
// server verified one, shown in a frame of /reference with the very sandbox
// the sample's gets, labeled read-only throughout, and, with none mounted,
// nothing in the page so much as names a reference, whatever the URL asks.

const POLICY = { profile: 'demo', allowed: ['sandbox.view'] } as const;
const REFERENCE = {
  name: 'Wren Halloway',
  defaults: { ...DEFAULTS, displayMode: 'dark' },
} as const;

function backend() {
  return browserBackend({
    unit: UNIT,
    catalog: CATALOG,
    schemeModes: SCHEME_MODES,
    defaults: DEFAULTS,
    store: demoStore(new FakeStorage(), new FakeStorage()),
  });
}

/** Every attribute of the one iframe in `html`. */
function frameAttributes(html: string): Record<string, string> {
  const tag = /<iframe\b([^>]*)>/.exec(html)?.[1];
  assert.ok(tag, 'an iframe');
  return Object.fromEntries(
    [...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name!.toLowerCase(),
      value!,
    ]),
  );
}

function render(props: Partial<React.ComponentProps<typeof DemoStudio>> = {}) {
  return renderToStaticMarkup(
    <DemoStudio
      catalog={CATALOG}
      schemeModes={SCHEME_MODES}
      policy={POLICY}
      backend={backend()}
      task="appearance"
      // The frame as it is once its gate let it load (frame-gate.test.tsx has the gate).
      initialFrameRequested
      {...props}
    />,
  );
}

test('with no reference mounted, a URL asking for one opens the sample, and nothing in the page names a reference', () => {
  for (const props of [
    { reference: null, initialSource: 'reference' as const },
    { initialSource: 'reference' as const },
    {},
  ]) {
    const html = render(props);
    assert.match(frameAttributes(html).src ?? '', /^\/sample(?:\?|$)/);
    assert.doesNotMatch(html, /reference/i);
    assert.doesNotMatch(html, /role="alert"/, 'no error either');
    assert.ok(html.includes('The neutral sample portfolio, read-only.'));
  }
});

test('with a reference mounted, Studio still opens on the sample and offers the labeled, read-only action', () => {
  const html = render({ reference: REFERENCE });
  assert.match(frameAttributes(html).src ?? '', /^\/sample(?:\?|$)/);
  assert.ok(html.includes('Show Wren Halloway&#x27;s published portfolio (read-only)'), html);
  assert.ok(html.includes('The neutral sample portfolio, read-only.'));
});

test('showing the reference frames /reference, says read-only, and never implies it changes that site', () => {
  const html = render({ reference: REFERENCE, initialSource: 'reference' });
  const frame = frameAttributes(html);
  assert.match(frame.src ?? '', /^\/reference(?:\?|$)/);
  assert.match(frame.title ?? '', /^Wren Halloway&#x27;s published portfolio, read-only, /);
  assert.ok(
    html.includes(
      'Wren Halloway&#x27;s published portfolio, a read-only snapshot. Nothing here changes Wren Halloway&#x27;s site.',
    ),
  );
  assert.ok(html.includes('Back to the neutral sample'));
  assert.doesNotMatch(html, /\b(?:publish|save|edit|update)\b[^.]*Wren Halloway/i);
});

test('the reference frame gets exactly the sample frame’s sandbox and attributes, nothing wider', () => {
  const attributes = (src: string) => {
    const all = frameAttributes(
      renderToStaticMarkup(<DemoFrame src={src} title="x" viewport={VIEWPORTS[0]!} />),
    );
    // Every attribute but the source itself.
    return Object.fromEntries(Object.entries(all).filter(([name]) => name !== 'src'));
  };
  const sample = attributes('/sample?mode=dark');
  const reference = attributes('/reference?mode=dark');
  assert.deepEqual(reference, sample);
  assert.equal(reference.sandbox, DEMO_FRAME_SANDBOX);
  assert.equal(DEMO_FRAME_SANDBOX, 'allow-scripts');
  assert.equal(reference.referrerpolicy, 'no-referrer');
  assert.equal(reference.allow, '');
});

test('a demo frame may load /reference and its pages, and never its renditions route or anything like it', () => {
  for (const src of ['/reference', '/reference?mode=dark', '/reference/work/tide-tables']) {
    assert.equal(isDemoFrameSource(src), true, src);
  }
  for (const src of [
    '/reference/media',
    '/reference/media/cover/abc/w8-a1.png',
    '/references',
    '/referencex',
    '/reference/../studio',
    '//evil.example/reference',
    'https://evil.example/reference',
  ]) {
    assert.equal(isDemoFrameSource(src), false, src);
  }
});

test('a demo frame source is read decoded, as the proxy reads a demo path: an encoded name counts, and an encoded way out never does', () => {
  for (const src of [
    '/%72eference',
    '/%72eference?mode=dark',
    '/sampl%65',
    '/reference/work/tide%2Dtables',
  ]) {
    assert.equal(isDemoFrameSource(src), true, src);
  }
  for (const src of [
    '/%72eference/media/cover/abc/w8-a1.png',
    '/reference/%6dedia/cover/abc/w8-a1.png',
    '/reference%2fmedia/cover/abc/w8-a1.png',
    '/sample/..%2f',
    '/sample/..%2fstudio',
    '/sample/%2e%2e/studio',
    '/sample/%2e%2e%2fstudio',
    '/reference/..%2F..%2Fstudio',
    '/sample%5c..%5cstudio',
    '/sample/%E0%A4%A',
    '/sample%3f/../studio',
  ]) {
    assert.equal(isDemoFrameSource(src), false, src);
  }
});
