import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortfolio } from './load';
import { isAllowedUrl } from './url';

// Item 12: one rule for every url, src, and *Url field.

test('https, http, mailto, and tel URLs, relative references, and fragments are allowed', () => {
  for (const url of [
    'https://rowan.test',
    'https://rowan.test/work?page=2#top',
    'HTTPS://ROWAN.TEST/',
    'http://127.0.0.1:3000/feed.xml',
    'mailto:rowan@rowan.test',
    'tel:+1-555-0100',
    '/work',
    'work/fixture-garden',
    './notes',
    '../up',
    '?q=1',
    '#contact',
    'résumé.pdf',
  ]) {
    assert.equal(isAllowedUrl(url), true, url);
  }
});

test('every other scheme is refused, however it is spelled', () => {
  for (const url of [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'JavaScript:alert(1)',
    // Browsers drop tabs and newlines, and trim spaces, before they parse.
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
    'javascript:alert(1) ',
    'vbscript:msgbox(1)',
    'data:text/html,<p>hi</p>',
    'file:///etc/hosts',
    'ftp://rowan.test',
    'blob:https://rowan.test/1',
    'about:blank',
  ]) {
    assert.equal(isAllowedUrl(url), false, JSON.stringify(url));
  }
});

test('a network-path reference to another host is refused', () => {
  for (const url of [
    '//evil.test',
    '//evil.test/path',
    '/\\evil.test',
    '\\\\evil.test',
    '\\/evil.test',
  ]) {
    assert.equal(isAllowedUrl(url), false, url);
  }
});

test('a URL with nothing after its scheme is refused', () => {
  for (const url of ['', 'https:', 'https://', 'http:///path', 'mailto:', 'tel:']) {
    assert.equal(isAllowedUrl(url), false, JSON.stringify(url));
  }
});

test('only an image source may be a raster data:image URL', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(isAllowedUrl(png), false);
  for (const type of ['png', 'jpeg', 'gif', 'webp', 'avif']) {
    assert.equal(isAllowedUrl(`data:image/${type};base64,AAAA`, { dataImages: true }), true, type);
  }
  for (const url of [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    'data:text/html;base64,PHA+aGk8L3A+',
    'data:,hello',
  ]) {
    assert.equal(isAllowedUrl(url, { dataImages: true }), false, url);
  }
});

test('the URL rule covers url, src, and *Url fields, located and without quoting the value', () => {
  const document = [
    'schemaVersion: 2',
    'locale: en',
    'direction: ltr',
    'identity:',
    '  name: Rowan Test',
    '  avatar: { src: "data:image/svg+xml;base64,PHN2Zz4=" }',
    'links:',
    '  - url: "JAVASCRIPT:canary()"',
    'sections:',
    '  - kind: experience',
    '    id: work',
    '    items:',
    '      - role: Engineer',
    '        organization: Acme',
    '        organizationUrl: "//canary.test"',
    "        period: { start: '2020' }",
    '  - kind: gallery',
    '    id: plates',
    '    items:',
    '      - image: { src: "data:image/png;base64,AAAA", alt: A plate }',
    '  - kind: contact',
    '    id: contact',
    '    links:',
    '      - url: "data:image/png;base64,AAAA"',
    '',
  ].join('\n');
  const result = parsePortfolio(document, 'yaml');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.problems.map(({ pointer, line, message }) => [
      pointer,
      line,
      message.includes('canary'),
    ]),
    [
      ['/identity/avatar/src', 6, false],
      ['/links/0/url', 8, false],
      ['/sections/0/items/0/organizationUrl', 15, false],
      ['/sections/2/links/0/url', 24, false],
    ],
  );
  assert.equal(
    result.problems[1]?.message,
    '/links/0/url must be an https, http, mailto, or tel URL, a relative path, or a #fragment.',
  );
});
