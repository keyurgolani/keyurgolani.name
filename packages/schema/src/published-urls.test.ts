import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortfolio, parseSite } from './load';
import {
  acknowledgeUrl,
  listCanonicalUrls,
  planUrls,
  privateWorkIds,
  urlAcknowledgements,
  urlsVanished,
  type PlanUrlsInput,
} from './published-urls';
import { idReused } from './record-ids';
import { resolvePortfolioView, type ParsedPair, type PublicView } from './view';

// Published URLs (#10, item 4, the schema half).

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const SITE = lines(
  'schemaVersion: 2',
  'appearance:',
  '  variant: missing-variant',
  '  designLanguage: platform-neutral',
  '  colorScheme: ink-and-paper',
  '  typography: classic',
  '  displayMode: light',
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
);

/** A work with a case study at /work/<slug>, or private, or with no case study. */
const work = (id: string, slug: string, extra = '') =>
  `  - { id: ${id}, slug: ${slug}, title: ${id}, medium: system, caseStudy: { role: Lead }${extra} }`;

function pair(works: string[], listed: string[], site = SITE): ParsedPair {
  const portfolio = parsePortfolio(
    lines(
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity: { name: Rowan Urls }',
      ...(works.length > 0 ? ['works:', ...works] : []),
      'sections:',
      '  - { kind: lede, id: about, body: Hi. }',
      ...(listed.length > 0 ? [`  - { kind: works, id: work, items: [${listed.join(', ')}] }`] : []),
    ),
    'yaml',
  );
  const parsedSite = parseSite(site, 'yaml');
  assert.ok(portfolio.ok, JSON.stringify(portfolio));
  assert.ok(parsedSite.ok);
  return { portfolio: portfolio.value, site: parsedSite.value };
}
const viewOf = (value: ParsedPair): PublicView =>
  resolvePortfolioView(value, {}, { mediaBase: '/media' });
const plan = (live: ParsedPair | null, next: ParsedPair, more: Partial<PlanUrlsInput> = {}) =>
  planUrls({
    live: live ? viewOf(live) : null,
    liveTable: null,
    view: viewOf(next),
    acknowledgements: [],
    privateWorks: privateWorkIds(next),
    ...more,
  });

test('a revision serves its home page, each public case study, and the view paths it is given', () => {
  const value = pair(
    [
      work('atlas', 'tide'),
      work('notes', 'notes', ', visibility: private'),
      '  - { id: sketch, title: Sketch, medium: object }',
      work('unlisted', 'unlisted'),
    ],
    ['atlas', 'notes', 'sketch'],
  );
  assert.deepEqual(listCanonicalUrls(viewOf(value)), ['/', '/work/tide']);
  assert.deepEqual(
    listCanonicalUrls(viewOf(value), { viewPaths: ['/about', '/', 'about', '/x?y', '//cdn.test/a'] }),
    ['/', '/about', '/work/tide'],
  );
  assert.deepEqual(privateWorkIds(value), ['notes']);
});

test('a changed slug redirects by itself, and the next revision serves the new one', () => {
  const live = pair([work('atlas', 'tide')], ['atlas']);
  const next = pair([work('atlas', 'tidewater')], ['atlas']);
  assert.deepEqual(plan(live, next), {
    table: { redirects: { '/work/tide': '/work/tidewater' }, gone: [] },
    vanished: [],
  });
  // An empty store has nothing to vanish.
  assert.deepEqual(plan(null, next), { table: { redirects: {}, gone: [] }, vanished: [] });
});

test('any other URL that vanishes waits for an acknowledgement: gone, or a redirect to a live URL', () => {
  const live = pair([work('atlas', 'tide'), work('ledger', 'ledger')], ['atlas', 'ledger']);
  const next = pair([work('ledger', 'ledger')], ['ledger']);
  assert.deepEqual(plan(live, next).vanished, ['/work/tide']);
  assert.deepEqual(plan(live, next, { acknowledgements: [{ url: '/work/tide' }] }), {
    table: { redirects: {}, gone: ['/work/tide'] },
    vanished: [],
  });
  assert.deepEqual(
    plan(live, next, { acknowledgements: [{ url: '/work/tide', redirectTo: '/work/ledger' }] }),
    { table: { redirects: { '/work/tide': '/work/ledger' }, gone: [] }, vanished: [] },
  );
  // A redirect has to land on a URL the next revision serves.
  assert.deepEqual(
    plan(live, next, { acknowledgements: [{ url: '/work/tide', redirectTo: '/work/nowhere' }] })
      .vanished,
    ['/work/tide'],
  );
  // A view path the live variant served counts too.
  assert.deepEqual(
    plan(live, next, {
      acknowledgements: [{ url: '/work/tide' }],
      viewPaths: { live: ['/about'], next: [] },
    }).vanished,
    ['/about'],
  );
});

test('a slug whose work turned private is never gone: once acknowledged, it answers 404', () => {
  const live = pair([work('atlas', 'tide')], ['atlas']);
  const next = pair([work('atlas', 'tide', ', visibility: private')], ['atlas']);
  assert.deepEqual(plan(live, next).vanished, ['/work/tide']);
  assert.deepEqual(plan(live, next, { acknowledgements: [{ url: '/work/tide' }] }), {
    table: { redirects: {}, gone: [] },
    vanished: [],
  });
});

test('the table accumulates, one hop, and never holds a URL the next revision serves', () => {
  const live = pair([work('atlas', 'tide-2')], ['atlas']);
  const next = pair([work('atlas', 'tide-3')], ['atlas']);
  const liveTable = {
    redirects: { '/work/tide': '/work/tide-2', '/work/old': '/work/gone-page' },
    gone: ['/work/gone-page', '/work/tide-3'],
  };
  assert.deepEqual(plan(live, next, { liveTable }), {
    table: {
      // The older redirect follows the work to its new home; one to a gone URL is gone too.
      redirects: { '/work/tide': '/work/tide-3', '/work/tide-2': '/work/tide-3' },
      gone: ['/work/gone-page', '/work/old'],
    },
    vanished: [],
  });
});

test('an acknowledgement is a site path, with a redirect to another, and acknowledging is a pure reducer', () => {
  const derived = { other: 1, urlAcknowledgements: [{ url: '/b' }, { url: 'bad' }] };
  assert.deepEqual(urlAcknowledgements(derived), [{ url: '/b' }]);
  assert.deepEqual(urlAcknowledgements(undefined), []);
  const after = acknowledgeUrl(derived, { url: '/a', redirectTo: '/' });
  assert.deepEqual(after, {
    other: 1,
    urlAcknowledgements: [{ url: '/a', redirectTo: '/' }, { url: '/b' }],
  });
  // The same URL again replaces the earlier entry, and the input is left as it was.
  assert.deepEqual(acknowledgeUrl(after, { url: '/a' }).urlAcknowledgements, [
    { url: '/a' },
    { url: '/b' },
  ]);
  assert.deepEqual(derived.urlAcknowledgements, [{ url: '/b' }, { url: 'bad' }]);
  for (const bad of [{ url: 'work/a' }, { url: '/a', redirectTo: '/a' }, { url: '/a?b' }]) {
    assert.throws(() => acknowledgeUrl({}, bad), TypeError, JSON.stringify(bad));
  }
});

test('the publication validators wait for the live revision, then compare against it', () => {
  const live = pair([work('atlas', 'tide')], ['atlas']);
  const next = pair([], []);
  assert.deepEqual(urlsVanished.validate(next, {}), {
    diagnostics: [],
    notChecked: ['urls.vanished'],
  });
  assert.deepEqual(idReused.validate(next, {}), { diagnostics: [], notChecked: ['id.reused'] });
  const publication = { live: { pair: live } };
  const vanished = urlsVanished.validate(next, { publication });
  assert.deepEqual(
    vanished.diagnostics.map(({ code, severity, message }) => [code, severity, message]),
    [
      [
        'urls.vanished',
        'blocks-publish',
        '/work/tide is a live URL that this revision no longer serves, with no redirect and no acknowledgement.',
      ],
    ],
  );
  // An acknowledgement in the draft's derived block clears it.
  assert.deepEqual(
    urlsVanished.validate(next, {
      publication: { ...publication, derived: { urlAcknowledgements: [{ url: '/work/tide' }] } },
    }).diagnostics,
    [],
  );
  // An empty store has nothing to compare against.
  assert.deepEqual(urlsVanished.validate(next, { publication: { live: null } }).diagnostics, []);
});
