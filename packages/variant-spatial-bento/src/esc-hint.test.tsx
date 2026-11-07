import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EscHint, escapeHeard, escHint, hearsEscape } from './esc-hint';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The case sheet's Escape hint (RC1 row 92): the server sends none of its
// words, and the client shows them only once CaseFocus's Escape listener is
// attached, never on a plate. It names the control that does the same thing
// without a script, Back to the field, by that link's id.

const BACK = 'p-sb--case-back';

const WORDS = `<p class="sb-case__esc" data-script-only="" data-key-hint-for="${BACK}" data-listening="">Press <kbd>Esc</kbd> to close. The field keeps your place.</p>`;

const markup = (element: React.ReactElement | null) =>
  element === null ? '' : renderToStaticMarkup(element);

const hint = (heard: boolean, plate: boolean, dir?: 'ltr') =>
  markup(escHint({ heard, plate, dir, back: BACK }));

test('before the listener is attached, the hint is nothing', () => {
  assert.equal(hint(false, false), '');
  assert.equal(hint(false, false, 'ltr'), '');
});

test('once the listener is attached, the hint says the exact words, marked, its key in a kbd, naming the way back', () => {
  assert.equal(hint(true, false), WORDS);
  assert.equal(
    hint(true, false, 'ltr'),
    WORDS.replace('data-listening=""', 'data-listening="" dir="ltr"'),
  );
  // It names the control it was given, and holds no link or control of its own.
  assert.match(
    markup(escHint({ heard: true, plate: false, back: 'another-back' })),
    / data-key-hint-for="another-back" /,
  );
  assert.doesNotMatch(WORDS, /<(?:a|button|input|select|textarea|summary)\b|tabindex|role=/);
});

test('on a plate the hint is nothing, listening or not', () => {
  assert.equal(hint(true, true), '');
  assert.equal(hint(false, true, 'ltr'), '');
});

test('the server never renders the hint, even with the listener attached', () => {
  hearsEscape(true);
  try {
    assert.equal(escapeHeard(), true);
    assert.equal(renderToStaticMarkup(<EscHint back={BACK} />), '');
    assert.equal(renderToStaticMarkup(<EscHint back={BACK} dir="ltr" />), '');
  } finally {
    hearsEscape(false);
  }
  assert.equal(escapeHeard(), false);
});
