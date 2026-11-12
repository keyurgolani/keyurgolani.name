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

const signOutForm = (html: string) =>
  /<form[^>]*action="\/api\/studio\/auth\.logout"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';

test('Sign out is a form post to auth.logout from the first byte, so it signs out before the shell hydrates and without JavaScript, its discard choice for no-JS alone (row 88c-RC2)', async () => {
  const { StudioShell } = await import('./studio-shell');
  const shell = renderToStaticMarkup(
    <StudioShell csrfToken="csrf-token" policy={OWNER} appearance={CATALOG} preview={null} />,
  );
  const form = signOutForm(shell);
  assert.notEqual(form, '', 'the shell renders Sign out as a form');
  assert.match(/^<form[^>]*>/.exec(form)![0], /\smethod="post"/);
  const button = /<button[^>]*>Sign out<\/button>/.exec(form)?.[0] ?? '';
  assert.match(button, /\stype="submit"/, button);
  // It takes a click from the first byte: the native post is the way out before hydration
  // (row 88's aria-disabled hold comes off).
  assert.ok(!button.includes('aria-disabled'), button);
  assert.ok(!/\sdisabled[=\s>]/.test(button), button);
  // Without JavaScript the owner can choose to discard this browser's unsaved changes; with it,
  // the dialog asks, so the second submit is in <noscript>.
  const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(form)?.[1] ?? '';
  const discard =
    /<button[^>]*>Discard unsaved changes and sign out<\/button>/.exec(noscript)?.[0] ?? '';
  for (const attribute of ['type="submit"', 'name="choice"', 'value="discard"']) {
    assert.ok(discard.includes(attribute), `the discard submit: ${attribute} in ${discard}`);
  }
  assert.ok(
    !/name="choice"/.test(form.replace(/<noscript>[\s\S]*?<\/noscript>/, '')),
    'keep is the default',
  );
});

/** The Appearance workspace's form alone, as a session with no preview has it. */
async function workspaceWith(options: { dirty: boolean; content: boolean }): Promise<string> {
  const { AppearanceWorkspace } = await import('./appearance-workspace');
  return renderToStaticMarkup(
    <AppearanceWorkspace
      draft={appearanceDraft()}
      dirty={options.dirty}
      saving={false}
      canWrite
      catalog={CATALOG}
      csrfToken="csrf-token"
      preview={null}
      content={options.content ? { rail: <p>Fields</p>, onSave: () => {} } : null}
      onApply={() => {}}
    />,
  );
}

const saveDraft = (html: string) => /<button[^>]*>Save draft<\/button>/.exec(html)?.[0] ?? '';

test('Save draft saves unsaved text from Appearance too, and says so, never holding on the other task (OWN-5)', async () => {
  const appearance = await workspaceWith({ dirty: true, content: false });
  assert.ok(saveDraft(appearance) !== '');
  assert.ok(!saveDraft(appearance).includes('aria-disabled'));
  assert.ok(appearance.includes('Save draft keeps your content changes as draft version 4.'));
  assert.ok(!appearance.includes('resolve your unsaved source changes first'));
  const content = await workspaceWith({ dirty: true, content: true });
  assert.ok(!saveDraft(content).includes('aria-disabled'));
  assert.ok(!saveDraft(content).includes('title='));
  assert.ok(content.includes('Save draft keeps your changes as draft version 4.'));
  // Nothing unsaved: held, as before.
  const clean = await workspaceWith({ dirty: false, content: true });
  assert.ok(saveDraft(clean).includes('aria-disabled="true"'));
});
