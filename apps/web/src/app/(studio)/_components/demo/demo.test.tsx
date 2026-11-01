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
// /sample sandboxed to scripts alone, with no grant or /preview path, and a
// channel nonce of its own for the appearance it takes in place (DEM-2,
// demo-frame.test.tsx); a body with no publish, draft, or sign-in; and none of it able to
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

/** Each native radio in `html`, by its option: its group's name, whether it's checked or off, and its name. */
const radiosIn = (html: string) =>
  [...html.matchAll(/data-option="([^"]+)"><input type="radio" ([^>]*)\/>/g)].map(
    ([, id, attrs]) => ({
      id: id!,
      group: /name="([^"]+)"/.exec(attrs!)?.[1],
      checked: /checked=""/.test(attrs!),
      disabled: /disabled=""/.test(attrs!),
      label: /aria-label="([^"]+)"/.exec(attrs!)?.[1],
    }),
  );

test('a demo frame loads /sample, sandboxed to scripts alone, with no referrer and no permissions', () => {
  const src = '/sample?variant=acme-orbit&mode=dark';
  // Once its gate has let it load (frame-gate.test.tsx has the gate itself).
  const html = renderToStaticMarkup(
    <DemoFrame src={src} title="Demo sample" viewport={VIEWPORTS[2]!} requested />,
  );
  const attributes = frameAttributes(html);
  assert.equal(DEMO_FRAME_SANDBOX, 'allow-scripts');
  assert.equal(attributes.sandbox, 'allow-scripts');
  // With a channel nonce of its own in its fragment, for its agent's hello (DEM-2).
  assert.equal(
    attributes.src?.replace(/#nonce=[A-Za-z0-9_-]{22}$/, ''),
    src.replace(/&/g, '&amp;'),
  );
  assert.match(attributes.src ?? '', /#nonce=[A-Za-z0-9_-]{22}$/);
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
    '<p class="studio-shell__signed-in">Demo sandbox. Only you can see these changes.</p>',
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
      initialFrameRequested
    />,
  );
  // Each axis a picker, never a native select, each with a reset in its head; the display mode last.
  assert.doesNotMatch(html, /<select/);
  for (const { axis, label } of CATALOG.axes) {
    assert.match(html, new RegExp(`role="radiogroup" class="[^"]*" aria-label="${label}"`), axis);
    assert.ok(html.includes(`aria-label="Reset ${label.toLowerCase()}"`), label);
  }
  assert.ok(html.includes('>Reset demo<'));
  assert.equal(
    // Less the channel nonce each frame document gets in its fragment (DEM-2).
    frameAttributes(html).src?.replace(/#nonce=[A-Za-z0-9_-]{22}$/, ''),
    frameSource(demo.selection(), { catalog: CATALOG, schemeModes: SCHEME_MODES }).replace(
      /&/g,
      '&amp;',
    ),
  );
  assert.match(html, /Composition: Acme Orbit/);
});

test("the Appearance view's preview has the device widths and Follow system and Reduced motion in the bar over the frame, after the rail and before the frame", () => {
  const html = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task="appearance" />,
  );
  for (const viewport of VIEWPORTS) {
    assert.ok(
      radiosIn(html).some(({ id, label }) => id === viewport.id && label),
      viewport.id,
    );
  }
  // The display mode is an appearance axis, once, in the rail, as a segmented control.
  assert.equal((html.match(/aria-label="Display mode"/g) ?? []).length, 1);
  assert.ok(
    html.indexOf('aria-label="Display mode"') < html.indexOf('aria-label="Preview controls"'),
  );
  assert.match(
    html,
    />Follow system<\/label><label class="studio-choice" data-option="reduce"><input[^>]*>Reduced</,
  );
  assert.equal((html.match(/<iframe\b/g) ?? []).length, 1);
  // Tab order: the top bar, the rail, the bar over the frame, the frame, then the bottom bar.
  const undo = html.indexOf('aria-label="Undo"');
  const controls = html.indexOf('aria-label="Composition"');
  const toolbar = html.indexOf('aria-label="Preview controls"');
  assert.ok(undo > 0 && undo < controls, 'undo and redo in the top bar, before the rail');
  assert.ok(controls < toolbar, 'the rail before the bar over the frame');
  assert.ok(toolbar < html.indexOf('<iframe'), 'that bar before the frame');
  assert.ok(html.indexOf('<iframe') < html.indexOf('>Reset demo<'), 'Reset demo in the bottom bar');
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
  for (const task of ['appearance', 'content'] as const) {
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
  // The Appearance workspace's bottom bar says it under the stage; its tasks sit in the source menu.
  const workspace = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task="appearance" />,
  );
  assert.match(
    workspace,
    // Its name leads home to Appearance, the page it is.
    /<h1 class="studio-mark__name"><a class="studio-mark__home" href="#appearance" aria-current="page"><span class="studio-mark__first">Portfolio <\/span>Studio<\/a><\/h1><span class="studio-mark__tag">Demo<\/span>/,
  );
  assert.ok(
    workspace.includes(
      '<p class="studio-split__sandbox">Demo sandbox. Only you can see these changes.</p>',
    ),
  );
  assert.match(
    workspace,
    /<a href="#appearance" class="studio-menu__item studio-shell__task" aria-current="page">/,
  );
  // Content is the same workspace (DEM-1): the mark and the sandbox line, both tasks in its
  // menus, Content marked as the page, and none of the old frame's header, tab rail, or cards.
  const html = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={backend()} task="content" />,
  );
  assert.match(
    html,
    // Its name leads home to Appearance, from Content the way back.
    /<h1 class="studio-mark__name"><a class="studio-mark__home" href="#appearance"><span class="studio-mark__first">Portfolio <\/span>Studio<\/a><\/h1><span class="studio-mark__tag">Demo<\/span>/,
  );
  assert.ok(
    html.includes(
      '<p class="studio-split__sandbox">Demo sandbox. Only you can see these changes.</p>',
    ),
  );
  assert.deepEqual(
    [
      ...new Set(
        [
          ...html.matchAll(
            /<a href="#([a-z-]+)" class="studio-menu__item studio-shell__task"(?: aria-current="page")?(?: aria-describedby="[^"]+")?>([^<]+)<\/a>/g,
          ),
        ].map(([, id, label]) => `${id} ${label}`),
      ),
    ],
    ['appearance Appearance', 'content Content'],
  );
  assert.match(
    html,
    /<a href="#content" class="studio-menu__item studio-shell__task" aria-current="page"/,
  );
  assert.doesNotMatch(
    html,
    /class="studio-shell__(?:header|nav)"|studio-state__heading|Where things stand<\/h2>/,
  );
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
  assert.doesNotMatch(html, /studio-split__(?:rail|preview)|<iframe/);
  const failed = renderToStaticMarkup(
    <DemoStudio catalog={CATALOG} policy={POLICY} backend={null} failed />,
  );
  assert.match(failed, /role="alert"><p>Demo Studio couldn&#x27;t load/);
  assert.doesNotMatch(failed, /class="studio-state__waiting"/);
});

test('loading, the demo is already the workspace, the box its split takes, so nothing moves as it mounts', () => {
  for (const task of ['appearance', 'content'] as const) {
    for (const failed of [false, true]) {
      const html = renderToStaticMarkup(
        <DemoStudio catalog={CATALOG} policy={POLICY} backend={null} task={task} failed={failed} />,
      );
      // No shell header or navigation above the main to give way to the split (CLS 0.201 at 390).
      assert.match(
        html,
        /^<div class="studio-shell studio-shell--workspace">/,
        `${task} ${failed}`,
      );
      assert.doesNotMatch(html, /class="studio-shell__(?:header|nav)"/, `${task} ${failed}`);
      // The split's box and its top bar's name, the page's h1, and the line or alert where the stage goes.
      assert.match(
        html,
        /<section class="studio-task" aria-labelledby="studio-task-heading"><h2 id="studio-task-heading" class="studio-task__heading">(?:Appearance|Content)<\/h2><div class="studio-split studio-split--pending"><div class="studio-split__top"><div class="studio-split__top-rail"><span class="studio-mark">.*?<h1 class="studio-mark__name">.*?<\/h1>.*?<\/div><\/div><div class="studio-split__pending">(?:<p class="studio-state__waiting" aria-busy="true">Loading the demo…<\/p>|<div class="studio-alert" role="alert">)/,
        `${task} ${failed}`,
      );
      // Said once: the state section holds only the live region while the stage holds the line.
      assert.equal(html.match(/Loading the demo…|Demo Studio couldn&#x27;t load/g)?.length, 1);
    }
  }
  // Without JavaScript the notice still says what the demo needs, in the task's anchor.
  assert.match(
    renderToStaticMarkup(<DemoStudio catalog={CATALOG} policy={POLICY} backend={null} />),
    /<div id="content" tabindex="-1"><noscript>.*Demo Studio needs JavaScript/,
  );
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
