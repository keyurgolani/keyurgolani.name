import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import type { ChronologyEntry, Evidence, Section, Work } from '@portfolio/schema';
import { navigationModel, pageOutline } from '@portfolio/kit/sections';
import {
  albumSeconds,
  bibtexOf,
  chronologyLanes,
  clockOf,
  commandFor,
  controlsOf,
  cwdOf,
  dateOf,
  evidenceForm,
  firstSentence,
  laneColour,
  listingOf,
  majorityType,
  manSectionOf,
  promptOf,
  proofLines,
  signatureOf,
  slugOf,
  stableDigest,
  thesisOf,
  transcriptOf,
  worksForm,
  type GraphRow,
  type ModelInput,
} from './model';

// Shell's derivations over the repository's sample and the N4 fixtures: no
// github, no location, no chronology, one artifact, a long name, a
// non-Latin name, and right to left. Every fixture below is invented for
// the test; the sample is portfolio.example.yml.

const MANIFEST = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

type Raw = Record<string, unknown> & { sections?: unknown[] };

/** A render input's model fields from a raw portfolio: every list present, as the view gives it. */
function inputOf(raw: Raw, controls: ModelInput['controls'] = {}): ModelInput {
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    links: [],
    featured: [],
    proof: [],
    archive: [],
    works: [],
    evidence: [],
    chronology: [],
    sections: [],
    ...raw,
  };
  return { portfolio, controls } as unknown as ModelInput;
}

/** The home page's outline, for a model input: at the site root, no id prefix. */
const outlineOf = (input: ModelInput) =>
  pageOutline({
    ...input,
    route: { route: 'home' },
    basePath: '',
    ids: { prefix: '' },
    media: {},
    derived: {},
    capabilities: { renderedKinds: MANIFEST.renderedKinds, unsupportedKinds: [], views: [] },
  } as unknown as Parameters<typeof pageOutline>[0]);

const ROOT = new URL('../../../', import.meta.url);
const SAMPLE = inputOf(
  YAML.parse(readFileSync(new URL('portfolio.example.yml', ROOT), 'utf8')) as Raw,
);
const line = (command: { verb: string; args?: string }) =>
  command.args ? `${command.verb} ${command.args}` : command.verb;

// ───────────── the prompt ─────────────

test('the prompt: the GitHub handle at the location, else the section username, else the first name', () => {
  assert.deepEqual(promptOf(SAMPLE), { user: 'anamika', host: 'bengaluru' });
  const noLink = inputOf({
    identity: { name: 'Rowan Vale', location: 'Lisbon, Portugal' },
    sections: [{ kind: 'github', id: 'code', username: 'Rowan-V' }],
  });
  assert.deepEqual(promptOf(noLink), { user: 'rowan-v', host: 'lisbon' });
  const noGithub = inputOf({ identity: { name: 'Zoë Ångström', location: 'Malmö' } });
  assert.deepEqual(promptOf(noGithub), { user: 'zoe', host: 'malmo' });
});

test('the prompt: no location drops the host, and a name with nothing Latin drops the user', () => {
  assert.deepEqual(promptOf(inputOf({ identity: { name: 'Rowan Vale' } })), { user: 'rowan' });
  assert.deepEqual(promptOf(inputOf({ identity: { name: 'ليلى حداد', location: 'عمّان' } })), {});
  // A host never shows without a user to put it after.
  assert.deepEqual(promptOf(inputOf({ identity: { name: '王芳', location: 'Lisbon' } })), {});
});

// ───────────── the thesis ─────────────

test('the thesis leads: its first sentence, else the hero tagline, else the identity tagline, else the name', () => {
  const thesis = thesisOf(SAMPLE);
  assert.equal(thesis.source, 'thesis');
  assert.equal(thesis.text, firstSentence(SAMPLE.portfolio.practice!.thesis!).lead);
  assert.doesNotMatch(thesis.text, /\*|_|\[/);
  const hero = inputOf({
    identity: { name: 'Rowan Vale', tagline: 'Tagline' },
    sections: [{ kind: 'hero', id: 'top', tagline: 'Maker of quiet tools' }],
  });
  assert.deepEqual(thesisOf(hero), { text: 'Maker of quiet tools', source: 'hero' });
  assert.deepEqual(thesisOf(inputOf({ identity: { name: 'Rowan', tagline: 'Tools.' } })), {
    text: 'Tools.',
    source: 'tagline',
  });
  assert.deepEqual(thesisOf(inputOf({ identity: { name: '  Rowan  Vale ' } })), {
    text: 'Rowan Vale',
    source: 'name',
  });
  // A thesis no section shows doesn't lead.
  const hidden = inputOf({
    identity: { name: 'R', tagline: 'T' },
    practice: { thesis: 'Hidden.' },
  });
  assert.equal(thesisOf(hidden).source, 'tagline');
});

test('a sentence ends at a Latin, Arabic or CJK stop, and a text without one is one sentence', () => {
  assert.deepEqual(firstSentence('One. Two.'), { lead: 'One.', rest: 'Two.' });
  assert.deepEqual(firstSentence('أبني أدوات؟ نعم.'), { lead: 'أبني أدوات؟', rest: 'نعم.' });
  assert.deepEqual(firstSentence('我做工具。很小。'), { lead: '我做工具。', rest: '很小。' });
  assert.deepEqual(firstSentence('No stop here'), { lead: 'No stop here' });
});

// ───────────── the hash ─────────────

test('the hash is 7 hex digits of FNV-1a 32 over the id, stable and different per id', () => {
  // FNV-1a 32 of "a" is e40c292c.
  assert.equal(stableDigest('a'), 'e40c292');
  assert.equal(stableDigest(''), '811c9dc');
  assert.match(stableDigest('senior-engineer-mosaic-search'), /^[0-9a-f]{7}$/);
  assert.equal(stableDigest('x-y'), stableDigest('x-y'));
  const ids = SAMPLE.portfolio.chronology.map(({ id }) => stableDigest(id));
  assert.equal(new Set(ids).size, ids.length);
});

// ───────────── the transcript ─────────────

test('the sample transcript runs by directory: ~ first, then work, writing, record, about, contact', () => {
  const outline = outlineOf(SAMPLE);
  const entries = transcriptOf(SAMPLE.portfolio.sections, outline);
  const order = ['~', '~/work', '~/writing', '~/record', '~/about', '~/contact'];
  const seen = [...new Set(entries.map(({ cwd }) => cwd))];
  assert.deepEqual(
    seen,
    order.filter((cwd) => seen.includes(cwd)),
  );
  assert.equal(entries[0]!.section.kind, 'hero');
  assert.equal(entries[0]!.gap, 0);
  // Two rows at each directory change, one inside a directory.
  entries.slice(1).forEach((entry, i) => {
    assert.equal(entry.gap, entry.cwd === entries[i]!.cwd ? 1 : 2, entry.section.id);
  });
  // Every section that renders is in it once.
  assert.equal(entries.length, SAMPLE.portfolio.sections.length);
  assert.equal(new Set(entries.map(({ section }) => section.id)).size, entries.length);
});

test('inside a directory the owner order holds, and a custom section sits at ~ before Contact', () => {
  const input = inputOf({
    identity: { name: 'Rowan', email: 'r@vale.test' },
    works: [{ id: 'w', title: 'W', medium: 'software' }],
    sections: [
      { kind: 'contact', id: 'reach', title: 'Write' },
      { kind: 'custom', id: 'odd', title: 'Odd' },
      { kind: 'quote', id: 'q2', text: 'B' },
      { kind: 'works', id: 'made', title: 'Made', items: ['w'] },
      { kind: 'quote', id: 'q1', text: 'A' },
    ],
    contact: { message: 'Hi' },
  });
  const entries = transcriptOf(input.portfolio.sections, outlineOf(input));
  assert.deepEqual(
    entries.map(({ section, cwd }) => `${section.id}@${cwd}`),
    ['made@~/work', 'q2@~/about', 'q1@~/about', 'odd@~', 'reach@~/contact'],
  );
});

test('a directory is the destination label as a path, ~ for the index alone', () => {
  assert.equal(cwdOf(null), '~');
  assert.equal(cwdOf('record'), '~/record');
  const model = navigationModel(outlineOf(SAMPLE), { ownLabels: { work: 'Selected Work' } });
  assert.equal(cwdOf('work', model), '~/selected-work');
});

// ───────────── commands ─────────────

test('the sample: every section prints with the command its kind, part or majority type names', () => {
  const commands = Object.fromEntries(
    SAMPLE.portfolio.sections.map((entry) => [entry.id, line(commandFor(entry, SAMPLE))]),
  );
  assert.equal(commands[SAMPLE.portfolio.sections.find((s) => s.kind === 'hero')!.id], 'whoami');
  for (const entry of SAMPLE.portfolio.sections) {
    const command = commands[entry.id]!;
    switch (entry.kind) {
      case 'practice':
        assert.equal(
          command,
          {
            thesis: 'cat README.md',
            skills: `ls ${entry.id}/`,
            tools: `tree ${entry.id}/`,
            services: `man ${entry.id}`,
          }[entry.part],
        );
        break;
      case 'chronology':
        assert.equal(command, `git log --graph ${entry.id}`);
        break;
      case 'github':
        assert.equal(command, `gh repo list ${entry.username}`);
        break;
      case 'contact':
        assert.equal(command, `mail ${SAMPLE.portfolio.identity.email}`);
        break;
      case 'now':
        assert.equal(command, 'finger anamika');
        break;
      default:
    }
  }
});

test('commands by kind, on invented sections, with each fallback', () => {
  const input = inputOf({
    identity: { name: '王芳' },
    works: [
      { id: 'e1', title: 'E', medium: 'writing' },
      { id: 'e2', title: 'R', medium: 'research' },
      { id: 'p1', title: 'P', medium: 'photography' },
      { id: 's1', title: 'S', medium: 'software' },
    ],
    evidence: [
      { id: 'm1', type: 'metric', metric: { value: 1 } },
      { id: 'b1', type: 'publication', title: 'B' },
      { id: 't1', type: 'testimonial', statement: 'T', source: { name: 'N' } },
      { id: 'x1', type: 'patent', title: 'X' },
      { id: 'a1', type: 'award', title: 'A' },
      { id: 'c1', type: 'client', title: 'C' },
    ],
  });
  const of = (raw: unknown) => line(commandFor(raw as Section, input));
  assert.equal(of({ kind: 'works', id: 'essays', items: ['e1', 'e2'] }), 'ls -lt essays/');
  assert.equal(of({ kind: 'works', id: 'pics', items: ['p1'] }), 'open pics/');
  assert.equal(of({ kind: 'works', id: 'mixed', items: ['e1', 's1'] }), 'ls -l mixed/');
  assert.equal(of({ kind: 'evidence', id: 'n', items: ['m1'] }), 'cat n.txt');
  assert.equal(of({ kind: 'evidence', id: 'p', items: ['b1'] }), 'cat p.bib');
  assert.equal(of({ kind: 'evidence', id: 'w', items: ['t1'] }), 'mail -f w');
  assert.equal(of({ kind: 'evidence', id: 'x', items: ['x1'] }), 'cat x/*');
  assert.equal(of({ kind: 'evidence', id: 'a', items: ['a1'] }), 'ls -l a/');
  assert.equal(of({ kind: 'evidence', id: 'c', items: ['c1'] }), 'ls -l c/');
  // A tie goes to the type that reaches the count first.
  assert.equal(of({ kind: 'evidence', id: 'tie', items: ['b1', 'm1'] }), 'cat tie.bib');
  assert.equal(of({ kind: 'lede', id: 'intro', body: 'x' }), 'cat intro.md');
  assert.equal(of({ kind: 'focus', id: 'f', items: ['a'] }), 'jobs');
  assert.equal(of({ kind: 'fun-facts', id: 'facts', items: ['a'] }), 'cat facts.txt');
  assert.equal(of({ kind: 'quote', id: 'q', text: 'x' }), 'cat /etc/motd');
  assert.equal(of({ kind: 'cta', id: 'hire' }), './hire');
  assert.equal(of({ kind: 'custom', id: 'odd', title: 'Odd' }), 'cat odd');
  assert.equal(of({ kind: 'acme/thing', id: 'ext', data: {} }), 'cat ext');
  // No user derives from a name with nothing Latin, and no email means cat.
  assert.equal(of({ kind: 'now', id: 'now', body: 'x' }), 'finger');
  assert.equal(of({ kind: 'contact', id: 'reach' }), 'cat reach');
});

test('majority type and forms', () => {
  const e = (type: string) => ({ id: type, type }) as unknown as Evidence;
  assert.equal(majorityType([]), undefined);
  assert.equal(majorityType([e('talk'), e('award'), e('award')]), 'award');
  assert.equal(evidenceForm([e('press'), e('talk')]), 'mail');
  const w = (medium: string) => ({ id: medium, title: medium, medium }) as Work;
  assert.equal(worksForm([]), 'ls-long');
  assert.equal(worksForm([w('image-series'), w('photography')]), 'open');
});

// ───────────── listings ─────────────

test('listings: d for a work with its own page, the signature starred, featured with a cover hollow, archived dimmed', () => {
  const input = inputOf({
    identity: { name: 'R' },
    signature: 'kiln',
    featured: ['loom', 'bare'],
    archive: ['old'],
    works: [
      {
        id: 'kiln',
        title: 'Kiln',
        medium: 'software',
        slug: 'kiln',
        caseStudy: { challenge: 'x' },
        period: { start: '2022-01' },
        highlights: ['40 studios'],
      },
      { id: 'loom', title: 'Loom', medium: 'software', cover: { asset: 'a' }, publishedAt: '2021' },
      { id: 'bare', title: 'Bare', medium: 'software', releasedAt: '2020-02' },
      { id: 'old', title: 'Old', medium: 'software' },
    ],
  });
  const rows = listingOf(input.portfolio.works, input);
  assert.deepEqual(
    rows.map(({ flag, date, mark, archived, highlights }) => [
      flag,
      date,
      mark,
      archived,
      highlights,
    ]),
    [
      ['d', '2022-01', 'signature', false, ['40 studios']],
      ['-', '2021', 'featured', false, []],
      ['-', '2020-02', undefined, false, []],
      ['-', undefined, undefined, true, []],
    ],
  );
  // The owner's pinned work takes the signature's place; an unknown pin is ignored.
  assert.equal(
    signatureOf(
      inputOf({ ...input.portfolio, works: input.portfolio.works } as never, { pinned: 'loom' }),
    ),
    'loom',
  );
  assert.equal(signatureOf(inputOf(input.portfolio as never, { pinned: 'nope' })), 'kiln');
});

test('a listing date is the period start, else published, else released, else none', () => {
  const w = (fields: object) => ({ id: 'x', title: 'X', medium: 'writing', ...fields }) as Work;
  assert.equal(dateOf(w({ period: { start: '2019' }, publishedAt: '2020' })), '2019');
  assert.equal(dateOf(w({ publishedAt: '2020-03-04' })), '2020-03-04');
  assert.equal(dateOf(w({ releasedAt: '2018' })), '2018');
  assert.equal(dateOf(w({})), undefined);
});

test("an album's length sums its timed tracks", () => {
  const w = (tracks: unknown) => ({ id: 'a', title: 'A', medium: 'music', tracks }) as Work;
  assert.equal(
    albumSeconds(
      w([
        { title: 'a', durationSeconds: 61 },
        { title: 'b' },
        { title: 'c', durationSeconds: 120 },
      ]),
    ),
    181,
  );
  assert.equal(albumSeconds(w([{ title: 'a' }])), undefined);
  assert.equal(clockOf(181), '3:01');
  assert.equal(clockOf(3725), '1:02:05');
});

// ───────────── proof ─────────────

test('proof in whoami: a metric by value, unit and the key words the unit leaves out; an award by title and year', () => {
  const input = inputOf({
    identity: { name: 'R' },
    proof: ['tenure', 'owned', 'prize', 'gone'],
    evidence: [
      { id: 'tenure', type: 'metric', metric: { key: 'tenure-years', value: 12, unit: 'years' } },
      { id: 'owned', type: 'metric', metric: { key: 'services-owned', value: 38 } },
      { id: 'prize', type: 'award', title: 'Practitioner Award', receivedAt: '2025-05' },
    ],
  });
  assert.deepEqual(proofLines(input), [
    { id: 'tenure', figure: '12 years', words: 'tenure' },
    { id: 'owned', figure: '38', words: 'services owned' },
    { id: 'prize', words: 'Practitioner Award', year: '2025' },
  ]);
  assert.deepEqual(proofLines(inputOf({ identity: { name: 'R' } })), []);
});

// ───────────── git lanes ─────────────

const entry = (id: string, start: string, fields: Partial<ChronologyEntry> = {}) =>
  ({ id, kind: 'role', title: id, period: { start }, ...fields }) as ChronologyEntry;
const glyphs = (rows: readonly GraphRow[]) =>
  rows.map((row) =>
    row.cells
      .map(({ glyph }) => glyph)
      .join('')
      .trimEnd(),
  );

test('git lanes: one lane per thread, newest first, open periods from the top', () => {
  const lanes = chronologyLanes([
    entry('lead', '2023-04', { thread: 'work' }),
    entry('mid', '2018-08', { thread: 'work', period: { start: '2018-08', end: '2023-03' } }),
    entry('ms', '2014', { thread: 'study', period: { start: '2014', end: '2016' } }),
    entry('bt', '2010', { thread: 'study', period: { start: '2010', end: '2014' } }),
  ]);
  assert.deepEqual(lanes.lanes, ['work', 'study']);
  assert.deepEqual(
    lanes.rows.map((row) => (row.kind === 'entry' ? row.entry.id : row.kind)),
    ['lead', 'mid', 'ms', 'bt'],
  );
  // Work ends before study starts, so study reuses its column.
  assert.equal(lanes.width, 1);
  assert.deepEqual(glyphs(lanes.rows), ['*', '*', '*', '*']);
});

test('git lanes: a branch draws |/ into its parent below its oldest row, in its own colour', () => {
  const lanes = chronologyLanes([
    entry('lead', '2023-04', { thread: 'work' }),
    entry('side', '2023-09', { thread: 'creative', branchesFrom: 'lead' }),
    entry('mid', '2018-08', { thread: 'work', period: { start: '2018-08', end: '2023-03' } }),
  ]);
  assert.deepEqual(
    lanes.rows.map((row) => (row.kind === 'entry' ? row.entry.id : row.kind)),
    ['side', 'fork', 'lead', 'mid'],
  );
  assert.deepEqual(glyphs(lanes.rows), ['|*', '|/', '*', '*']);
  const fork = lanes.rows[1]!;
  assert.equal(fork.cells[1]!.lane, 1);
  assert.equal(laneColour(0), 1);
  assert.equal(laneColour(1), 2);
  assert.equal(laneColour(2), 4);
  assert.equal(laneColour(3), 5);
  assert.equal(laneColour(4), 1);
});

test('git lanes: a merge draws |\\ below the entry it merges into, and a reference outside the list draws nothing', () => {
  const lanes = chronologyLanes([
    entry('main', '2024', { thread: 'work' }),
    entry('feature', '2022', {
      thread: 'side',
      mergesInto: 'main',
      period: { start: '2022', end: '2023' },
    }),
    entry('base', '2020', {
      thread: 'work',
      period: { start: '2020', end: '2021' },
      branchesFrom: 'elsewhere',
    }),
  ]);
  assert.deepEqual(
    lanes.rows.map((row) => (row.kind === 'entry' ? row.entry.id : row.kind)),
    ['main', 'merge', 'feature', 'base'],
  );
  assert.deepEqual(glyphs(lanes.rows), ['*', '|\\', '|*', '*']);
});

test('git lanes: entries without a thread share one lane, and none at all is an empty graph', () => {
  const lanes = chronologyLanes([entry('a', '2020'), entry('b', '2021')]);
  assert.deepEqual(lanes.lanes, [undefined]);
  assert.deepEqual(glyphs(lanes.rows), ['*', '*']);
  assert.deepEqual(chronologyLanes([]), { lanes: [], rows: [], width: 1 });
});

test('the sample: Experience draws the branch from its open role', () => {
  const experience = SAMPLE.portfolio.sections.find((s) => s.kind === 'chronology')!;
  const ids = (experience as { items?: string[] }).items!;
  const entries = ids.map((id) => SAMPLE.portfolio.chronology.find((c) => c.id === id)!);
  const lanes = chronologyLanes(entries);
  assert.ok(lanes.rows.some((row) => row.kind === 'fork'));
  assert.ok(lanes.width >= 2);
});

// ───────────── BibTeX and the man page ─────────────

test('BibTeX: the type by venue, the cite key from surname, year and the first long title word', () => {
  const pub = (fields: object) => ({ id: 'p', type: 'publication', ...fields }) as Evidence;
  const conference = bibtexOf(
    pub({
      title: 'On the Legibility of Failure',
      authors: ['Ána Devi', 'R. Vale'],
      venue: 'Proceedings of SREcon',
      publishedAt: '2024-03',
      doi: '10.1/x',
    }),
  );
  assert.equal(conference.type, 'inproceedings');
  assert.equal(conference.key, 'devi2024legibility');
  assert.deepEqual(
    conference.fields.map(({ name }) => name),
    ['title', 'author', 'booktitle', 'year', 'doi'],
  );
  assert.equal(conference.fields[1]!.value, 'Ána Devi and R. Vale');
  const article = bibtexOf(pub({ title: 'A Note', venue: 'Queue' }));
  assert.equal(article.type, 'article');
  assert.equal(article.key, 'note');
  assert.deepEqual(
    article.fields.map(({ name }) => name),
    ['title', 'journal'],
  );
});

test('the man section: 1 for software, systems and interfaces, 7 otherwise', () => {
  assert.equal(manSectionOf({ medium: 'software' }), 1);
  assert.equal(manSectionOf({ medium: 'system' }), 1);
  assert.equal(manSectionOf({ medium: 'interface' }), 1);
  assert.equal(manSectionOf({ medium: 'writing' }), 7);
  assert.equal(manSectionOf({ medium: 'acme/zine' }), 7);
});

// ───────────── controls and slugs ─────────────

test('controls: each takes its default when unset or invalid', () => {
  assert.deepEqual(controlsOf(inputOf({ identity: { name: 'R' } })), {
    prompt: 'full',
    pane: 'docked',
    commands: 'shown',
    pinned: undefined,
  });
  assert.deepEqual(
    controlsOf(
      inputOf(
        { identity: { name: 'R' } },
        { prompt: 'bare', pane: 'x', commands: 'titles', pinned: 'w' },
      ),
    ),
    { prompt: 'bare', pane: 'docked', commands: 'titles', pinned: 'w' },
  );
});

test('slugs fold to ASCII and drop what has no Latin form', () => {
  assert.equal(slugOf('Zoë  Ångström!'), 'zoe-angstrom');
  assert.equal(slugOf('عمّان'), '');
  assert.equal(
    slugOf('A very long name that goes on and on'),
    'a-very-long-name-that-goes-on-and-on',
  );
});

// ───────────── N4 fixtures ─────────────

test('N4: no chronology, no github, no location, one artifact, a long name, a non-Latin name and RTL all derive', () => {
  const fixtures: Raw[] = [
    {
      identity: { name: 'Rowan Vale' },
      works: [{ id: 'one', title: 'One', medium: 'object' }],
      sections: [{ kind: 'works', id: 'w', items: ['one'] }],
    },
    {
      identity: { name: 'Maximiliana Theodora Wilhelmina von Hohenzollern-Sigmaringen' },
      sections: [{ kind: 'hero', id: 'top' }],
    },
    {
      identity: { name: 'ليلى حداد', location: 'عمّان، الأردن' },
      locale: 'ar',
      direction: 'rtl',
      sections: [{ kind: 'hero', id: 'top', tagline: 'أبني أدوات صغيرة.' }],
    },
  ];
  for (const raw of fixtures) {
    const input = inputOf(raw);
    const entries = transcriptOf(input.portfolio.sections, outlineOf(input));
    assert.equal(entries.length, input.portfolio.sections.length);
    for (const { section } of entries) assert.ok(commandFor(section, input).verb);
    assert.ok(thesisOf(input).text.length > 0);
    // No derivation names a person: the prompt is read from the content.
    const { user } = promptOf(input);
    if (user) assert.ok(slugOf(input.portfolio.identity.name).startsWith(user));
  }
  assert.equal(thesisOf(inputOf(fixtures[2]!)).text, 'أبني أدوات صغيرة.');
});
