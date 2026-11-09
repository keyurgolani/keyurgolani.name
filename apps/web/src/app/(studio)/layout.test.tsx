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

// Studio's <body> names the deployment's profile (row 88c-RC2), so error.tsx and the load alerts,
// which load no owner code, offer Sign out under owner alone.

test("Studio's <body> names the deployment's profile, which error.tsx and the load alerts read (row 88c-RC2)", async (t) => {
  t.after(() => setDeploymentState(undefined));
  const { default: StudioLayout } = await import('./layout');
  for (const profile of ['owner', 'demo'] as const) {
    setDeploymentState({ config: { profile } } as unknown as DeploymentState);
    const html = renderToStaticMarkup(<StudioLayout>{null}</StudioLayout>);
    assert.match(
      html,
      new RegExp(`<body class="studio" data-studio-profile="${profile}">`),
      profile,
    );
  }
  setDeploymentState(undefined);
  const none = renderToStaticMarkup(<StudioLayout>{null}</StudioLayout>);
  assert.match(none, /<body class="studio">/, 'no deployment, no profile');
});
