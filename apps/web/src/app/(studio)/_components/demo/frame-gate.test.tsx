import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { browserBackend } from '~/lib/demo/browser-backend';
import { demoStore } from '~/lib/demo/storage';
import { CATALOG, DEFAULTS, FakeStorage, SCHEME_MODES, UNIT } from '~/lib/demo/test-support';
import { frameSource } from '~/lib/demo/url-state';
import { VIEWPORTS } from '~/lib/preview-frame';
import { DEMO_FRAME_SANDBOX, DemoFrame, stageSource } from './demo-frame';
import { DemoStudio, frameViewportId } from './demo-studio';
import { NARROW_STUDIO, STAGE_MARGIN, whenOnScreen, type StageObserverClass } from './frame-gate';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// When Demo Studio's frame loads its document (#9, #11's TBT budget): its
// /sample document runs a Next runtime of its own on Studio's main thread,
// so the stage loads it once it's on screen. tests/e2e/demo-studio-frame.spec.ts
// drives the same in a browser.

const POLICY = { profile: 'demo', allowed: ['sandbox.view'] } as const;

function backend() {
  return browserBackend({
    unit: UNIT,
    catalog: CATALOG,
    schemeModes: SCHEME_MODES,
    defaults: DEFAULTS,
    store: demoStore(new FakeStorage(), new FakeStorage()),
    initial: { ...DEFAULTS, variant: 'acme-orbit', displayMode: 'dark' },
  });
}

/** Every attribute of the one iframe in `html`, or null without one. */
function frameAttributes(html: string): Record<string, string> | null {
  const tag = /<iframe\b([^>]*)>/.exec(html)?.[1];
  if (tag === undefined) return null;
  return Object.fromEntries(
    [...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name!.toLowerCase(),
      value!,
    ]),
  );
}

/** A stand-in IntersectionObserver: the test says when its target is on screen. */
function stageObserver() {
  const made: {
    margin: string;
    observed: Element[];
    disconnected: number;
    report: (on: boolean) => void;
  }[] = [];
  const Observer: StageObserverClass = class {
    private readonly entry: (typeof made)[number];
    constructor(
      callback: (entries: readonly { isIntersecting: boolean }[]) => void,
      options: { readonly rootMargin: string },
    ) {
      this.entry = {
        margin: options.rootMargin,
        observed: [],
        disconnected: 0,
        report: (on) => callback([{ isIntersecting: on }]),
      };
      made.push(this.entry);
    }
    observe(target: Element) {
      this.entry.observed.push(target);
    }
    disconnect() {
      this.entry.disconnected += 1;
    }
  };
  return { Observer, made };
}

test('the gate lets the stage load once, the first time it is on screen, and then stops watching', () => {
  const { Observer, made } = stageObserver();
  const target = {} as Element;
  let loads = 0;
  whenOnScreen(target, () => (loads += 1), Observer);
  assert.equal(made.length, 1);
  assert.deepEqual(made[0]!.observed, [target]);
  // Within a window's height below the window, as loading="lazy" looks ahead.
  assert.equal(made[0]!.margin, STAGE_MARGIN);
  assert.equal(STAGE_MARGIN, '0px 0px 100% 0px');
  made[0]!.report(false);
  assert.equal(loads, 0, 'off screen, nothing loads');
  made[0]!.report(true);
  assert.equal(loads, 1);
  assert.equal(made[0]!.disconnected, 1);
  made[0]!.report(true);
  made[0]!.report(false);
  made[0]!.report(true);
  assert.equal(loads, 1, 'exactly once');
});

test('a stage that goes before it comes on screen never loads, and without an observer it loads at once', () => {
  const { Observer, made } = stageObserver();
  let loads = 0;
  const stop = whenOnScreen({} as Element, () => (loads += 1), Observer);
  stop();
  assert.equal(made[0]!.disconnected, 1);
  made[0]!.report(true);
  assert.equal(loads, 0);
  whenOnScreen({} as Element, () => (loads += 1), undefined);
  assert.equal(loads, 1);
});

test('until its gate lets it load, the frame is on the page with its title, sandbox, and busy stage, and no src', () => {
  const src = '/sample?variant=acme-orbit&mode=dark';
  const html = renderToStaticMarkup(
    <DemoFrame src={src} title="Demo sample" viewport={VIEWPORTS[0]!} />,
  );
  const frame = frameAttributes(html);
  assert.ok(frame, 'the iframe is there from the first render');
  assert.equal(frame.src, undefined);
  assert.equal(frame.title, 'Demo sample');
  assert.equal(frame.sandbox, DEMO_FRAME_SANDBOX);
  assert.equal(DEMO_FRAME_SANDBOX, 'allow-scripts');
  assert.match(html, /class="preview-surface__stage" data-phase="loading" aria-busy="true"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.equal(stageSource(src, false), undefined);
  assert.equal(stageSource(src, true), src);
});

test('once let load, each source the page hands the frame is its src: the sample, the reference, the sample again', () => {
  for (const src of ['/sample?mode=dark', '/reference?mode=dark', '/sample?mode=light']) {
    const frame = frameAttributes(
      renderToStaticMarkup(<DemoFrame src={src} title="x" viewport={VIEWPORTS[0]!} requested />),
    );
    assert.equal(frame?.src, src, src);
  }
});

test('the stage waits at every width, and Studio’s Content task never blocks on it', () => {
  assert.equal(NARROW_STUDIO, '(max-width: 47.99rem)');
  // The server renders Studio wide, as no media query reads there: the stage, waiting, with no src.
  const html = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task="content" />,
  );
  assert.equal(frameAttributes(html)?.src, undefined);
  assert.ok(html.includes('id="studio-demo-import"'), 'the picker is there');
  assert.ok(html.includes('>Export setup<'), 'and Export setup');
  assert.ok(
    html.indexOf('id="studio-demo-import"') < html.indexOf('<iframe'),
    'both before the frame',
  );
});

test('the frame defaults to the mobile viewport at a phone’s width, the desktop one otherwise, and keeps a pick', () => {
  assert.equal(frameViewportId(null, true), 'mobile');
  assert.equal(frameViewportId(null, false), 'desktop');
  assert.equal(frameViewportId('tablet', true), 'tablet');
  assert.equal(frameViewportId('desktop', true), 'desktop');
  assert.equal(frameViewportId('mobile', false), 'mobile');
  // On the server, wide: the desktop preset, as before.
  const html = renderToStaticMarkup(
    <DemoStudio
      catalog={CATALOG}
      schemeModes={SCHEME_MODES}
      policy={POLICY}
      backend={backend()}
      task="preview"
      initialFrameRequested
    />,
  );
  assert.match(html, /<option value="desktop" selected="">/);
  assert.match(frameAttributes(html)?.style ?? '', /inline-size:1440px/);
});

test('a frame let load keeps the source the selection names', () => {
  const demo = backend();
  const html = renderToStaticMarkup(
    <DemoStudio
      catalog={CATALOG}
      schemeModes={SCHEME_MODES}
      policy={POLICY}
      backend={demo}
      task="content"
      initialFrameRequested
    />,
  );
  assert.equal(
    frameAttributes(html)?.src,
    frameSource(demo.selection(), { catalog: CATALOG, schemeModes: SCHEME_MODES }).replace(
      /&/g,
      '&amp;',
    ),
  );
});
