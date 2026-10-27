// SpatialCanvas's mount (#16), as React's Strict Mode runs it: mount,
// unmount, mount. A canvas whose context was forced lost never gets one
// again, and R3F loses a root's context half a second after it unmounts,
// so each mount must make its own canvas and take it out when it goes,
// whatever happened, a renderer that couldn't be made included. Driven with
// a host and a document of plain objects and a stubbed renderer, since the
// repository has no DOM to run the component in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCanvas, type CanvasHost } from './spatial-canvas';

interface FakeCanvas {
  readonly id: number;
  readonly attributes: Map<string, string>;
  className: string;
  readonly style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** A host and the document that makes its canvases, recording each one. */
function fakeHost() {
  const children: FakeCanvas[] = [];
  const made: FakeCanvas[] = [];
  const host = {
    ownerDocument: {
      createElement(tag: string) {
        assert.equal(tag, 'canvas');
        const canvas: FakeCanvas = {
          id: made.length,
          attributes: new Map(),
          className: '',
          style: {},
          setAttribute(name, value) {
            this.attributes.set(name, value);
          },
          remove() {
            const at = children.indexOf(canvas);
            if (at >= 0) children.splice(at, 1);
          },
        };
        made.push(canvas);
        return canvas;
      },
    },
    append(node: FakeCanvas) {
      children.push(node);
    },
  };
  return { host: host as unknown as CanvasHost, children, made };
}

test('each mount makes its own canvas and its teardown removes it, across mount, unmount and mount', () => {
  const { host, children, made } = fakeHost();
  const rendered: number[] = [];
  const stopped: number[] = [];
  const current: (FakeCanvas | null)[] = [];
  const mount = () =>
    mountCanvas(host, {
      className: 'sb-still__gl',
      onCanvas: (canvas) => current.push(canvas as unknown as FakeCanvas | null),
      createRenderer: (canvas) => {
        rendered.push((canvas as unknown as FakeCanvas).id);
        return { canvas };
      },
      onContextFailure: () => assert.fail('no failure'),
      start: (canvas, _renderer, release) => () => {
        stopped.push((canvas as unknown as FakeCanvas).id);
        release();
      },
    });

  const first = mount();
  assert.equal(made.length, 1);
  assert.deepEqual(children, [made[0]]);
  // Marked as the kit's canvas, decoration, with the caller's class.
  assert.equal(made[0]!.attributes.get('data-spatial-canvas'), '');
  assert.equal(made[0]!.attributes.get('aria-hidden'), 'true');
  assert.equal(made[0]!.className, 'sb-still__gl');

  first();
  assert.deepEqual(children, [], 'the first canvas is gone');

  const second = mount();
  assert.equal(made.length, 2, 'the second mount made a canvas of its own');
  assert.notEqual(made[1], made[0]);
  assert.deepEqual(children, [made[1]]);
  assert.deepEqual(rendered, [0, 1], 'each renderer on its own canvas');

  second();
  assert.deepEqual(children, []);
  assert.deepEqual(stopped, [0, 1]);
  // The component's ref followed: each canvas, then null.
  assert.deepEqual(current, [made[0], null, made[1], null]);
  // A teardown run twice does nothing more.
  second();
  assert.deepEqual(stopped, [0, 1]);
});

test('a renderer that can’t be made reports the context failure, and the teardown still removes its canvas', () => {
  const { host, children, made } = fakeHost();
  const failures: unknown[] = [];
  let started = false;
  const teardown = mountCanvas(host, {
    createRenderer: () => {
      throw new Error('no WebGL2 context');
    },
    onContextFailure: (error) => failures.push(error),
    start: () => {
      started = true;
      return () => {};
    },
  });
  assert.equal(failures.length, 1);
  assert.match(String(failures[0]), /no WebGL2 context/);
  assert.equal(started, false, 'nothing after the renderer runs');
  assert.deepEqual(children, [made[0]]);
  teardown();
  assert.deepEqual(children, []);
  // And the next mount, as Strict Mode makes it, starts on a canvas of its own.
  mountCanvas(host, {
    createRenderer: () => ({}),
    onContextFailure: () => assert.fail('no failure'),
    start: (_canvas, _renderer, release) => release,
  });
  assert.equal(made.length, 2);
  assert.deepEqual(children, [made[1]]);
});

test('a failure inside the mount tears it down through release, which removes the canvas once', () => {
  const { host, children, made } = fakeHost();
  let fail: (() => void) | undefined;
  const teardown = mountCanvas(host, {
    createRenderer: () => ({}),
    onContextFailure: () => assert.fail('no failure'),
    start: (_canvas, _renderer, release) => {
      let down = false;
      const stop = () => {
        if (down) return;
        down = true;
        release();
      };
      fail = stop;
      return stop;
    },
  });
  assert.deepEqual(children, [made[0]]);
  fail!();
  assert.deepEqual(children, [], 'a context lost mid-mount takes its canvas out');
  teardown();
  assert.deepEqual(children, []);
});

test('the mount’s own teardown removes the canvas even when the rest of the mount never releases it', () => {
  const { host, children, made } = fakeHost();
  let stopped = 0;
  const teardown = mountCanvas(host, {
    createRenderer: () => ({}),
    onContextFailure: () => assert.fail('no failure'),
    // A start whose teardown forgets the canvas: the mount's own teardown still takes it out.
    start: () => () => {
      stopped += 1;
    },
  });
  assert.deepEqual(children, [made[0]]);
  teardown();
  assert.equal(stopped, 1);
  assert.deepEqual(children, []);
});

test('the canvas bundles the three.js it draws with, never the whole of three', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./spatial-canvas.tsx', import.meta.url), 'utf8');
  // A namespace import, or extend() handed one, keeps every class of three in the stage's chunk.
  assert.doesNotMatch(source, /import \* as THREE/);
  assert.doesNotMatch(source, /extend\(THREE/);
  const { SCENE_CATALOGUE } = await import('./spatial-canvas');
  assert.deepEqual(Object.keys(SCENE_CATALOGUE).sort(), [
    'BoxGeometry',
    'BufferAttribute',
    'BufferGeometry',
    'Color',
    'Group',
    'LineBasicMaterial',
    'LineSegments',
    'Mesh',
    'MeshBasicMaterial',
  ]);
});

// The lead's condition on the named catalogue: no consumer of the kit's spatial
// canvas renders an element R3F doesn't know, which would throw "X is not part
// of the THREE namespace" at its first frame. A full R3F render needs WebGL and
// a DOM, which this suite has neither of, so this is a static scan: every
// lowercase intrinsic each consumer's TSX renders is registered, by the
// catalogue, by an extend() in that file, or by the catalogue prop it passes.

/** Lowercase elements a scene's TSX may hold that aren't three.js classes. */
const NOT_THREE = new Set([
  'a',
  'button',
  'canvas',
  'div',
  'figure',
  'img',
  'li',
  'p',
  'section',
  'span',
  'svg',
  'ul',
]);
/** R3F's own intrinsics, which need no registering. */
const R3F_OWN = new Set(['primitive']);

/** The lowercase JSX elements a TSX source opens: not generics such as useRef<number>. */
function intrinsicsOf(source: string): string[] {
  const found = new Set<string>();
  for (const [, name] of source.matchAll(/(?:^|[\s({>?:&|])<([a-z][A-Za-z0-9]*)(?=[\s/>])/gm)) {
    if (!NOT_THREE.has(name!) && !R3F_OWN.has(name!)) found.add(name!);
  }
  return [...found].sort();
}

/** The classes a source registers itself: the keys of its extend({...}) and catalogue={{...}}. */
function registeredIn(source: string): string[] {
  const keys: string[] = [];
  for (const [, body] of source.matchAll(/(?:extend\(|catalogue=\{)\{([^}]*)\}/g)) {
    for (const [, key] of body!.matchAll(/([A-Z][A-Za-z0-9]*)\s*:/g)) keys.push(key!);
  }
  return keys;
}

test('every element a spatial-canvas consumer renders is registered, so none is "not part of the THREE namespace"', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { SCENE_CATALOGUE } = await import('./spatial-canvas');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packages = path.resolve(here, '../../..');
  // The consumers: the kit's own scene parts, and every source under packages/ that imports the canvas,
  // R3F or drei, so a scene part split into a file of its own is scanned too.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (name === 'node_modules' || name.startsWith('.')) return [];
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const sources = readdirSync(packages).flatMap((pkg) => {
    const src = path.join(packages, pkg, 'src');
    try {
      return walk(src).filter((file) => /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file));
    } catch {
      return [];
    }
  });
  const consumers = sources.filter(
    (file) =>
      path.dirname(file) === here ||
      /from '(?:@portfolio\/kit\/(?:spatial-canvas|spatial-r3f)|@react-three\/(?:fiber|drei))'/.test(
        readFileSync(file, 'utf8'),
      ),
  );
  const names = consumers.map((file) => path.relative(packages, file));
  assert.ok(names.includes('variant-spatial-bento/src/stage-canvas.tsx'), names.join(', '));
  assert.ok(names.includes('kit/src/spatial-r3f/transmission-gem.tsx'), names.join(', '));
  const catalogue = new Set(Object.keys(SCENE_CATALOGUE));
  let checked = 0;
  for (const file of consumers) {
    const source = readFileSync(file, 'utf8');
    const own = new Set(registeredIn(source));
    for (const element of intrinsicsOf(source)) {
      const name = element[0]!.toUpperCase() + element.slice(1);
      assert.ok(
        catalogue.has(name) || own.has(name),
        `${path.relative(packages, file)} renders <${element}>, and neither the catalogue nor the file registers ${name}`,
      );
      checked += 1;
    }
  }
  // SB's stage alone draws with eight classes and the gem with five; the scan has to have found them.
  assert.ok(checked >= 13, `${checked} elements`);
  // The scan itself: generics aren't elements, DOM isn't three.
  assert.deepEqual(intrinsicsOf('const r = useRef<number>(0); return <div><mesh /></div>;'), [
    'mesh',
  ]);
  assert.deepEqual(registeredIn('extend({ IcosahedronGeometry: THREE.IcosahedronGeometry });'), [
    'IcosahedronGeometry',
  ]);
});

// What drei renders inside a kit primitive is R3F intrinsics too, out of the
// scan's sight: Html's blending occluder (FloatingCard's `occlude`) draws a
// plane with a shader material. The primitive registers them where it draws.
test('what drei draws inside a kit primitive is registered by that primitive: FloatingCard’s occluder', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const drei = path.dirname(require.resolve('@react-three/drei'));
  const html = readFileSync(path.join(drei, 'web/Html.js'), 'utf8');
  const { SCENE_CATALOGUE } = await import('./spatial-canvas');
  const catalogue = new Set(Object.keys(SCENE_CATALOGUE));
  const drawn = ['planeGeometry', 'shaderMaterial'];
  for (const element of drawn) assert.match(html, new RegExp(`createElement\\("${element}"`));
  const card = readFileSync(new URL('./floating-card.tsx', import.meta.url), 'utf8');
  const own = new Set(registeredIn(card));
  for (const element of drawn) {
    const name = element[0]!.toUpperCase() + element.slice(1);
    assert.ok(catalogue.has(name) || own.has(name), `FloatingCard's occluder draws <${element}>`);
  }
  // Inside the component, under its occlude, not at import.
  assert.match(card, /if \(occlude\) extend\(\{/);
});
