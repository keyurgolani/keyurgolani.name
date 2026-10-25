import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VIEWPORTS } from '~/lib/preview-frame';
import {
  DeviceWidths,
  INITIAL_VIEW,
  pressView,
  shownPanes,
  SPLIT_VIEWS,
  StudioSplit,
} from './studio-split';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The Appearance view's split (owner direction, 2026-10-25): which pane shows,
// what a press of the switch does, and the markup both Studios lay out in.

test('the split starts on the controls, and shows both panes when wide, one when narrow', () => {
  assert.equal(INITIAL_VIEW, 'controls');
  assert.deepEqual(shownPanes('controls', false), ['controls', 'preview']);
  assert.deepEqual(shownPanes('preview', false), ['controls', 'preview']);
  assert.deepEqual(shownPanes('controls', true), ['controls']);
  assert.deepEqual(shownPanes('preview', true), ['preview']);
});

test('a press of the other pane shows it and moves focus there; a press of the one shown leaves focus', () => {
  assert.deepEqual(pressView('controls', 'preview'), { view: 'preview', moveFocus: true });
  assert.deepEqual(pressView('preview', 'controls'), { view: 'controls', moveFocus: true });
  assert.deepEqual(pressView('preview', 'preview'), { view: 'preview', moveFocus: false });
  assert.deepEqual(pressView('controls', 'controls'), { view: 'controls', moveFocus: false });
  // One press from the start reaches the preview.
  assert.equal(pressView(INITIAL_VIEW, 'preview').view, 'preview');
});

test('the split is the switch, the controls, then the preview pane: its heading, its toolbar, its frame', () => {
  const html = renderToStaticMarkup(
    <StudioSplit
      controlsLabel="Appearance controls"
      previewHeading="Preview"
      controls={<form aria-label="Appearance" />}
    >
      <div className="toolbar" />
      <iframe title="Frame" />
    </StudioSplit>,
  );
  assert.match(html, /^<div class="studio-split" data-view="controls">/);
  // The switch: a named group of two toggle buttons, Controls pressed, each naming its pane.
  assert.match(html, /<div class="studio-split__switch" role="group" aria-label="Show">/);
  const buttons = [
    ...html.matchAll(
      /<button type="button" class="studio-split__show" aria-pressed="(true|false)" aria-controls="([^"]+)">([^<]+)<\/button>/g,
    ),
  ];
  assert.deepEqual(
    buttons.map(([, pressed, , label]) => `${label} ${pressed}`),
    SPLIT_VIEWS.map(({ label }, index) => `${label} ${index === 0}`),
  );
  for (const [, , controls] of buttons) assert.ok(html.includes(`id="${controls}"`), controls);
  // The panes, each focusable for the switch to move focus to, and named.
  assert.match(
    html,
    /<div id="[^"]+" class="studio-split__panel" role="region" aria-label="Appearance controls" tabindex="-1"><form aria-label="Appearance"><\/form><\/div>/,
  );
  const heading = /<h3 id="([^"]+)" class="studio-split__heading">Preview<\/h3>/.exec(html);
  assert.ok(heading, 'the preview heading');
  assert.match(
    html,
    new RegExp(
      `<section id="[^"]+" class="studio-split__preview" aria-labelledby="${heading[1]}" tabindex="-1">`,
    ),
  );
  // Tab order is the markup's: switch, controls, toolbar, frame.
  const order = ['studio-split__switch', 'aria-label="Appearance"', 'class="toolbar"', '<iframe'];
  const at = order.map((each) => html.indexOf(each));
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  assert.ok(at.every((each) => each >= 0));
});

test('the device widths are one button per viewport preset, the one in use pressed', () => {
  const html = renderToStaticMarkup(<DeviceWidths value="tablet" onChange={() => {}} />);
  assert.match(html, /^<div class="studio-split__widths" role="group" aria-label="Device width">/);
  const pressed = [
    ...html.matchAll(/data-viewport="([a-z]+)" aria-pressed="(true|false)">([^<]+)</g),
  ].map(([, id, state, label]) => [id, state, label]);
  assert.deepEqual(pressed, [
    ['desktop', 'false', 'Desktop 1440 by 900'],
    ['tablet', 'true', 'Tablet 1024 by 768'],
    ['mobile', 'false', 'Mobile 390 by 844'],
  ]);
  assert.equal(pressed.length, VIEWPORTS.length);
});
