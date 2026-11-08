import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppearanceOptions } from '~/lib/preview-frame';
import { StudioPreview, type PreviewChoice } from './studio-preview';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// /studio/preview's Refresh before any script runs (row 89, row 88's class). The server renders the
// page's controls, and Refresh's only effect is the page's own script: a new grant, and the frame
// loaded again. A click before the page hydrates goes nowhere and says nothing, so the server's
// markup holds it, as Sign out is held (row 88): aria-disabled, in Studio's busy look, its place
// in the focus order kept, never natively disabled, which Studio has no look for.

const OPTIONS: AppearanceOptions = {
  variants: [],
  designLanguages: [],
  colorSchemes: [],
  typography: [],
};

const CHOICES: readonly PreviewChoice[] = [
  {
    id: 'draft',
    label: 'Draft version 3',
    kind: 'draft',
    subject: { draft: 'draft-1', version: 3 },
    variant: null,
    appearance: null,
  },
];

const refresh = (html: string) => /<button[^>]*>Refresh<\/button>/.exec(html)?.[0] ?? '';

test('Refresh renders aria-disabled before any script runs, so a click before /studio/preview hydrates is never lost (row 89)', () => {
  const html = renderToStaticMarkup(
    <StudioPreview
      csrfToken="csrf-token"
      choices={CHOICES}
      sandbox="allow-scripts"
      previewOrigin={null}
      signIn="/studio/sign-in?state=session_ended"
      appearanceOptions={OPTIONS}
    />,
  );
  const button = refresh(html);
  assert.notEqual(button, '', 'the page renders Refresh');
  assert.ok(button.includes('aria-disabled="true"'), button);
  assert.ok(
    !/\sdisabled[=\s>]/.test(button),
    'never natively disabled, which Studio has no look for',
  );
});

// Its eleven selects before any script runs (row 89, A's ruling, 8 Nov 2026): seven in the
// controls form and the four of the frame's appearance, each a control whose only effect is the
// page's own script. A change before the page hydrates goes nowhere and says nothing, so the
// server's markup disables them, the controls one by one and the appearance by its fieldset, in
// .studio-input:disabled's look. A select can't be held by aria-disabled: it would still change.

/** A version whose site selects a whole appearance, so its appearance is held only until hydration. */
const WITH_APPEARANCE: readonly PreviewChoice[] = [
  {
    ...CHOICES[0]!,
    appearance: {
      variant: 'acme-default',
      designLanguage: 'platform-neutral',
      colorScheme: 'night-only',
      typography: 'humanist-ui',
      displayMode: 'dark',
    },
  },
];

test("/studio/preview's eleven selects render disabled before any script runs, so a change before the page hydrates is never lost (row 89)", () => {
  const html = renderToStaticMarkup(
    <StudioPreview
      csrfToken="csrf-token"
      choices={WITH_APPEARANCE}
      sandbox="allow-scripts"
      previewOrigin={null}
      signIn="/studio/sign-in?state=session_ended"
      appearanceOptions={OPTIONS}
    />,
  );
  const form =
    /<form[^>]*aria-label="Preview controls"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
  const controls = [...form.matchAll(/<select[^>]*>/g)].map(([tag]) => tag);
  assert.equal(controls.length, 7, 'the controls form renders its seven selects');
  for (const select of controls) assert.match(select, /\sdisabled=""/, select);
  const fieldset =
    /<fieldset[^>]*class="studio-preview__appearance"[^>]*>[\s\S]*?<\/fieldset>/.exec(html)?.[0] ??
    '';
  assert.equal([...fieldset.matchAll(/<select/g)].length, 4, 'the appearance renders its four');
  assert.match(
    /^<fieldset[^>]*>/.exec(fieldset)?.[0] ?? '',
    /\sdisabled=""/,
    'held by its fieldset',
  );
  // Held only until hydration: the note that this version selects no appearance isn't said.
  assert.ok(!fieldset.includes('selects no whole appearance'), 'no note for a held appearance');
});
