import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  distinctHostLabels,
  formatLabels,
  formatUrl,
  hostLabel,
  LinkRow,
  type RenderContext,
} from './primitives';

// The words the kit writes for what the owner gave it without words: a
// list of short labels, in the content's language, and a link the owner
// gave no label for, by where it goes. None of it is a word the kit adds.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

/** The least a primitive reads of a render context: its locale and its links' mount. */
function ctx(formatLocale: string, linkSiblings?: readonly string[]): RenderContext {
  return {
    formatLocale,
    linkSiblings,
    input: { ids: { prefix: '' }, basePath: '', query: {}, route: { route: 'home' } },
  } as unknown as RenderContext;
}

test('labels list in the content’s own narrowest form, and no two run together, in any language', () => {
  const items = ['Service mesh', 'Postmortem culture', 'On-call'];
  assert.equal(formatLabels(items, ctx('en')), 'Service mesh, Postmortem culture, On-call');
  assert.equal(
    formatLabels(['历史', '基础设施', '可观测性'], ctx('zh')),
    '历史、基础设施、可观测性',
  );
  assert.equal(formatLabels(['歴史', '基盤', '可観測性'], ctx('ja')), '歴史、基盤、可観測性');
  assert.equal(
    formatLabels(['Сервисная сетка', 'Культура разборов'], ctx('ru')),
    'Сервисная сетка, Культура разборов',
  );
  // Korean joins the last with its own word, never with nothing.
  const korean = formatLabels(['서비스 메시', '장애 회고', '온콜'], ctx('ko'));
  assert.match(korean, /^서비스 메시, 장애 회고(?:,| 및) 온콜$/);
  // Each multi-word label keeps its boundary: a separator after every one but the last.
  for (const [locale, labels] of [
    ['zh', ['历史 研究', '基础 设施']],
    ['ja', ['歴史 研究', '基盤 設計']],
    ['ru', ['история систем', 'культура разборов']],
    ['ko', ['역사 연구', '기반 설계']],
  ] as const) {
    const text = formatLabels(labels, ctx(locale));
    assert.ok(text.startsWith(labels[0]!) && text.endsWith(labels[1]!), text);
    assert.notEqual(text, labels.join(''), locale);
    assert.notEqual(text, labels.join(' '), locale);
  }
});

test('a link shows its address as written: a Unicode host, never punycode, and decoded path parts', () => {
  assert.equal(hostLabel('https://例え.jp/スライド'), '例え.jp');
  assert.equal(hostLabel('https://bücher.de/'), 'bücher.de');
  assert.equal(hostLabel('https://www.Example.com/talks'), 'example.com');
  assert.equal(hostLabel('https://user@slides.example.com:8443/deck'), 'slides.example.com');
  assert.equal(hostLabel('mailto:rowan@rowan.test?subject=Hi'), 'rowan@rowan.test');
  assert.equal(hostLabel('/essays/%E6%97%A5%E8%A8%98'), '/essays/日記');
  assert.equal(
    formatUrl('https://example.com/%E3%82%B9%E3%83%A9%E3%82%A4%E3%83%89/'),
    'example.com/スライド',
  );
  const labels = distinctHostLabels([
    'https://例え.jp/%E3%82%B9%E3%83%A9%E3%82%A4%E3%83%89',
    'https://例え.jp/%E5%8B%95%E7%94%BB',
  ]);
  assert.deepEqual([...labels.values()], ['例え.jp/スライド', '例え.jp/動画']);
  for (const label of labels.values()) assert.doesNotMatch(label, /xn--|%[0-9A-F]{2}/i);
});

test('links that share a host never read the same: each adds the shortest part that tells it apart, and never the whole URL', () => {
  // Alone on its host: the host.
  assert.deepEqual(
    [...distinctHostLabels(['https://example.com/a', 'https://other.test/b']).values()],
    ['example.com', 'other.test'],
  );
  // Siblings on one host: the last part of each path.
  assert.deepEqual(
    [
      ...distinctHostLabels([
        'https://example.com/incident-history/24',
        'https://example.com/incident-history/23',
        'https://example.com/incident-history/22',
      ]).values(),
    ],
    ['example.com/24', 'example.com/23', 'example.com/22'],
  );
  // The same last part: the query too.
  assert.deepEqual(
    [
      ...distinctHostLabels([
        'https://youtube.com/watch?v=a',
        'https://youtube.com/watch?v=b',
      ]).values(),
    ],
    ['youtube.com/watch?v=a', 'youtube.com/watch?v=b'],
  );
  // The same last part and query: the whole path.
  assert.deepEqual(
    [
      ...distinctHostLabels([
        'https://example.com/2024/slides',
        'https://example.com/2025/slides',
      ]).values(),
    ],
    ['example.com/2024/slides', 'example.com/2025/slides'],
  );
  // The same path and query: the fragment, then the port.
  assert.deepEqual(
    [
      ...distinctHostLabels([
        'https://example.com/talk#slides',
        'https://example.com/talk#video',
      ]).values(),
    ],
    ['example.com/talk#slides', 'example.com/talk#video'],
  );
  assert.deepEqual(
    [...distinctHostLabels(['https://example.com:8080/', 'https://example.com:8443/']).values()],
    ['example.com:8080', 'example.com:8443'],
  );
  // The bare root and a root query still read as before.
  assert.deepEqual(
    [...distinctHostLabels(['https://example.com/', 'https://example.com/?x=1']).values()],
    ['example.com', 'example.com/?x=1'],
  );
  // The same address twice goes to one place, so it reads the same.
  assert.equal(distinctHostLabels(['https://example.com/a', 'https://example.com/a']).size, 1);
  for (const label of distinctHostLabels([
    'https://youtube.com/watch?v=a',
    'https://youtube.com/watch?v=b',
  ]).values()) {
    assert.doesNotMatch(label, /^https?:/);
  }
});

const texts = (markup: string) =>
  [...markup.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map(([, text]) => text);

test('a row’s links read apart: field links, unlabelled owner links, and the section’s siblings on the same host', () => {
  // A talk's slides and video on one host, and two unlabelled owner links on another.
  const row = renderToStaticMarkup(
    <LinkRow
      fields={[
        ['slidesUrl', 'https://youtube.com/watch?v=a'],
        ['videoUrl', 'https://youtube.com/watch?v=b'],
      ]}
      links={[
        { url: 'https://notes.rowan.test/one' },
        { url: 'https://notes.rowan.test/two' },
        { url: 'https://notes.rowan.test/three', label: 'Notes' },
      ]}
      ctx={ctx('en')}
    />,
  );
  assert.deepEqual(texts(row), [
    'youtube.com/watch?v=a',
    'youtube.com/watch?v=b',
    'notes.rowan.test/one',
    'notes.rowan.test/two',
    'Notes',
  ]);
  // Three episodes, each one link on the same host, read apart across their section.
  const episodes = [
    'https://example.com/incident-history/24',
    'https://example.com/incident-history/23',
    'https://example.com/incident-history/22',
  ];
  const shown = episodes.map(
    (url) =>
      texts(
        renderToStaticMarkup(<LinkRow fields={[['audioUrl', url]]} ctx={ctx('en', episodes)} />),
      )[0],
  );
  assert.deepEqual(shown, ['example.com/24', 'example.com/23', 'example.com/22']);
  assert.equal(new Set(shown).size, episodes.length);
});
