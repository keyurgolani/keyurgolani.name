import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrouping, pageOutline } from '@portfolio/kit/sections';
import {
  backdropOf,
  bandGrouping,
  bandsOf,
  chronologyLanes,
  controlsOf,
  evidenceForm,
  firstSentence,
  githubView,
  leadOf,
  longDate,
  metricValue,
  openingOf,
  posterLine,
  proofOf,
  proofTiles,
  rangeOf,
  runsOf,
  upToComma,
  workForm,
} from './model';
import { inputFor, pairOf, render, sampleInput } from './__tests__/harness.test';

// The derivations on the fixture shapes the brief names (N4): the sample, one
// artifact, no proof list, no thesis, no chronology, no media, a long name, a
// non-Latin name, and right to left. No sample literal decides anything:
// every rule reads kinds, fields and the owner's controls.

const base = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Kai Bell' },
} as const;

test('the display line runs the N5 chain: the thesis, the hero tagline, the identity tagline, the name', () => {
  const thesis = inputFor(
    pairOf({
      ...base,
      practice: { thesis: 'I mend things slowly. Then I write it down.' },
      sections: [
        { kind: 'hero', id: 'top', tagline: 'Hero words here.' },
        { kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' },
      ],
    }),
  );
  assert.deepEqual(posterLine(thesis), {
    text: 'I mend things slowly.',
    source: 'thesis',
    length: 'short',
  });
  assert.equal(openingOf(thesis).standfirst, 'Then I write it down.');
  assert.equal(openingOf(thesis).lede, 'Hero words here.');
  // No thesis section: the hero's first sentence, and its rest is the lede.
  const hero = inputFor(
    pairOf({ ...base, sections: [{ kind: 'hero', id: 'top', tagline: 'First. Second.' }] }),
  );
  assert.equal(posterLine(hero).source, 'hero');
  assert.equal(openingOf(hero).lede, 'Second.');
  // Neither: the identity tagline, which the meta row then leaves out.
  const tagline = inputFor(
    pairOf({ ...base, identity: { name: 'Kai Bell', tagline: 'Keeps records' } }),
  );
  assert.equal(posterLine(tagline).source, 'tagline');
  assert.equal(openingOf(tagline).meta.tagline, undefined);
  // Nothing at all: the name.
  assert.equal(posterLine(inputFor(pairOf({ ...base }))).source, 'name');
});

test('the thesis is cut once, on its Markdown: the display line and the standfirst meet at the same place', () => {
  // A bold first sentence: the line is its words, the rest starts after the closing mark.
  assert.deepEqual(leadOf('**Small systems, patiently built.** I work on the boring parts.'), {
    lead: 'Small systems, patiently built.',
    rest: 'I work on the boring parts.',
  });
  // A sentence that ends inside a link's text, at its close: the link stays whole in the line.
  assert.deepEqual(leadOf('I wrote [a book on queues.](https://example.com/q) It *sold*.'), {
    lead: 'I wrote a book on queues.',
    rest: 'It *sold*.',
  });
  // A stop in the middle of a link's text doesn't end the sentence.
  assert.deepEqual(leadOf('See [the guide. It helps](https://example.com/g) today. More.'), {
    lead: 'See the guide. It helps today.',
    rest: 'More.',
  });
  // The rest keeps its marks and its paragraphs.
  assert.deepEqual(leadOf('One line.\n\nA **second** paragraph.'), {
    lead: 'One line.',
    rest: 'A **second** paragraph.',
  });
  assert.deepEqual(leadOf('一つ目。二つ目。'), { lead: '一つ目。', rest: '二つ目。' });
  assert.deepEqual(leadOf('No stop at all'), { lead: 'No stop at all' });
  // Nested marks inside a bold sentence.
  assert.deepEqual(leadOf('**Small *systems*, built.** Then more.'), {
    lead: 'Small systems, built.',
    rest: 'Then more.',
  });
  // Right to left: an Arabic sentence and its question mark.
  assert.deepEqual(leadOf('أبني أنظمة صغيرة. ثم أكتب عنها؟ نعم.'), {
    lead: 'أبني أنظمة صغيرة.',
    rest: 'ثم أكتب عنها؟ نعم.',
  });
  // Bold-italic: the triple mark closes the sentence.
  assert.deepEqual(leadOf('***Small systems, patiently built.*** I work on the boring parts.'), {
    lead: 'Small systems, patiently built.',
    rest: 'I work on the boring parts.',
  });
  // `_` inside a word is a letter, not a mark (CommonMark's intraword rule).
  assert.deepEqual(leadOf('I maintain snake_case tools. Also my_lib, daily.'), {
    lead: 'I maintain snake_case tools.',
    rest: 'Also my_lib, daily.',
  });
  assert.deepEqual(leadOf('I keep _quiet_ tools. More.'), {
    lead: 'I keep quiet tools.',
    rest: 'More.',
  });
  // A lone `*` before a space opens nothing, and no mark spans a line break.
  assert.deepEqual(leadOf('I use * for globs.\n\nAnd * again. Final.'), {
    lead: 'I use * for globs.',
    rest: 'And * again. Final.',
  });
  assert.deepEqual(leadOf('Some *open mark.\n\nIts close* later.'), {
    lead: 'Some *open mark.',
    rest: 'Its close* later.',
  });
  // A stop inside code never ends a sentence.
  assert.deepEqual(leadOf('I love the `...` operator. It spreads.'), {
    lead: 'I love the ... operator.',
    rest: 'It spreads.',
  });
  assert.deepEqual(leadOf('Run `make test.` then rest. Done.'), {
    lead: 'Run make test. then rest.',
    rest: 'Done.',
  });
  // Through the opening: the line and the standfirst add up to the thesis, nothing doubled or lost.
  const input = inputFor(
    pairOf({
      ...base,
      practice: { thesis: '**Small systems, patiently built.** I work on the boring parts.' },
      sections: [{ kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' }],
    }),
  );
  assert.equal(posterLine(input).text, 'Small systems, patiently built.');
  assert.equal(openingOf(input).standfirst, 'I work on the boring parts.');
  const linked = inputFor(
    pairOf({
      ...base,
      practice: { thesis: 'I wrote [a book on queues.](https://example.com/q) It sold.' },
      sections: [{ kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' }],
    }),
  );
  assert.equal(posterLine(linked).text, 'I wrote a book on queues.');
  assert.equal(openingOf(linked).standfirst, 'It sold.');
});

test('a long name and a long thesis take smaller steps, never overflow classes of their own', () => {
  const input = inputFor(
    pairOf({
      ...base,
      identity: { name: 'Maximiliana Oyelaran-Featherstonehaugh de la Cruz' },
      practice: {
        thesis:
          'I build the slow, careful, well-documented infrastructure that other teams quietly depend on every day.',
      },
      sections: [{ kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' }],
    }),
  );
  assert.equal(posterLine(input).length, 'long');
  const html = render(
    pairOf({
      ...base,
      identity: { name: 'Maximiliana Oyelaran-Featherstonehaugh de la Cruz' },
      sections: undefined,
    }),
  );
  assert.match(html, /data-length="medium"/);
});

test('a non-Latin name and a right-to-left page keep their own words, and the composition marks its own', () => {
  const html = render(
    pairOf({
      schemaVersion: 3,
      locale: 'ar',
      direction: 'rtl',
      identity: { name: 'ليلى حداد', tagline: 'مهندسة أنظمة' },
      practice: { thesis: 'أجعل الأعطال مقروءة. ثم أكتب عنها.' },
      sections: [
        { kind: 'hero', id: 'top', greeting: 'مرحبا، أنا' },
        { kind: 'practice', id: 'thesis', title: 'الممارسة', part: 'thesis' },
        { kind: 'lede', id: 'about', title: 'عني', body: 'نص.' },
      ],
    }),
  );
  assert.match(html, /ليلى حداد/);
  assert.match(html, /أجعل الأعطال مقروءة\./);
  assert.match(html, /<span lang="en">Index<\/span>/);
});

test('stat tiles: the proof strip, at most three, and the band closes without one', () => {
  const sample = sampleInput();
  const tiles = proofTiles(sample);
  assert.ok(tiles.length >= 1 && tiles.length <= 3);
  for (const tile of tiles) {
    assert.ok(tile.value.length > 0 && tile.label.length > 0);
    assert.doesNotMatch(tile.label, /,/);
  }
  const none = inputFor(pairOf({ ...base }));
  assert.deepEqual(proofTiles(none), []);
  assert.deepEqual(proofOf(none), { proof: [] });
  // An award tile: its year and title.
  const award = inputFor(
    pairOf({
      ...base,
      evidence: [{ id: 'prize', type: 'award', title: 'A Prize', receivedAt: '2024-05' }],
      proof: ['prize'],
      sections: [{ kind: 'evidence', id: 'awards', title: 'Awards', items: ['prize'] }],
    }),
  );
  assert.deepEqual(proofTiles(award), [
    { id: 'prize', value: '2024', label: 'A Prize', year: true },
  ]);
});

test('a metric folds its unit into the value unless its label opens with it', () => {
  const locale = 'en';
  const entry = (unit: string) =>
    ({ id: 'm', type: 'metric', metric: { value: 12, unit } }) as Parameters<typeof metricValue>[0];
  assert.equal(metricValue(entry('years'), 'Years engineering', locale), '12');
  assert.equal(metricValue(entry('%'), 'Fewer pages', locale), '12%');
  assert.equal(metricValue(entry('km'), 'Ridden', locale), '12 km');
  assert.equal(
    upToComma('Years engineering, from research code to production'),
    'Years engineering',
  );
});

test('the backdrop is the first landscape photograph of the first photography section, and field turns it off', () => {
  const sample = sampleInput();
  const found = backdropOf(sample);
  if (found) {
    assert.ok(found.width >= 1.3 * found.height);
    assert.equal(found.work.medium === 'image-series' || found.work.medium === 'photography', true);
  }
  const field = { ...sample, controls: { ...sample.controls, backdrop: 'field' } };
  assert.equal(backdropOf(field), undefined);
  // No media at all: the scheme's colours alone.
  assert.equal(backdropOf(inputFor(pairOf({ ...base }))), undefined);
});

test('GitHub: featured repositories show whether pinned or not, and showPinnedRepos: false keeps them', () => {
  const input = sampleInput();
  const section = input.portfolio.sections.find((entry) => entry.kind === 'github')!;
  assert.equal(section.kind, 'github');
  if (section.kind !== 'github') return;
  const shown = githubView(section, input)!;
  assert.ok(shown.repos.length > 0);
  assert.ok(shown.repos.every((repo) => repo.url?.startsWith('https:')));
  assert.ok(shown.profileUrl.startsWith('https:'));
  // A featured repository first, even with the pinned ones off.
  // The sample's snapshot has `essays` recently active but not pinned.
  const name = 'essays';
  assert.ok(!shown.repos.some((repo) => repo.name === name));
  const featuredOnly = githubView(
    { ...section, showPinnedRepos: false, featuredRepos: [name] },
    input,
  )!;
  assert.deepEqual(
    featuredOnly.repos.map((repo) => repo.name),
    [name],
  );
  const first = githubView({ ...section, featuredRepos: [name] }, input)!;
  assert.equal(first.repos[0]!.name, name);
  assert.equal(new Set(first.repos.map((repo) => repo.name)).size, first.repos.length);
  // Excluded wins over featured.
  const excluded = githubView(
    { ...section, showPinnedRepos: false, featuredRepos: [name], excludeRepos: [name] },
    input,
  )!;
  assert.deepEqual(excluded.repos, []);
  // A repository whose address isn't https is listed as text, as the kit does, not dropped.
  const snapshot = structuredClone(input.derived[section.id]!);
  assert.equal(snapshot.state, 'ready');
  if (snapshot.state !== 'ready') return;
  const plain = snapshot.value.pinnedRepos[0]!;
  (plain as { url: string }).url = 'http://example.com/repo';
  const unsafe = githubView(section, {
    ...input,
    derived: { ...input.derived, [section.id]: snapshot },
  })!;
  const listed = unsafe.repos.find((repo) => repo.name === plain.name);
  assert.ok(listed, 'still listed');
  assert.equal(listed.url, undefined);
});

test('controls take their defaults when unset or invalid', () => {
  assert.deepEqual(controlsOf({ controls: {} }), {
    backdrop: 'auto',
    backdropMedia: null,
    drift: true,
    lens: true,
    proof: 'auto',
  });
  assert.deepEqual(controlsOf({ controls: { backdrop: 'nope', drift: 'yes', proof: 'off' } }), {
    backdrop: 'auto',
    backdropMedia: null,
    drift: true,
    lens: true,
    proof: 'off',
  });
});

test('bands follow the canonical destinations; custom sections go in the unlabelled band before Contact', () => {
  const input = inputFor(
    pairOf({
      ...base,
      sections: [
        { kind: 'hero', id: 'top', tagline: 'Hi.' },
        { kind: 'custom', id: 'notes', title: 'Notes', body: 'A note.' },
        { kind: 'lede', id: 'about', title: 'About', body: 'Me.' },
        { kind: 'contact', id: 'contact', title: 'Write to me' },
      ],
      contact: { message: 'Email works.' },
    }),
  );
  const bands = bandsOf(input, pageOutline(input));
  assert.deepEqual(
    bands.map((band) => [band.id, band.word]),
    [
      ['about', 'About'],
      ['more', undefined],
      ['contact', 'Write to me'],
    ],
  );
  // One artifact only: a single works section still makes its band.
  const one = inputFor(
    pairOf({
      ...base,
      works: [{ id: 'w', title: 'One thing', medium: 'software' }],
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['w'] }],
    }),
  );
  assert.deepEqual(
    bandsOf(one, pageOutline(one)).map((band) => band.id),
    ['work'],
  );
  // The grouping declares no mistake: on the sample, the mixed page, and one artifact (K-1).
  for (const each of [sampleInput(), input, one]) {
    assert.deepEqual(checkGrouping({ grouping: bandGrouping(each) }, [pageOutline(each)]), []);
  }
});

test('the forms by medium and by type', () => {
  const medium = (m: string) => workForm({ medium: m } as Parameters<typeof workForm>[0]);
  assert.equal(medium('software'), 'sheet');
  assert.equal(medium('writing'), 'essay');
  assert.equal(medium('audio-video'), 'episode');
  assert.equal(medium('photography'), 'looking');
  assert.equal(medium('music'), 'sleeve');
  const type = (t: string, metric?: object) =>
    evidenceForm({ type: t, metric } as Parameters<typeof evidenceForm>[0]);
  assert.equal(type('metric', { value: 1 }), 'lites');
  assert.equal(type('metric', { key: 'x' }), 'rows');
  assert.equal(type('testimonial'), 'cascade');
  assert.equal(type('publication'), 'rows');
  assert.equal(type('external-work'), 'portals');
  assert.deepEqual(
    runsOf([1, 1, 2, 1], (n) => String(n)).map((run) => [run.form, run.items.length]),
    [
      ['1', 2],
      ['2', 1],
      ['1', 1],
    ],
  );
});

test('chronology lanes: by thread in order of first appearance, forks only to shown entries', () => {
  type Entry = Parameters<typeof chronologyLanes>[0][number];
  const entry = (id: string, kind: string, more: Partial<Entry> = {}) =>
    ({ id, kind, title: id, period: { start: '2020' }, ...more }) as Entry;
  const lanes = chronologyLanes([
    entry('a', 'role', { thread: 'job' }),
    entry('b', 'study'),
    entry('c', 'role', { thread: 'job', branchesFrom: 'b', mergesInto: 'gone' }),
  ]);
  assert.deepEqual(
    lanes.map((each) => [each.entry.id, each.lane, each.branchesFrom, each.mergesInto]),
    [
      ['a', 0, undefined, undefined],
      ['b', 1, undefined, undefined],
      ['c', 0, 'b', undefined],
    ],
  );
  // No chronology: no lanes.
  assert.deepEqual(chronologyLanes([]), []);
});

test('dates and ranges in words, with an en dash', () => {
  assert.deepEqual(longDate('2022-01'), { text: 'January 2022', iso: '2022-01' });
  assert.deepEqual(longDate('2026-02-08'), { text: '8 February 2026', iso: '2026-02-08' });
  assert.equal(longDate(undefined), undefined);
  assert.deepEqual(rangeOf({ start: '2018', end: '2023' }), { text: '2018–2023', open: false });
  assert.deepEqual(rangeOf({ start: '2023-04' }), { text: '2023–now', open: true });
  assert.deepEqual(firstSentence('One. Two three.'), { lead: 'One.', rest: 'Two three.' });
});
