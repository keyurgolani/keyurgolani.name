import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { browserBackend } from '~/lib/demo/browser-backend';
import { demoStore } from '~/lib/demo/storage';
import { CATALOG, DEFAULTS, FakeStorage, SCHEME_MODES, UNIT } from '~/lib/demo/test-support';
import { frameSource } from '~/lib/demo/url-state';
import { VIEWPORTS } from '~/lib/preview-frame';
import { DEMO_FRAME_SANDBOX, DemoFrame, isDemoFrameSource } from './demo-frame';
import { AxisField } from '../shell/axis-field';
import { DemoStudio, demoUnoffered, SandboxLine } from './demo-studio';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Demo Studio's frame and body (#9, design note sections 1 and 2): a frame of
// /sample sandboxed to scripts alone, with no grant, channel, or /preview
// path; a body with no publish, draft, or sign-in; and none of it able to
// reach Owner Studio's adapter.

const SRC = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(SRC, '..', '..', '..', '..');

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

test('a demo frame loads /sample, sandboxed to scripts alone, with no referrer and no permissions', () => {
  const src = '/sample?variant=acme-orbit&mode=dark';
  const html = renderToStaticMarkup(
    <DemoFrame src={src} title="Demo sample" viewport={VIEWPORTS[2]!} />,
  );
  const attributes = frameAttributes(html);
  assert.equal(DEMO_FRAME_SANDBOX, 'allow-scripts');
  assert.equal(attributes.sandbox, 'allow-scripts');
  assert.equal(attributes.src, src.replace(/&/g, '&amp;'));
  assert.equal(attributes.referrerpolicy, 'no-referrer');
  assert.equal(attributes.allow, '');
  assert.equal(attributes.title, 'Demo sample');
  // Laid out at the viewport's width, hidden until it loads.
  assert.match(attributes.style ?? '', /inline-size:390px/);
  assert.match(attributes.style ?? '', /visibility:hidden/);
  assert.doesNotMatch(html, /allow-same-origin|preview\/|grant/);
});

test('a demo frame loads nothing but a path under /sample on its own origin', () => {
  for (const src of ['/sample', '/sample?mode=dark', '/sample/chapters/about?variant=x']) {
    assert.equal(isDemoFrameSource(src), true, src);
  }
  for (const src of [
    '/preview/AAAAAAAAAAAAAAAAAAAAAA',
    '/preview/local',
    '/samples',
    '/studio',
    '//evil.example/sample',
    '/\\evil.example/sample',
    'https://evil.example/sample',
    'javascript:alert(1)',
    'sample',
    '/sample/../studio',
    '',
  ]) {
    assert.equal(isDemoFrameSource(src), false, src);
    const html = renderToStaticMarkup(<DemoFrame src={src} title="x" viewport={VIEWPORTS[0]!} />);
    assert.doesNotMatch(html, /<iframe/, src);
  }
});

test('every Demo Studio header shows the approved sandbox line', () => {
  assert.equal(
    renderToStaticMarkup(<SandboxLine />),
    '<p class="studio-shell__signed-in">Demo sandbox — only you can see these changes</p>',
  );
});

test('the Appearance task has a picker and a reset for each axis, a full reset, and the frame of the selection', () => {
  const demo = backend();
  const html = renderToStaticMarkup(
    <DemoStudio
      catalog={CATALOG}
      schemeModes={SCHEME_MODES}
      policy={POLICY}
      backend={demo}
      task="appearance"
    />,
  );
  for (const { axis, label } of CATALOG.axes) {
    assert.match(html, new RegExp(`<select id="studio-appearance-${axis}"`), axis);
    assert.ok(html.includes(`Reset ${label.toLowerCase()}`), label);
  }
  assert.ok(html.includes('>Reset demo<'));
  assert.equal(
    frameAttributes(html).src,
    frameSource(demo.selection(), { catalog: CATALOG, schemeModes: SCHEME_MODES }).replace(
      /&/g,
      '&amp;',
    ),
  );
  assert.match(html, /Composition: Acme Orbit/);
});

test('the Preview task has the viewports, the display mode, and Follow system and Reduced motion', () => {
  const html = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task="preview" />,
  );
  for (const viewport of VIEWPORTS) assert.ok(html.includes(`value="${viewport.id}"`), viewport.id);
  assert.match(html, /<select id="studio-appearance-displayMode"/);
  assert.match(
    html,
    /<option value="system"[^>]*>Follow system<\/option><option value="reduce">Reduced<\/option>/,
  );
  assert.equal((html.match(/<iframe\b/g) ?? []).length, 1);
});

test("a value the build doesn't offer says what shows in its place in the demo, and never mentions publishing", () => {
  for (const { axis, label } of CATALOG.axes) {
    const html = renderToStaticMarkup(
      <AxisField
        id={`studio-appearance-${axis}`}
        axis={axis}
        label={label}
        value="canary-unoffered"
        catalog={CATALOG}
        unoffered={demoUnoffered}
        onChange={() => {}}
      />,
    );
    assert.match(html, /canary-unoffered, not available in this build/, axis);
    assert.match(
      html,
      /<p class="studio-appearance__fact">This build doesn&#x27;t offer it, so .+ shows in its place\.<\/p>/,
      axis,
    );
    assert.doesNotMatch(html, /publish/i, axis);
  }
});

test('no Demo Studio view offers publishing, a draft, signing in or out, or settings', () => {
  for (const task of ['appearance', 'preview'] as const) {
    const html = renderToStaticMarkup(
      <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task={task} />,
    );
    assert.doesNotMatch(
      html,
      /publish|rollback|roll back|draft|sign (?:in|out)|settings|history/i,
      task,
    );
  }
});

test('Demo Studio has its two tasks in the frame, and the sandbox line where Owner Studio says who is signed in', () => {
  const html = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task="appearance" />,
  );
  assert.ok(
    html.includes(
      '<h1 class="studio-shell__name">Portfolio Studio</h1><p class="studio-shell__signed-in">Demo sandbox — only you can see these changes</p></header>',
    ),
  );
  assert.deepEqual(
    [
      ...html.matchAll(
        /<a href="#([a-z-]+)" class="studio-shell__task"(?: aria-current="page")?>([^<]+)<\/a>/g,
      ),
    ].map(([, id, label]) => `${id} ${label}`),
    ['appearance Appearance', 'preview Preview'],
  );
  assert.match(html, /<a href="#appearance" class="studio-shell__task" aria-current="page">/);
  // Without JavaScript it says it needs it, and where the sample works without.
  assert.match(
    html,
    /<noscript>.*Demo Studio needs JavaScript.*<a href="\/sample">see the sample without it<\/a>.*<\/noscript>/,
  );
  // A policy without sandbox.view lists no task.
  assert.doesNotMatch(
    renderToStaticMarkup(
      <DemoStudio
        catalog={CATALOG}
        policy={{ profile: 'demo', allowed: [] }}
        backend={backend()}
      />,
    ),
    /studio-shell__task|<iframe/,
  );
});

test('before the page hands it a backend, the demo only says it is loading, and says when it could not', () => {
  const html = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={null} task="appearance" />,
  );
  assert.match(html, /<p class="studio-state__waiting" aria-busy="true">Loading the demo…<\/p>/);
  assert.doesNotMatch(html, /studio-task"|<iframe/);
  const failed = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={null} failed />,
  );
  assert.match(failed, /role="alert"><p>Demo Studio couldn&#x27;t load/);
  assert.doesNotMatch(failed, /class="studio-state__waiting"/);
});

/** Every import specifier `file` names, type-only ones included, and the file each resolves to under src/. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [
    ...text.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm),
    ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(([, specifier]) => specifier!);
  return specifiers.flatMap((specifier) => {
    const base = specifier.startsWith('~/')
      ? path.join(WEB_SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (base === null) return [];
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return [candidate];
    }
    throw new Error(`${path.relative(WEB_SRC, file)} imports ${specifier}, which doesn't resolve`);
  });
}

test("nothing Demo Studio loads reaches Owner Studio's adapter, its transport, or the server, type imports included", () => {
  const roots = [
    ...readdirSync(SRC)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => path.join(SRC, name)),
    ...readdirSync(path.join(WEB_SRC, 'lib', 'demo'))
      .filter(
        (name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'test-support.ts',
      )
      .map((name) => path.join(WEB_SRC, 'lib', 'demo', name)),
  ];
  assert.ok(roots.some((file) => file.endsWith('demo-studio.tsx')));
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  const reached = [...seen].map((file) => path.relative(WEB_SRC, file));
  const forbidden = reached.filter(
    (file) =>
      /^(?:lib\/studio\/owner-backend\.ts|lib\/studio-fetch\.ts|lib\/studio\/load-backend\.ts|server\/|app\/\(studio\)\/_components\/preview\/)/.test(
        file,
      ) ||
      // Of the owner's shell, only the frame and the axis field it shares.
      (/^app\/\(studio\)\/_components\/shell\//.test(file) &&
        !/\/(?:studio-frame|axis-field)\.tsx$/.test(file)),
  );
  assert.deepEqual(forbidden, []);
  // The walk did follow imports into Studio's shared libraries and its shared frame.
  assert.ok(reached.includes('lib/studio/appearance.ts'), reached.join(', '));
  assert.ok(
    reached.includes('app/(studio)/_components/shell/studio-frame.tsx'),
    reached.join(', '),
  );
  // From the demo page's own client root, which loads the browser backend.
  assert.ok(reached.includes('app/(studio)/_components/demo/demo-shell.tsx'), reached.join(', '));
  assert.ok(reached.includes('lib/demo/browser-backend.ts'), reached.join(', '));
});
