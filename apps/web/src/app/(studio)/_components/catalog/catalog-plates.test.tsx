import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogPlates, type CatalogPlate } from './catalog-plates';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The catalog fixture's Live preview before any script runs (row 89, row 88's class). The server
// renders each plate's button, and its only effect is the page's own script, the preview
// scheduler: a click before the page hydrates goes nowhere and says nothing. The server's markup
// disables it natively, in the browser's own look, as the fixture route has no Studio style for a
// plain button (A's ruling, 8 Nov 2026).

const PLATES: readonly CatalogPlate[] = [
  { id: 'acme-default', name: 'Acme default', tier: 'light', stills: [] },
  { id: 'acme-dense', name: 'Acme dense', tier: 'heavy', stills: [] },
];

const livePreviews = (html: string) => [...html.matchAll(/<button[^>]*>Live preview<\/button>/g)];

test("every plate's Live preview renders disabled before any script runs, so a click before the catalog hydrates is never lost (row 89)", () => {
  const html = renderToStaticMarkup(
    <CatalogPlates
      plates={PLATES}
      csrfToken="csrf-token"
      subject={{ revision: 'revision-1' }}
      appearance={{
        variant: 'acme-default',
        designLanguage: 'platform-neutral',
        colorScheme: 'night-only',
        typography: 'humanist-ui',
        displayMode: 'dark',
      }}
      sandbox="allow-scripts"
      previewOrigin={null}
      signIn="/studio/sign-in?state=session_ended"
    />,
  );
  const buttons = livePreviews(html).map(([tag]) => tag);
  assert.equal(buttons.length, PLATES.length, 'a Live preview on every plate');
  for (const button of buttons) assert.match(button, /\sdisabled=""/, button);
});
