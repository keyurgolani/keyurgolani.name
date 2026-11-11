import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setDeploymentState, type DeploymentState } from '~/server/config-store';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The layout's stylesheets resolve to an empty module outside Next, so it loads after the hook.
const SERVER_ONLY = createRequire(import.meta.url).resolve('server-only');
const EMPTY = pathToFileURL(join(dirname(SERVER_ONLY), 'empty.js')).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier.endsWith('.css')
      ? { url: EMPTY, shortCircuit: true }
      : nextResolve(specifier, context),
});

// Studio's layout renders markup only (row 88c-RC2 (b); routes.test.ts): <body> names no profile,
// under either. The page's load boundary names it on its own wrapper, and error.tsx asks
// auth.session.

test("Studio's <body> names no profile, under owner, demo, or none: the page names it, not the layout (row 88c-RC2 (b))", async (t) => {
  t.after(() => setDeploymentState(undefined));
  const { default: StudioLayout } = await import('./layout');
  for (const profile of ['owner', 'demo'] as const) {
    setDeploymentState({ config: { profile } } as unknown as DeploymentState);
    const html = renderToStaticMarkup(<StudioLayout>{null}</StudioLayout>);
    assert.match(html, /<body class="studio"><\/body>/, profile);
  }
  setDeploymentState(undefined);
  const none = renderToStaticMarkup(<StudioLayout>{null}</StudioLayout>);
  assert.match(none, /<body class="studio"><\/body>/, 'no deployment');
});
