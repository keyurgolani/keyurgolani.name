import test from 'node:test';
import assert from 'node:assert/strict';
import { pairOf, render } from './harness';

// The sample-data lines the Wednesday review quoted (A4): a publication
// whose citation is written whole, which read "Anamika Devi, ACM Computing
// Surveys, Devi, A. (2021). A Survey of Anti-Entropy Mechanisms… 54(2),
// 1–34. ."; and a podcast whose location is "online", which read
// "online .". The citation stands for the authors and venue, the line ends
// on one period, and "online" isn't shown.

const CITATION =
  'Devi, A. (2021). A Survey of Anti-Entropy Mechanisms in Production Systems. ACM Computing Surveys, 54(2), 1–34.';

const portfolio = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Anamika Devi' },
  evidence: [
    {
      id: 'survey',
      type: 'publication',
      title: 'A Survey of Anti-Entropy Mechanisms in Production Systems',
      authors: ['Anamika Devi'],
      venue: 'ACM Computing Surveys',
      publishedAt: '2021-03',
      citation: CITATION,
    },
    {
      id: 'podcast',
      type: 'external-work',
      title: 'Incident History',
      description: 'Monthly podcast about famous software incidents.',
      url: 'https://incidenthistory.test',
      locationLabel: 'online',
      categories: ['Podcast', 'History'],
    },
    {
      id: 'award',
      type: 'award',
      title: 'Practitioner Award',
      organization: 'Acme Inc.',
      receivedAt: '2025',
    },
    {
      id: 'panel',
      type: 'talk',
      title: 'Panel',
      venue: 'Is on-call harmful?',
      presentedAt: '2024-01-01',
    },
    {
      id: 'talk',
      type: 'talk',
      title: 'When Latency Lies',
      venue: 'QCon London',
      location: 'London, UK',
      presentedAt: '2025-04-10',
    },
  ],
  sections: [
    {
      id: 'record',
      kind: 'evidence',
      title: 'Record',
      items: ['survey', 'talk', 'award', 'panel'],
    },
    { id: 'elsewhere', kind: 'evidence', title: 'Elsewhere', items: ['podcast'] },
  ],
};

/** The markup's text, tags gone and runs of space one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

test('a citation written whole stands for its authors and venue, and its line ends on one period', () => {
  const page = text(render(pairOf(portfolio)));
  assert.equal(page.split(CITATION.slice(0, -1)).length - 1, 1, 'the citation, once');
  assert.ok(page.includes(`${CITATION.slice(0, -1)}.`), page);
  assert.doesNotMatch(page, /Anamika Devi, ACM Computing Surveys/);
  assert.doesNotMatch(page, /1–34\. ?\./);
  // Without a citation, the structured venue and place still read as before.
  assert.match(page, /QCon London, London, UK\./);
});

test('a location of "online" is not shown, nor the period that followed it', () => {
  const page = text(render(pairOf(portfolio)));
  assert.doesNotMatch(page, /\bonline\b/i);
  assert.doesNotMatch(page, / \./);
  assert.match(page, /Incident History Podcast and History\./);
});

test("a line ends on one mark: never a period after Inc., a question mark, or the citation's own (A4)", () => {
  const page = text(render(pairOf(portfolio)));
  assert.match(page, /Acme Inc\. /);
  assert.doesNotMatch(page, /Inc\.\./);
  assert.match(page, /Is on-call harmful\? /);
  assert.doesNotMatch(page, /harmful\?\./);
  assert.doesNotMatch(page, /\.\./);
});
