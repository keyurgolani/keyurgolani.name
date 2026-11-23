import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChronologyEntry, Evidence, Work } from '@portfolio/schema';
import {
  BASE_BRANCH,
  checkOf,
  commitMessage,
  commitsByYear,
  diffStat,
  fileOf,
  hashOf,
  headBranch,
  mergeTargetOf,
  panelOf,
  plainText,
  wordDiff,
  type DiffLine,
} from './model';

// Pull Request's model (issue #270): the pieces the review page is built
// from, pure and from the content alone. Short hashes are a stable hash of
// each record's id, commit messages are built from a record's kind, a work
// is a file whose diff runs from its before to its after, each evidence
// record is a passing check with its sources, and the merge box links where
// the owner is best reached.

const work = (fields: Partial<Work> & Pick<Work, 'id'>): Work =>
  ({ title: fields.id, medium: 'software', ...fields }) as Work;
const entry = (fields: Partial<ChronologyEntry> & Pick<ChronologyEntry, 'id'>): ChronologyEntry =>
  ({ kind: 'role', title: 'Engineer', period: { start: '2020' }, ...fields }) as ChronologyEntry;
const evidence = (fields: Partial<Evidence> & Pick<Evidence, 'id'>): Evidence =>
  ({ type: 'metric', ...fields }) as Evidence;

const texts = (lines: readonly DiffLine[], kind: DiffLine['kind']) =>
  lines.flatMap((line) => (line.kind === kind && line.kind !== 'hunk' ? [line.text] : []));

test('a short hash is seven hex digits of the id, the same on every render, and differs by id', () => {
  const hash = hashOf('amazon-sde-ii');
  assert.match(hash, /^[0-9a-f]{7}$/);
  assert.equal(hashOf('amazon-sde-ii'), hash);
  assert.notEqual(hashOf('amazon-sde-i'), hash);
  // FNV-1a's 32-bit offset basis for the empty string, its first seven digits.
  assert.equal(hashOf(''), '811c9dc');
});

test('a word diff marks the words that changed when the lines are alike, and none when they are not', () => {
  const diff = wordDiff('hours of manual configuration', 'minutes of manual configuration');
  assert.ok(diff);
  assert.deepEqual(
    diff.before.map(({ text, changed }) => [text, changed]),
    [
      ['hours', true],
      ['of manual configuration', false],
    ],
  );
  assert.deepEqual(
    diff.after.map(({ text, changed }) => [text, changed]),
    [
      ['minutes', true],
      ['of manual configuration', false],
    ],
  );
  // Two lines with little in common are a whole line each, as a review shows them.
  assert.equal(wordDiff('Publish updates automatically', 'Keep a person in the loop'), null);
  // Markup isn't split: a line with Markdown in it stays whole.
  assert.equal(wordDiff('a *b* c d', 'a *b* c e'), null);
});

test('plain text reads Markdown as its words', () => {
  assert.equal(plainText('A [link](https://x.test) and *stress*.'), 'A link and stress.');
});

test('a commit message is built from the record kind, the owner words kept whole', () => {
  const words = (segments: ReturnType<typeof commitMessage>) =>
    segments.map((segment) => ('ui' in segment ? segment.ui : segment.own)).join('');
  assert.equal(
    words(commitMessage(entry({ id: 'a', title: 'SDE II', organization: 'Amazon' }))),
    'Join Amazon as SDE II',
  );
  assert.equal(
    words(commitMessage(entry({ id: 'b', kind: 'study', title: 'M.S.', organization: 'SJSU' }))),
    'Study M.S. at SJSU',
  );
  assert.equal(
    words(
      commitMessage(
        entry({ id: 'c', kind: 'milestone', title: 'Agents certificate', organization: 'HF' }),
      ),
    ),
    'Add Agents certificate (HF)',
  );
  assert.equal(words(commitMessage(entry({ id: 'd', title: 'Freelance' }))), 'Join as Freelance');
  // The verbs and joiners are the composition's, the rest the owner's.
  assert.deepEqual(
    commitMessage(entry({ id: 'e', title: 'SDE', organization: 'Amazon' })).map((s) =>
      'ui' in s ? 'ui' : 'own',
    ),
    ['ui', 'own', 'ui', 'own'],
  );
});

test('commits run newest first, grouped by the year they start, keeping the order within a month', () => {
  const groups = commitsByYear([
    entry({ id: 'old', period: { start: '2014-09' } }),
    entry({ id: 'new', period: { start: '2021-10' } }),
    entry({ id: 'mid-a', period: { start: '2019-03' } }),
    entry({ id: 'year', period: { start: '2021' } }),
    entry({ id: 'mid-b', period: { start: '2019-03' } }),
  ]);
  assert.deepEqual(
    groups.map(({ year, entries }) => [year, entries.map(({ id }) => id)]),
    [
      ['2021', ['new', 'year']],
      ['2019', ['mid-a', 'mid-b']],
      ['2014', ['old']],
    ],
  );
});

test('the head branch is the GitHub login when there is one, the name slugged when not', () => {
  assert.equal(headBranch({ github: 'keyurgolani', name: 'Keyur Golani' }), 'keyurgolani/join');
  assert.equal(headBranch({ name: 'Rowan Ito' }), 'rowan-ito/join');
  assert.equal(BASE_BRANCH, 'your-team/main');
});

test("a work with a challenge and an outcome is a changed file: the challenge in red, the outcome in green, the highlights pinned to the outcome's line", () => {
  const file = fileOf(
    work({
      id: 'agents',
      slug: 'ai-agent-platform',
      title: 'Agent platform',
      summary: 'Turns code into agents.',
      organization: 'Amazon',
      highlights: ['Built the harness', 'Launched it'],
      caseStudy: {
        challenge: 'Assistants go stale.',
        outcomes: 'Launched in September.\n\nCut QA from days to an hour.',
        decisions: [
          { decision: 'Keep a person in the loop', rationale: 'Nobody else is accountable.' },
          {
            decision: 'Score each run against the last',
            alternatives: 'Score each run alone',
          },
        ],
      },
    }),
  );
  assert.equal(file.path, 'works/amazon/ai-agent-platform.md');
  assert.equal(file.status, 'modified');
  assert.deepEqual(texts(file.lines, 'del'), ['Assistants go stale.']);
  assert.deepEqual(texts(file.lines, 'add'), [
    'Launched in September.',
    'Cut QA from days to an hour.',
  ]);
  const last = file.lines.findLast((line) => line.kind === 'add');
  assert.deepEqual(last?.kind === 'add' && last.note, {
    kind: 'note',
    items: ['Built the harness', 'Launched it'],
  });
  // Each decision is its own hunk in the expanded part: the alternative in red, the decision in green, the rationale its Why.
  assert.deepEqual(texts(file.more, 'del'), ['Score each run alone']);
  const decided = file.more.filter((line) => line.kind === 'add');
  assert.deepEqual(
    decided.map((line) => line.kind === 'add' && [line.text, line.note?.kind ?? null]),
    [
      ['Keep a person in the loop', 'why'],
      ['Score each run against the last', null],
    ],
  );
  assert.equal(file.moreLabel, 'case study');
  // Old and new numbers count context and removals, and context and additions.
  const numbered = [...file.lines, ...file.more].filter((line) => line.kind !== 'hunk');
  const olds = numbered.flatMap((line) => (line.kind !== 'add' ? [line.old] : []));
  const news = numbered.flatMap((line) => (line.kind !== 'del' ? [line.new] : []));
  assert.deepEqual(
    olds,
    olds.map((_, i) => i + 1),
  );
  assert.deepEqual(
    news,
    news.map((_, i) => i + 1),
  );
  assert.deepEqual(diffStat([file]), { adds: file.adds, dels: file.dels });
  assert.equal(file.dels, 2);
});

test('a work without a before is a new file, every line added, its highlights pinned to its summary', () => {
  const file = fileOf(
    work({
      id: 'rounds',
      title: 'rounds',
      summary: 'Interview prep.',
      tools: ['Python', 'React'],
      url: 'https://github.com/x/rounds',
      highlights: ['Self-hosted'],
    }),
    'built-in-the-open',
  );
  assert.equal(file.path, 'works/built-in-the-open/rounds.md');
  assert.equal(file.status, 'added');
  assert.equal(file.dels, 0);
  assert.ok(file.lines.every((line) => line.kind === 'add' || line.kind === 'hunk'));
  const summary = file.lines.find((line) => line.kind === 'add' && line.text === 'Interview prep.');
  assert.deepEqual(summary?.kind === 'add' && summary.note?.items, ['Self-hosted']);
  assert.equal(file.moreLabel, 'details');
  assert.ok(texts(file.more, 'add').includes('Python, React'));
  // Writing has its own directory.
  assert.equal(
    fileOf(work({ id: 'essay', slug: 'on-diffs', medium: 'writing' }), 'essays').path,
    'writing/on-diffs.md',
  );
});

test('a check is its record and its sources: its own links, the works that cite it, and the records that state its figure', () => {
  const check = checkOf(
    evidence({
      id: 'impressions',
      metric: { value: 1.1, unit: 'trillion' },
      statement: 'Ad impressions a year',
      url: 'https://x.test/report',
    }),
    {
      works: [work({ id: 'pricing', evidence: ['impressions'] })],
      chronology: [
        entry({ id: 'sde', highlights: ['Served 1.1 trillion impressions a year'] }),
        entry({ id: 'other', highlights: ['Something else'] }),
      ],
    },
  );
  assert.equal(check.name, 'metric/impressions');
  assert.deepEqual(
    check.sources.map(({ kind, id }) => [kind, id]),
    [
      ['url', 'impressions'],
      ['work', 'pricing'],
      ['commit', 'sde'],
    ],
  );
});

test('the panels: About is the conversation, the record splits into commits and checks, the work is files changed, contact the merge box', () => {
  assert.equal(panelOf({ kind: 'lede' }, 'about'), 'conversation');
  assert.equal(panelOf({ kind: 'hero' }, null), 'conversation');
  assert.equal(panelOf({ kind: 'chronology' }, 'record'), 'commits');
  assert.equal(panelOf({ kind: 'evidence' }, 'record'), 'checks');
  assert.equal(panelOf({ kind: 'github' }, 'record'), 'checks');
  assert.equal(panelOf({ kind: 'works' }, 'work'), 'files');
  assert.equal(panelOf({ kind: 'works' }, 'writing'), 'files');
  assert.equal(panelOf({ kind: 'contact' }, 'contact'), 'merge');
  assert.equal(panelOf({ kind: 'cta' }, 'contact'), 'merge');
});

test('approve and merge goes to the call to action, else a contact link, else LinkedIn, else the email, else the first link', () => {
  const linkedin = { text: 'LinkedIn', href: 'https://linkedin.com/in/x', platform: 'linkedin' };
  const github = { text: 'GitHub', href: 'https://github.com/x', platform: 'github' };
  const email = { text: 'x@y.test', href: 'mailto:x@y.test' };
  const cta = { id: 'cta', primary: { text: 'Book a call', href: 'https://cal.test' } };
  assert.equal(mergeTargetOf({ cta, links: [github], email })?.text, 'Book a call');
  assert.equal(
    mergeTargetOf({ contact: { links: [github] }, links: [linkedin], email })?.text,
    'GitHub',
  );
  assert.equal(mergeTargetOf({ links: [github, linkedin], email })?.text, 'LinkedIn');
  assert.equal(mergeTargetOf({ links: [github], email })?.text, 'x@y.test');
  assert.equal(mergeTargetOf({ links: [github] })?.text, 'GitHub');
  assert.equal(mergeTargetOf({ links: [] }), undefined);
});
