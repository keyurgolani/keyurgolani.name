import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKER_ATTRIBUTE,
  MARKER_HEADER,
  MARKER_ID,
  markerProblems,
  standInMarkers,
} from './markers';

const marked = (url: string, status = 200) => ({
  url,
  status,
  headers: { [MARKER_HEADER]: MARKER_ID },
});

test('every response with the header and a document with the attribute pass', () => {
  assert.deepEqual(markerProblems([marked('/'), marked('/_next/static/a.js')], MARKER_ID), []);
});

test('a response without the header fails, and so does one with another id', () => {
  assert.deepEqual(
    markerProblems(
      [
        marked('/'),
        { url: '/a.css', status: 200, headers: {} },
        { ...marked('/b.js'), headers: { [MARKER_HEADER]: 'meta' } },
      ],
      MARKER_ID,
    ),
    [
      `200 /a.css has no ${MARKER_HEADER} header`,
      `200 /b.js has ${MARKER_HEADER}: meta, not ${MARKER_ID}`,
    ],
  );
});

test('a 404 is held to it too', () => {
  assert.deepEqual(markerProblems([{ url: '/nope', status: 404, headers: {} }], MARKER_ID), [
    `404 /nope has no ${MARKER_HEADER} header`,
  ]);
});

test('a document without the attribute fails, and so does no response at all', () => {
  assert.deepEqual(markerProblems([marked('/')], null), [`<html> has no ${MARKER_ATTRIBUTE}`]);
  assert.deepEqual(markerProblems([], MARKER_ID), ['no response from the app was seen']);
});

test("the stand-in marks a document's <html> and every response's headers, and drops what the body no longer fits", () => {
  const page = standInMarkers(
    {
      'content-type': 'text/html; charset=utf-8',
      'content-length': '40',
      'content-encoding': 'br',
    },
    Buffer.from('<!DOCTYPE html><html lang="en"><body></body></html>'),
  );
  assert.deepEqual(page.headers, {
    'content-type': 'text/html; charset=utf-8',
    [MARKER_HEADER]: MARKER_ID,
  });
  assert.equal(
    page.body.toString(),
    `<!DOCTYPE html><html ${MARKER_ATTRIBUTE}="${MARKER_ID}" lang="en"><body></body></html>`,
  );
  const script = standInMarkers({ 'content-type': 'application/javascript' }, Buffer.from('<html'));
  assert.equal(script.body.toString(), '<html', 'only a document is rewritten');
  assert.equal(script.headers[MARKER_HEADER], MARKER_ID);
});
