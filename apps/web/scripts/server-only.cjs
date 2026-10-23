// The host's server modules outside Next (#6, Slice 2). The variant
// registry's metadata module imports `server-only`, so no client bundle can
// carry the manifests. A Node process that loads server modules itself, such
// as a test, `pnpm config:validate`, or a spec that reads the route table,
// resolves `server-only` here as Next's server bundles do: to its empty
// module. A client bundle still gets the one that throws. Load this before
// any server module, with `import` or `node --import`.
'use strict';

const { createRequire, registerHooks } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (typeof registerHooks !== 'function') {
  throw new Error('Loading the server modules outside Next needs Node 22.15 or later.');
}

const fromHost = createRequire(path.join(__dirname, '..', 'package.json'));
const EMPTY = pathToFileURL(
  path.join(path.dirname(fromHost.resolve('server-only')), 'empty.js'),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'server-only'
      ? { url: EMPTY, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
