import test from 'node:test';
import assert from 'node:assert/strict';
import { CURATED, HOSTILE, LONG_TEXT, ONE_ARTIFACT, TEXT_ONLY } from '../__fixtures__/shapes';
import { homeModel } from '../model';
import { at, count, fragmentLinks, idsIn, inputFor, pairOf, render } from './harness';

// Editorial Evidence's pages (#13), rendered as the server sends them, so
// what these hold is also what a page with no JavaScript shows: the
// opening, the signature plate before every supporting record, unequal
// flagship plates, the proof strip, the reading order with nothing shown
// twice, the archive behind a closed disclosure, navigation by text, and a
// case study page with its way back.

const curated = () => render(pairOf(CURATED));

test("the page opens with the name as its one h1 and the owner's thesis, then the margin facts", () => {
  const html = curated();
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /<h1 class="ee-opening__name" data-type-role="display">Rowan Vale<\/h1>/);
  assert.match(
    html,
    /class="ee-opening__thesis" data-type-role="headline">[\s\S]*<strong>inspect<\/strong>/,
  );
  // The thesis opens the page, so its practice section doesn't repeat it.
  assert.doesNotMatch(html, /data-section-id="thesis"/);
  assert.ok(at(html, 'Based in') > at(html, 'ee-opening__thesis'));
  assert.match(html, /<dd data-type-role="body-compact">they\/them<\/dd>/);
});

test('the signature plate precedes the flagships, the proof strip, and every supporting section', () => {
  const html = curated();
  const signature = at(html, 'ee-plate--signature');
  for (const later of [
    'ee-plate--flagship',
    'ee-proof',
    'data-section-id="work"',
    'data-section-id="evidence"',
    'ee-archive',
  ]) {
    assert.ok(signature < at(html, later), later);
  }
  // Flagships keep the owner's featured order.
  assert.ok(at(html, '>Atlas<') < at(html, '>Harbor<'));
  assert.ok(at(html, '>Harbor<') < at(html, '>Kiln<'));
  assert.match(html, /<p class="ee-plate__label" data-type-role="label">Signature work<\/p>/);
  // The signature's cover loads first; the plate's evidence notes stop at three.
  assert.match(
    html,
    /ee-plate--signature[\s\S]*?loading="eager"|ee-plate--signature[\s\S]*?ee-plate__artifact/,
  );
  const notes =
    /ee-plate__notes" aria-labelledby="ee--notes-ledger ee--title-ledger">([\s\S]*?)<\/aside>/.exec(
      html,
    )?.[1] ?? '';
  assert.equal(count(notes, /<li\b/g), 3);
  // Each plate's notes are named for it: Evidence for, then its title.
  assert.match(html, /<span id="ee--notes-ledger" hidden="">Evidence for<\/span>/);
  const labels = [...html.matchAll(/class="ee-plate__notes" aria-labelledby="([^"]+)"/g)].map(
    ([, label]) => label,
  );
  assert.equal(new Set(labels).size, labels.length);
});

test('what the plates, the proof strip, or the archive show is left out of the reading order, which keeps the rest', () => {
  const model = homeModel(inputFor(pairOf(CURATED)));
  const work = model.sections.find(({ id }) => id === 'work');
  assert.ok(work && work.kind === 'works');
  assert.deepEqual(work.items, ['notes']);
  // Nor does the proof strip's evidence repeat in an evidence section.
  const evidence = model.sections.find(({ id }) => id === 'evidence');
  assert.ok(evidence && evidence.kind === 'evidence');
  assert.deepEqual(evidence.items, ['paper', 'talk']);
  assert.deepEqual(
    model.sections.map(({ id }) => id),
    ['work', 'evidence', 'contact'],
  );
  assert.deepEqual(
    model.archive.map(({ id }) => id),
    ['old-site', 'zine'],
  );
  const html = curated();
  assert.equal(count(html, /id="atlas"/g), 1);
  assert.equal(count(html, /data-work-id="old-site"/g), 1);
});

test('the archive sits behind a closed native disclosure, its count in the summary', () => {
  const html = curated();
  const archive = /<section id="ee--archive"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
  assert.match(archive, /<details class="ee-archive__disclosure" data-ui-slot="disclosure">/);
  assert.doesNotMatch(archive, /<details[^>]* open/);
  assert.match(archive, /<summary data-ui-slot="disclosure.summary">Show 2 older works<\/summary>/);
  assert.ok(at(archive, '>The old site<') < at(archive, '>A zine<'));
});

test('one navigation list names each destination by text, and every fragment it links to exists', () => {
  const html = curated();
  const nav = /<nav class="ee-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  assert.deepEqual(
    [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([, href, text]) => [href, text]),
    [
      ['#ee--work', 'Selected work'],
      ['#ee--proof', 'Proof'],
      ['#work', 'Work'],
      ['#evidence', 'Evidence'],
      ['#contact', 'Contact'],
      ['#ee--archive', 'Archive'],
    ],
  );
  const ids = idsIn(html);
  assert.equal(new Set(ids).size, ids.length, 'no id repeats');
  for (const fragment of fragmentLinks(html)) assert.ok(ids.includes(fragment), fragment);
  // The name always goes home, and it's the current page there.
  assert.match(
    html,
    /<a class="ee-masthead__name" href="\/" data-type-role="label" aria-current="page">Rowan Vale<\/a>/,
  );
  assert.equal(count(html, /data-visitor-control-slot/g), 1);
});

test('links resolve under every mount: the site root, /sample with its variant, and a preview prefix', () => {
  const sample = render(pairOf(CURATED), {
    basePath: '/sample',
    query: { variant: 'editorial-evidence' },
  });
  assert.match(sample, /class="ee-masthead__name" href="\/sample\?variant=editorial-evidence"/);
  assert.match(sample, /href="\/sample\/work\/ledger\?variant=editorial-evidence"/);
  const preview = render(pairOf(CURATED), { idPrefix: 'pv-' });
  assert.match(preview, /<main id="pv-main"/);
  assert.match(preview, /href="#pv-ee--work"/);
  const ids = idsIn(preview);
  assert.ok(
    ids.every((id) => id.startsWith('pv-')),
    ids.join(' '),
  );
  for (const fragment of fragmentLinks(preview)) assert.ok(ids.includes(fragment), fragment);
});

test('a work with a case study links to its page from its plate, by its title and a described action', () => {
  const html = curated();
  assert.match(html, /<h3 id="ee--title-ledger"[^>]*><a href="\/work\/ledger">Ledger<\/a><\/h3>/);
  assert.match(
    html,
    /<a[^>]*aria-describedby="ee--title-ledger"[^>]*href="\/work\/ledger"[^>]*>[\s\S]*?Read the case study/,
  );
  // A slug alone is no page (#10b routes a case study at a slug), so it links nowhere.
  assert.match(html, /<h3 id="ee--title-atlas"[^>]*>Atlas<\/h3>/);
  assert.doesNotMatch(html, /href="\/work\/atlas"/);
  // Every work link on home is a routed work's.
  const linked = [...html.matchAll(/href="\/work\/([^"?#]+)"/g)].map(([, slug]) => slug);
  assert.deepEqual([...new Set(linked)].sort(), ['ledger']);
  assert.equal(count(html, /Read the case study/g), 1);
});

test("a case study's page: the breadcrumb, the work's title as its one h1, its fields, and the way back", () => {
  const html = render(pairOf(CURATED), { route: { route: 'work', slug: 'ledger' } });
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /<h1 class="pf-case-study__title">Ledger<\/h1>/);
  const crumbs = /<nav class="ee-breadcrumb"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  assert.deepEqual(
    [...crumbs.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item]) => item!.replace(/<[^>]+>/g, '')),
    ['Home', 'Selected work', 'Ledger'],
  );
  assert.match(crumbs, /<a href="\/#ee--work">Selected work<\/a>/);
  assert.match(crumbs, /aria-current="page"/);
  for (const field of ['Challenge', 'Decisions', 'Rationale', 'Evidence', 'Outcomes']) {
    assert.match(html, new RegExp(`>${field}<`), field);
  }
  // Back to the plate the work came from, on the home page.
  assert.match(html, /<a[^>]*href="\/#ledger"[^>]*>[\s\S]*?Back to work/);
  assert.doesNotMatch(html, /aria-current="page">Rowan Vale/);
});

test('a slug with no case study, like one that names nothing, gets no page: the page says so and links home', () => {
  for (const slug of ['atlas', 'nowhere']) {
    const html = render(pairOf(CURATED), { route: { route: 'work', slug } });
    assert.equal(count(html, /<h1\b/g), 1, slug);
    assert.match(html, /This work isn(?:&#x27;|')t here/, slug);
    assert.doesNotMatch(html, /pf-case-study|pf-work/, slug);
    assert.match(html, /<a[^>]*href="\/"[^>]*><span[^>]*>Back home/, slug);
  }
});

test("a work's page leads back to where home shows it: its plate, the archive, or its section", () => {
  const crumbsOf = (html: string) =>
    [
      ...(/<nav class="ee-breadcrumb"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '').matchAll(
        /<li>([\s\S]*?)<\/li>/g,
      ),
    ].map(([, item]) => item!.replace(/<[^>]+>/g, ''));
  const zine = render(pairOf(CURATED), { route: { route: 'work', slug: 'zine' } });
  assert.deepEqual(crumbsOf(zine), ['Home', 'Archive', 'A zine']);
  assert.match(zine, /<a href="\/#ee--archive">Archive<\/a>/);
  assert.match(zine, /<a[^>]*href="\/#ee--archive"[^>]*>[\s\S]*?Back to the archive/);
  const notes = render(pairOf(CURATED), { route: { route: 'work', slug: 'notes' } });
  assert.deepEqual(crumbsOf(notes), ['Home', 'Work', 'Field notes']);
  assert.match(notes, /<a href="\/#work"><span>Work<\/span><\/a>/);
  assert.match(notes, /<a[^>]*href="\/#notes"[^>]*>[\s\S]*?Back to work/);
  // Each way back lands on home.
  const home = idsIn(curated());
  for (const id of ['ee--archive', 'work', 'notes']) assert.ok(home.includes(id), id);
});

test('one artifact: the name, then the signature on its own, text-led with no empty frame', () => {
  const html = render(pairOf(ONE_ARTIFACT));
  assert.match(html, /<h1 class="ee-opening__name"[^>]*>Sol Ito<\/h1>/);
  assert.match(html, /class="ee-plate ee-plate--signature ee-plate--text"/);
  assert.doesNotMatch(html, /ee-plate__artifact|ee-flagships|ee-proof|ee-archive|<figure/);
  assert.doesNotMatch(html, /<dl/);
});

test('text only: the thesis, a text-led flagship, and the reading order, with no media at all', () => {
  const html = render(pairOf(TEXT_ONLY));
  assert.doesNotMatch(html, /<img|<figure|<picture|ee-plate--signature/);
  assert.match(html, /Cities are arguments people live inside\./);
  assert.match(html, /class="ee-plate ee-plate--flagship ee-plate--text"/);
  assert.ok(at(html, 'ee-plate--flagship') < at(html, 'data-section-id="about"'));
});

test('a long title and long evidence render whole, for the stylesheet to wrap', () => {
  const home = render(pairOf(LONG_TEXT));
  assert.match(home, new RegExp(`>${LONG_TEXT.works[0]!.title}<`));
  const page = render(pairOf(LONG_TEXT), { route: { route: 'work', slug: 'long' } });
  assert.match(page, new RegExp(LONG_TEXT.evidence[0]!.statement));
});

test('hostile Markdown renders as text: no script, no javascript: or data: link, no injected markup', () => {
  for (const route of [{ route: 'home' as const }, { route: 'work' as const, slug: 'trap' }]) {
    const html = render(pairOf(HOSTILE), { route });
    assert.doesNotMatch(html, /<script|<iframe|<img\b|<[^>]*\son\w+=/i, route.route);
    assert.doesNotMatch(html, /href="\s*(?:javascript|data):/i, route.route);
  }
});

test("a link to a section the page folds away still lands: a hero's #work, and the thesis's own id", () => {
  const portfolio = (signature: boolean) => ({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Kai Bell' },
    practice: { thesis: 'Make the record the product.' },
    ...(signature ? { signature: 'one' } : { archive: ['one'] }),
    works: [{ id: 'one', title: 'One', medium: 'system' }],
    sections: [
      { kind: 'hero', id: 'top', ctas: [{ url: '#work', label: 'See the work' }] },
      { kind: 'practice', id: 'thesis', part: 'thesis' },
      { kind: 'works', id: 'work', title: 'Work', items: ['one'] },
      { kind: 'lede', id: 'more', body: '[Thesis](#thesis)' },
    ],
  });
  for (const signature of [true, false]) {
    const html = render(pairOf(portfolio(signature)));
    assert.doesNotMatch(html, /data-section-id="work"/);
    const ids = idsIn(html);
    for (const fragment of ['work', 'thesis']) {
      assert.ok(ids.includes(fragment), `${signature} ${fragment}`);
    }
    // A section emptied into the archive anchors there, not on Selected work.
    const archive = /<section id="ee--archive"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    assert.equal(archive.includes('id="work"'), !signature, `${signature}: work in the archive`);
    for (const fragment of fragmentLinks(html)) assert.ok(ids.includes(fragment), fragment);
  }
});
