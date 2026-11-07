import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

// /studio's server answer stays whole on a cold render (row 88c): the first
// render after a start, when next/dynamic's React.lazy throws on its first
// call, as on every later one. Rendered the way Next renders a dynamic page,
// on Next's own vendored React (dist/compiled/react, react-dom/server.node):
// renderToPipeableStream, onShellReady, one setImmediate, then pipe
// (next/dist/server/app-render/stream-ops.node.js). The page's data comes
// from the RSC stream after a little I/O, as requireOwnerPage's does.
//
// The real StudioLoadBoundary, around next/dynamic's app-router Loadable
// (next/dist/shared/lib/lazy-dynamic/loadable.js) and a stand-in shell. A
// Suspense boundary anywhere between them would let Fizz finish the shell
// before the lazy settles, so the first answer after every start would
// stream the shell out of line: <!--$?-->, <template id="B:0">, a hidden S:0
// div and $RC(. Neither render may hold any of those, and both are the same.
// <!--$--> isn't checked: Next's metadata boundaries put one in every page.

Object.assign(process.env, { NODE_ENV: 'production' });

const fromWeb = createRequire(import.meta.url);
const NEXT = path.join(path.dirname(fromWeb.resolve('next')), '..', '..');
const compiled = (name: string) => path.join(NEXT, 'dist', 'compiled', name);

// Every React the boundary and its imports load is Next's vendored one, the one /studio renders with.
const REDIRECT: Record<string, string> = {
  react: compiled('react/index.js'),
  'react/jsx-runtime': compiled('react/jsx-runtime.js'),
  'react/jsx-dev-runtime': compiled('react/jsx-dev-runtime.js'),
  'react-dom': compiled('react-dom/index.js'),
  'react-dom/client': compiled('react-dom/client.js'),
};
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier in REDIRECT
      ? { url: pathToFileURL(REDIRECT[specifier]!).href, shortCircuit: true }
      : nextResolve(specifier, context),
});

type Element = unknown;
type ReactModule = {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => Element;
  lazy: (load: () => Promise<{ default: unknown }>) => unknown;
  use: (promise: Promise<unknown>) => unknown;
  Fragment: unknown;
  Suspense: unknown;
  version: string;
};
type FizzModule = {
  renderToPipeableStream: (
    element: Element,
    options: {
      onShellReady: () => void;
      onShellError: (error: unknown) => void;
      onError: (error: unknown) => void;
    },
  ) => { pipe: (sink: Writable) => void };
};

const React = fromWeb(REDIRECT.react!) as ReactModule;
const { renderToPipeableStream } = fromWeb(compiled('react-dom/server.node.js')) as FizzModule;
// tsx compiles JSX to React.createElement calls, so the test supplies React: Next's.
Object.assign(globalThis, { React });
const h = React.createElement;

/** The shell, as its server render starts: Studio's name, who's signed in, and its main. */
function StandInShell() {
  return h(
    'div',
    { className: 'studio-shell' },
    h(
      'header',
      { className: 'studio-shell__header' },
      h('h1', { className: 'studio-shell__name' }, 'Portfolio Studio'),
      h('p', { className: 'studio-shell__signed-in' }, 'Signed in'),
    ),
    h(
      'main',
      { className: 'studio-shell__main', id: 'studio-main', tabIndex: -1 },
      'x'.repeat(2_000),
    ),
  );
}

/** next/dynamic's app-router Loadable with ssr and no loading (loadable.js), over a fresh React.lazy. */
function loadable() {
  // Turbopack's SSR loader: the chunks already required, then the module, then its export.
  const load = () =>
    Promise.all([Promise.resolve(), Promise.resolve()])
      .then(() => ({ StudioShell: StandInShell }))
      .then((module) => ({ default: module.StudioShell }));
  const Lazy = React.lazy(load);
  // No Suspense: with ssr and no loading, loadable.js wraps the lazy in a Fragment.
  return function LoadableComponent() {
    return h(React.Fragment, null, h(React.Fragment, null, null, h(Lazy)));
  };
}

/** The page's data, from the RSC stream after a little I/O: one row per render. */
function FromRsc({
  row,
  children,
}: {
  readonly row: Promise<unknown>;
  readonly children: Element;
}) {
  React.use(row);
  return children;
}

/** One render as Next's app-render drives a dynamic page. */
async function render(page: Element): Promise<string> {
  let out = '';
  const row = new Promise((resolve) => setTimeout(resolve, 5));
  const sink = new Writable({
    write(chunk, _encoding, done) {
      out += String(chunk);
      done();
    },
  });
  const finished = new Promise((resolve) => sink.on('finish', resolve));
  let ready: () => void = () => {};
  let failed: (error: unknown) => void = () => {};
  const shell = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const stream = renderToPipeableStream(
    h(
      'html',
      { lang: 'en' },
      h('head', null, h('title', null, 'Portfolio Studio')),
      h('body', { className: 'studio' }, h(FromRsc, { row }, page)),
    ),
    { onShellReady: () => ready(), onShellError: (error) => failed(error), onError: () => {} },
  );
  await shell;
  await new Promise((resolve) => setImmediate(resolve));
  stream.pipe(sink);
  await finished;
  return out;
}

/** What would stream the shell out of line, found in `html`. */
function outOfLine(html: string): string[] {
  const found = ['<!--$?-->', '<template id="B:', '<div hidden id="S:', '$RC('].filter((marker) =>
    html.includes(marker),
  );
  const hidden = html.indexOf('<div hidden id="S:');
  if (hidden >= 0 && html.indexOf('Signed in', hidden) >= 0)
    found.push('"Signed in" in a hidden segment');
  return found;
}

test("/studio's load boundary renders the shell whole on the first render after a start and on the next, with Next's vendored Fizz in Next's order (row 88c)", async () => {
  const { StudioLoadBoundary } = await import('./load-boundary');
  const Shell = loadable();
  const page = () => h(StudioLoadBoundary, null, h(Shell));
  const first = await render(page());
  const second = await render(page());
  assert.deepEqual(outOfLine(first), [], 'render 1, the cold one');
  assert.deepEqual(outOfLine(second), [], 'render 2');
  assert.equal(first, second, 'render 1 and render 2 are the same');
  assert.ok(first.includes('<div class="studio-load">'), first);
  assert.ok(first.includes('Signed in'), first);
});

test('the cold render check sees a Suspense boundary around the shell (row 88c)', async () => {
  // The same pipeline over a Suspense boundary, as a boundary inside StudioLoadBoundary would be.
  const Shell = loadable();
  const page = () =>
    h('div', { className: 'studio-load' }, h(React.Suspense, { fallback: null }, h(Shell)));
  const first = await render(page());
  assert.notDeepEqual(outOfLine(first), [], 'a cold render streams it out of line');
  assert.deepEqual(outOfLine(await render(page())), [], 'a warm one does not');
});
