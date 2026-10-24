import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOG } from '~/lib/demo/test-support';
import type { StudioDraft } from '~/lib/studio/documents';
import { draft } from '~/lib/studio/test-support';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The shell's fields import their stylesheet, which Next bundles. Outside
// Next a stylesheet resolves to an empty module, so the shell loads after
// the hook is in place.
const SERVER_ONLY = createRequire(import.meta.url).resolve('server-only');
const EMPTY = pathToFileURL(join(dirname(SERVER_ONLY), 'empty.js')).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier.endsWith('.css')
      ? { url: EMPTY, shortCircuit: true }
      : nextResolve(specifier, context),
});

// The owner's Studio, as it renders before any script runs, held against a
// snapshot taken before #9 moved the shell's frame and one appearance axis
// into components Demo Studio shares (studio-frame.tsx, axis-field.tsx).
// The owner's markup, and so its accessibility tree, mustn't change.
// UPDATE_SHELL_SNAPSHOT=1 writes the snapshot again, for a change to the
// owner's markup that's meant.

const SNAPSHOT = fileURLToPath(new URL('./shell-markup.snapshot.txt', import.meta.url));

const OWNER = {
  profile: 'owner' as const,
  allowed: [
    'studio.view',
    'draft.read',
    'draft.write',
    'history.read',
    'asset.write',
    'preview.grant',
    'publish',
    'rollback',
    'config.status',
  ],
};

/** A saved draft whose site selects a value on every axis, one of them a value the build lacks. */
function appearanceDraft(): StudioDraft {
  const base = draft(3);
  return {
    ...base,
    documents: {
      ...base.documents,
      site: {
        ...base.documents.site,
        model: {
          appearance: {
            variant: 'acme-default',
            designLanguage: 'platform-neutral',
            colorScheme: 'night-only',
            typography: 'humanist-ui',
            displayMode: 'dark',
          },
          visitorControls: { colorScheme: 'selectable', displayMode: 'selectable' },
        },
      },
    },
  };
}

async function markup(): Promise<string> {
  const { AppearanceWorkspace } = await import('./appearance-workspace');
  const { StudioShell } = await import('./studio-shell');
  const shell = renderToStaticMarkup(
    <StudioShell csrfToken="csrf-token" policy={OWNER} appearance={CATALOG} preview={null} />,
  );
  const workspace = renderToStaticMarkup(
    <AppearanceWorkspace
      draft={appearanceDraft()}
      dirty={false}
      saving={false}
      canWrite
      catalog={CATALOG}
      csrfToken="csrf-token"
      preview={null}
      onApply={() => {}}
    />,
  );
  return `${shell}\n${workspace}\n`;
}

test("the owner shell's and Appearance workspace's markup is the snapshot's, so its accessibility tree is too", async () => {
  const now = await markup();
  if (process.env.UPDATE_SHELL_SNAPSHOT === '1') writeFileSync(SNAPSHOT, now);
  assert.equal(now, readFileSync(SNAPSHOT, 'utf8'));
});
