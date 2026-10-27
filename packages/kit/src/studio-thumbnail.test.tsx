import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Box, Headline, mix, shade, tint } from './studio-thumbnail';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The helpers a variant's Studio thumbnail draws with (`@portfolio/kit/studio-thumbnail`).

test('mix moves one #rrggbb toward another, and leaves anything else as it is', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#102030', '#102030', 0.7), '#102030');
  assert.equal(mix('#f6eddc', '#2b241c', 0), '#f6eddc');
  assert.equal(mix('#f6eddc', '#2b241c', 1), '#2b241c');
  assert.equal(mix('red', '#ffffff', 0.5), 'red');
  assert.equal(mix('#ffffff', 'var(--x)', 0.5), '#ffffff');
});

test('tint and shade are a mix toward white and toward black, to the same rounding', () => {
  for (const color of ['#f6eddc', '#0b1d28', '#59d6cb', '#2b241c']) {
    for (const t of [0, 0.1, 0.2, 0.35, 0.4, 0.55, 0.7, 0.85, 1]) {
      assert.equal(tint(color, t), mix(color, '#ffffff', t), `${color} ${t}`);
      assert.equal(shade(color, t), mix(color, '#000000', t), `${color} ${t}`);
    }
  }
  assert.equal(tint('canvas', 0.5), 'canvas');
  assert.equal(shade('#abc', 0.5), '#abc');
});

test('Box is a rect, rounded only when asked, and Headline a bar at the x-height', () => {
  assert.equal(
    renderToStaticMarkup(<Box x={1} y={2} w={3} h={4} fill="#123456" />),
    '<rect x="1" y="2" width="3" height="4" fill="#123456"></rect>',
  );
  assert.match(
    renderToStaticMarkup(<Box x={1} y={2} w={3} h={4} fill="#123456" rx={1} />),
    / rx="1"/,
  );
  assert.equal(
    renderToStaticMarkup(<Headline x={5} y={26} size={19} fill="#000000" w={126} />),
    '<rect x="5" y="14.22" width="126.00" height="11.78" rx="1.52" fill="#000000"></rect>',
  );
});
