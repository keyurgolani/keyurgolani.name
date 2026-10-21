import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { Writable } from 'node:stream';

// @portfolio/kit/enhancements is a client module, so in Next's RSC build a
// variant's server component never runs its code: each export becomes a
// reference to it. This renders a server component that uses <Enhancement>
// through the RSC renderer Next ships, with Next's own React, as its build
// does (#5, Slice 2). A plain function exported from the module would throw
// when a server component called it, which is why the module exports none.

const require = createRequire(import.meta.url);
const compiled = (file: string) =>
  path.join(path.dirname(require.resolve('next/package.json')), 'dist', 'compiled', file);

// Next aliases React to its own copy, server builds under react-server.
const ALIASES: Readonly<Record<string, string>> = {
  react: compiled('react/react.react-server.js'),
  'next/dist/compiled/react': compiled('react/react.react-server.js'),
  'react/jsx-runtime': compiled('react/jsx-runtime.react-server.js'),
  'react-dom': compiled('react-dom/react-dom.react-server.js'),
};
type Resolve = (request: string, ...rest: unknown[]) => string;
const internals = Module as unknown as { _resolveFilename: Resolve };
const resolve = internals._resolveFilename;
internals._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  return Object.hasOwn(ALIASES, request) ? ALIASES[request]! : resolve.call(this, request, ...rest);
};

interface Rsdw {
  createClientModuleProxy(id: string): Record<string, unknown>;
  renderToPipeableStream(
    model: unknown,
    manifest: unknown,
    options: { onError(error: unknown): void },
  ): { pipe(sink: Writable): void };
}

const React = require('react') as typeof import('react');
const RSDW = require(compiled('react-server-dom-webpack/server.node.js')) as Rsdw;

/** A client manifest that knows every reference, as Next's build writes one per entry. */
const MANIFEST = new Proxy(
  {},
  {
    get: (_target, key) => {
      const [id, name = '*'] = String(key).split('#');
      return { id, chunks: [], name };
    },
  },
);

/** The RSC payload a server tree renders to, or the first error it reports. */
function flight(tree: unknown): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
      final(callback) {
        done(Buffer.concat(chunks).toString('utf8'));
        callback();
      },
    });
    RSDW.renderToPipeableStream(tree, MANIFEST, { onError: fail }).pipe(sink);
  });
}

const kit = RSDW.createClientModuleProxy('@portfolio/kit/enhancements');
const INPUT = { variant: 'kit-shared', ids: { prefix: '', main: 'main' } };

test('the kit module is a client module whose one export is the Enhancement component', () => {
  const source = readFileSync(require.resolve('@portfolio/kit/enhancements'), 'utf8');
  assert.match(source, /^'use client';\n/);
  assert.deepEqual(
    [...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(
      ([, name]) => name,
    ),
    ['Enhancement'],
  );
});

test('a server component renders <Enhancement>, which reaches the browser as a reference', async () => {
  function Variant() {
    return React.createElement(
      'main',
      null,
      React.createElement(kit.Enhancement as string, { input: INPUT, id: 'orbit' }),
    );
  }
  const payload = await flight(React.createElement(Variant));
  assert.match(payload, /I\["@portfolio\/kit\/enhancements",\[\],"Enhancement"\]/);
  // Its props cross as JSON.
  assert.match(payload, /"input":\{"variant":"kit-shared"/);
  assert.match(payload, /"id":"orbit"/);
});

test('a server component that calls a client export throws, so the kit exports components only', async () => {
  function Variant() {
    return React.createElement('main', null, (kit.loadEnhancement as () => null)());
  }
  await assert.rejects(
    flight(React.createElement(Variant)),
    /Attempted to call loadEnhancement\(\) from the server/,
  );
});
