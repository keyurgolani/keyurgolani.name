import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorBandOf,
  firstSentence,
  heroLine,
  homeModel,
  proofOf,
  sealOf,
  firstClause,
  sealText,
  twoLineWidth,
  TERRA_OVERRIDES,
  FIELD_FORMS,
  FIELD_ORDER,
} from './model';
import { checkDestinationOverrides, pageOutline } from '@portfolio/kit/sections';
import {
  FIXTURE_NAMES,
  fixtureInput,
  inputFor,
  pairOf,
  sampleInput,
} from './__tests__/harness.test';

// Terra Field's derivations (TF-M6, N4): the display line, the kicker, the
// seal, the anchor band and the fields, on the bundled sample and on the
// fixtures the director named (no photography, no proof list, no thesis,
// one work, a long name), plus a non-Latin name, a right-to-left page, and
// each control, a stale value included. None of them holds a person's
// words: every fixture is written here.

type Doc = Record<string, unknown>;

/** A small portfolio: one photo series, one software work as the signature, two metrics, an award. */
function base(overrides: Doc = {}): Doc {
  return {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Hale', email: 'rowan@example.com' },
    practice: { thesis: 'Quiet tools last. Everything else is a draft of one.' },
    signature: 'loom',
    proof: ['years', 'teams', 'prize'],
    works: [
      {
        id: 'loom',
        slug: 'loom',
        title: 'Loom',
        medium: 'software',
        summary: 'A scheduler.',
        period: { start: '2021-03' },
        role: 'Author',
        cover: { asset: 'loom-cover' },
        caseStudy: { challenge: 'Scheduling.' },
      },
      {
        id: 'coast',
        title: 'Coast',
        medium: 'image-series',
        media: [
          { asset: 'coast-1', caption: 'First light' },
          { asset: 'coast-2', caption: 'Low tide' },
        ],
      },
    ],
    evidence: [
      {
        id: 'years',
        type: 'metric',
        statement: 'Years building, mostly in public.',
        metric: { value: 9, unit: 'years' },
      },
      { id: 'teams', type: 'metric', statement: 'Teams helped', metric: { value: 14 } },
      { id: 'prize', type: 'award', title: 'Craft Prize', receivedAt: '2024' },
    ],
    chronology: [
      {
        id: 'now',
        kind: 'role',
        title: 'Staff engineer',
        organization: 'Field Works',
        period: { start: '2022-01' },
      },
    ],
    media: [
      { id: 'loom-cover', kind: 'image', source: 'loom.png', alt: 'A loom' },
      { id: 'coast-1', kind: 'image', source: 'coast-1.png', alt: 'A coast' },
      { id: 'coast-2', kind: 'image', source: 'coast-2.png', alt: 'A coast at low tide' },
    ],
    sections: [
      {
        kind: 'hero',
        id: 'top',
        tagline: 'Makes small tools.',
        subtagline: 'Lately, schedulers.',
        ctas: [{ url: '#contact', label: 'Write' }],
      },
      { kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' },
      { kind: 'works', id: 'work', title: 'Work', items: ['loom'] },
      { kind: 'works', id: 'photos', title: 'Photographs', items: ['coast'] },
      { kind: 'evidence', id: 'numbers', title: 'Numbers', items: ['years', 'teams'] },
      { kind: 'evidence', id: 'awards', title: 'Awards', items: ['prize'] },
      { kind: 'chronology', id: 'experience', title: 'Experience', items: ['now'] },
      { kind: 'contact', id: 'contact', title: 'Get in touch' },
    ],
    ...overrides,
  };
}

const input = (doc: Doc, controls?: Record<string, unknown>) => inputFor(pairOf(doc, controls));

test('the sample: the thesis is the h1, the name and the current role the kicker, the seal its first proof', () => {
  const model = homeModel(sampleInput());
  assert.deepEqual(model.line, { text: 'I make failure legible.', source: 'thesis' });
  assert.deepEqual(model.kicker, {
    name: 'Anamika Devi',
    role: 'Principal Engineer, Reliability',
    organization: 'Solstice Payments',
  });
  assert.equal(model.lede.lede?.startsWith('I build calm software'), true);
  assert.equal(model.action?.label, 'Get in touch');
  assert.equal(model.seal?.value, '12');
  assert.equal(model.seal?.label, 'Years engineering');
  assert.equal(model.seal?.href, '#tenure-years');
  assert.equal(model.standfirst?.startsWith('The systems I build'), true);
  // The band: the first photo series, then the signature and the next proof record.
  assert.equal(model.band.photo?.work.id, 'looking-photographs');
  assert.deepEqual(
    model.band.companions.map((each) => (each.kind === 'work' ? each.work.id : each.record.id)),
    ['postmortem-template-kit', 'services-owned'],
  );
  assert.deepEqual(
    model.fields.map((field) => field.id),
    ['work', 'writing', 'record', 'about'],
  );
});

test('every field opens its own way, quieter than the opening (TF-M5)', () => {
  const forms = FIELD_ORDER.map((id) => FIELD_FORMS[id]);
  const keys = new Set(forms.map((form) => `${form.tone} ${form.arc} ${form.depth}`));
  assert.equal(keys.size, forms.length);
  // The close is the only other field as deep as the opening; no destination field is.
  for (const id of FIELD_ORDER.filter((id) => id !== 'contact'))
    assert.notEqual(
      FIELD_FORMS[id].depth === 'deep' && FIELD_FORMS[id].tone === 'accent',
      true,
      id,
    );
  // Only the bookends, the opening and the close, take the accent's ground (S-6); every
  // subtle ground keeps a hairline on its arc, so it reads in every scheme (S-5).
  for (const id of FIELD_ORDER.filter((id) => id !== 'contact'))
    assert.notEqual(FIELD_FORMS[id].tone, 'accent', id);
  for (const form of forms) if (form.tone === 'subtle') assert.ok(form.edge, form.tone);
  assert.equal(FIELD_FORMS.record.edge, 'accent');
});

test('a short first sentence leads; a long one gives way to the tagline, then the name', () => {
  assert.deepEqual(heroLine(input(base())), { text: 'Quiet tools last.', source: 'thesis' });
  const long = input(
    base({
      practice: {
        thesis:
          'I make an unusually long first sentence about craft and time and patience here. Then more.',
      },
    }),
  );
  const hero = long.portfolio.sections.find((section) => section.kind === 'hero') as never;
  assert.deepEqual(heroLine(long, hero), { text: 'Makes small tools.', source: 'tagline' });
  assert.deepEqual(heroLine(long), { text: 'Rowan Hale', source: 'name' });
});

test('no thesis: the tagline is the h1, the lede is the subtagline alone, and there is no standfirst', () => {
  const model = homeModel(
    input(
      base({
        practice: undefined,
        sections: (base().sections as Doc[]).filter((s) => s.id !== 'thesis'),
      }),
    ),
  );
  assert.equal(model.line.source, 'tagline');
  assert.equal(model.lede.lede, undefined);
  assert.equal(model.lede.sub, 'Lately, schedulers.');
  assert.equal(model.standfirst, undefined);
  assert.equal(model.thesis, undefined);
});

test('the heroLine control picks, and a choice the content can’t fill falls to the next', () => {
  assert.equal(homeModel(input(base(), { heroLine: 'tagline' })).line.text, 'Makes small tools.');
  const named = homeModel(input(base(), { heroLine: 'name' }));
  assert.deepEqual(named.line, { text: 'Rowan Hale', source: 'name' });
  // The h1 is the name, so the kicker holds the role alone.
  assert.deepEqual(named.kicker, { role: 'Staff engineer', organization: 'Field Works' });
  // The whole thesis is the standfirst when the line isn't the thesis.
  assert.equal(named.standfirst, 'Quiet tools last. Everything else is a draft of one.');
});

test('the seal: a metric’s figure and its own words, the unit once; an award’s year; nothing else', () => {
  assert.deepEqual(sealOf(input(base()))?.value, '9');
  assert.equal(sealOf(input(base()))?.label, 'Years building');
  const years = {
    id: 'x',
    type: 'metric',
    statement: 'Years of continuous on-call rotation duty',
    metric: { value: 3, unit: 'years' },
  } as never;
  // Too many words for the seal: the unit alone, never a broken or new word (TF-M2).
  assert.deepEqual(sealText(years, 'en'), { value: '3', label: 'years' });
  const bare = { id: 'y', type: 'metric', metric: { value: 1200 } } as never;
  assert.deepEqual(sealText(bare, 'en'), { value: '1,200' });
  const prize = { id: 'z', type: 'award', title: 'Craft Prize', receivedAt: '2024-05' } as never;
  assert.deepEqual(sealText(prize, 'en'), { value: '2024', label: 'Craft Prize' });
  const talk = { id: 't', type: 'talk', title: 'A talk' } as never;
  assert.equal(sealText(talk, 'en'), undefined);
});

test('the seal is as wide as its label’s longer line on its best two-line split (TF-M2)', () => {
  assert.equal(twoLineWidth('ERC Starting Grant'), 12);
  assert.equal(twoLineWidth('years engineering'), 11);
  // A wide character takes about two ch, so a CJK label sizes the seal by its real width (low 5).
  assert.equal(twoLineWidth('工程十二年'), 10);
  assert.equal(twoLineWidth('ＡＢ cd'), 4);
  assert.equal(twoLineWidth('field systems shipped'), 13);
  assert.equal(twoLineWidth('years'), 5);
  assert.equal(twoLineWidth(undefined), 0);
});

test('no proof list: no seal, and the band is the photograph and the signature', () => {
  const model = homeModel(input(base({ proof: undefined })));
  assert.equal(model.seal, undefined);
  assert.deepEqual(
    model.band.companions.map((each) => each.kind),
    ['work'],
  );
});

test('the seal control off: no seal, and the band starts the proof list at its first record', () => {
  const model = homeModel(input(base(), { seal: false }));
  assert.equal(model.seal, undefined);
  assert.deepEqual(
    model.band.companions.map((each) => (each.kind === 'work' ? each.work.id : each.record.id)),
    ['loom', 'years'],
  );
});

test('no photography: the signature’s cover is the photograph, and it takes no plate of its own (N6)', () => {
  const doc = base();
  const works = (doc.works as Doc[]).filter((work) => work.id !== 'coast');
  const sections = (doc.sections as Doc[]).filter((section) => section.id !== 'photos');
  const model = homeModel(input({ ...doc, works, sections }));
  assert.equal(model.band.photo?.work.id, 'loom');
  assert.equal(model.band.photo?.signature, true);
  assert.deepEqual(
    model.band.companions.map((each) => (each.kind === 'work' ? each.work.id : each.record.id)),
    ['teams', 'prize'],
  );
});

test('one work and nothing else: no photograph, one plate, and every derivation still answers', () => {
  const model = homeModel(
    input({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Sol Ito' },
      works: [{ id: 'one', title: 'One', medium: 'object' }],
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['one'] }],
    }),
  );
  assert.deepEqual(model.line, { text: 'Sol Ito', source: 'name' });
  assert.equal(model.kicker, undefined);
  assert.equal(model.seal, undefined);
  assert.equal(model.band.photo, undefined);
  assert.deepEqual(model.band.companions, []);
  assert.deepEqual(
    model.fields.map((field) => field.id),
    ['work'],
  );
});

test('the anchorWork and companions controls choose, and a stale id falls back to the defaults', () => {
  const chosen = homeModel(input(base(), { anchorWork: 'loom', companions: ['prize'] }));
  assert.equal(chosen.band.photo?.work.id, 'loom');
  assert.deepEqual(
    chosen.band.companions.map((each) => (each.kind === 'work' ? each.work.id : each.record.id)),
    ['prize'],
  );
  const stale = homeModel(input(base(), { anchorWork: 'gone', companions: ['gone-too'] }));
  assert.equal(stale.band.photo?.work.id, 'coast');
  assert.equal(stale.band.companions.length, 2);
});

test('a long name, a non-Latin name, and a right-to-left page derive as written', () => {
  const long = homeModel(
    input(base({ identity: { name: 'Maximiliana Theodora Weatherby-Okonkwo Lindqvist' } }), {
      heroLine: 'name',
    }),
  );
  assert.equal(long.line.text, 'Maximiliana Theodora Weatherby-Okonkwo Lindqvist');
  const devanagari = homeModel(input(base({ identity: { name: 'अनामिका देवी' } })));
  assert.equal(devanagari.kicker?.name, 'अनामिका देवी');
  const rtl = homeModel(
    input(
      base({
        locale: 'ar',
        direction: 'rtl',
        identity: { name: 'ريم الحسيني' },
        practice: { thesis: 'الأدوات الهادئة تبقى. كل شيء آخر مسودة.' },
      }),
    ),
  );
  assert.equal(rtl.line.source, 'thesis');
  assert.equal(rtl.uiLang, 'en');
  assert.equal(rtl.fields[0]?.lang, 'en');
});

test('proofOf and firstSentence: the kit’s planned signatures (K-6)', () => {
  const proof = proofOf(input(base()));
  assert.equal(proof.signature?.id, 'loom');
  assert.deepEqual(
    proof.proof.map(({ id }) => id),
    ['years', 'teams', 'prize'],
  );
  assert.deepEqual(firstSentence('Dr. Ng builds. Then rests.'), {
    lead: 'Dr. Ng builds.',
    rest: 'Then rests.',
  });
  assert.deepEqual(firstSentence('One line only'), { lead: 'One line only' });
});

test('the field control quiet is read; the band never repeats a record', () => {
  assert.equal(homeModel(input(base(), { field: 'quiet' })).quiet, true);
  const band = anchorBandOf(input(base(), { companions: ['coast', 'loom'] }));
  // The photograph's own work isn't a plate beside it.
  assert.deepEqual(
    band.companions.map((each) => (each.kind === 'work' ? each.work.id : each.record.id)),
    ['loom'],
  );
});

test('the h1 takes a first sentence of 60 characters, not 61', () => {
  const thesisOf = (length: number) => `Quiet ${'a'.repeat(length - 7)}.`;
  assert.equal([...thesisOf(60)].length, 60);
  const at = (length: number) =>
    heroLine(input(base({ practice: { thesis: `${thesisOf(length)} Then more.` } }))).source;
  assert.equal(at(60), 'thesis');
  assert.equal(at(61), 'name');
  assert.equal(at(40), 'thesis');
});

test('only a metric or an award takes the seal, a dated testimonial or publication none', () => {
  const dated = (type: string) =>
    ({
      id: 'd',
      type,
      title: 'Kind words',
      receivedAt: '2024-01',
      statement: 'Said once.',
    }) as never;
  assert.equal(sealText(dated('testimonial'), 'en'), undefined);
  assert.equal(sealText(dated('publication'), 'en'), undefined);
  assert.equal(sealText(dated('talk'), 'en'), undefined);
  assert.deepEqual(sealText(dated('award'), 'en'), { value: '2024', label: 'Kind words' });
});

test('the seal keeps the owner’s words: never cut inside a number, never recased (N3)', () => {
  const metric = (statement: string, unit?: string) =>
    ({
      id: 'm',
      type: 'metric',
      statement,
      metric: unit ? { value: 4, unit } : { value: 4 },
    }) as never;
  assert.equal(firstClause('99.95% uptime held, all year'), '99.95% uptime held');
  assert.equal(firstClause('Served 1,200 teams, then more'), 'Served 1,200 teams');
  assert.equal(firstClause('Cut p99 by 3.5x. Then held it.'), 'Cut p99 by 3.5x');
  // A decimal or a grouped figure: whole, or the unit alone when it won't fit.
  assert.deepEqual(sealText(metric('99.95% uptime held', 'nines'), 'en'), {
    value: '4',
    label: 'nines',
  });
  assert.deepEqual(sealText(metric('Served 1,200 teams'), 'en'), {
    value: '4',
    label: 'Served 1,200 teams',
  });
  // A proper noun keeps its capital.
  assert.deepEqual(sealText(metric('Amazon teams onboarded'), 'en'), {
    value: '4',
    label: 'Amazon teams onboarded',
  });
});

test('a section Terra closes About with is declared, so every index reaches the About field (N7)', () => {
  const inputs = [sampleInput(), ...FIXTURE_NAMES.map((name) => fixtureInput(name))];
  assert.deepEqual(
    checkDestinationOverrides(
      TERRA_OVERRIDES,
      inputs.map((each) => pageOutline(each)),
    ),
    [],
  );
  for (const each of inputs) {
    const model = homeModel(each);
    const primary = model.navigation.primary.map((destination) => destination.id);
    for (const field of model.fields)
      assert.ok(primary.includes(field.id), `${field.id} field without a destination`);
  }
  const canary = homeModel(fixtureInput('hidden-canary'));
  assert.ok(canary.fields.some((field) => field.id === 'about'));
  assert.ok(canary.navigation.primary.some((destination) => destination.id === 'about'));
});

test('the display line counts a parenthetical’s words, and a link’s words but not its target (low 6)', () => {
  const lead = 'Small tools outlast the big plans they were made for';
  assert.equal(lead.length, 52);
  const withAside = base({ practice: { thesis: `${lead} (mostly).` } });
  assert.notEqual(heroLine(input(withAside)).source, 'thesis', '62 characters is past the line');
  const linked = base({
    practice: {
      thesis: '[Quiet](https://example.com/a/long/path/that/runs/on/and/on) tools last.',
    },
  });
  assert.equal(heroLine(input(linked)).source, 'thesis');
});

test('with no current role the kicker is the name alone, never the tagline in the role’s place (low 7)', () => {
  const doc = base({
    identity: { name: 'Rowan Hale', email: 'rowan@example.com', tagline: 'Tools, mostly.' },
    chronology: undefined,
    sections: (base().sections as Doc[]).filter((section) => section.id !== 'experience'),
  });
  assert.deepEqual(homeModel(input(doc)).kicker, { name: 'Rowan Hale' });
});

test('the band’s count is every photograph the series holds, its own cover included (low 10)', () => {
  const doc = base();
  const works = (doc.works as Doc[]).map((work) =>
    work.id === 'coast' ? { ...work, cover: { asset: 'coast-cover' } } : work,
  );
  const media = [
    ...(doc.media as Doc[]),
    { id: 'coast-cover', kind: 'image', source: 'coast-cover.png', alt: 'A coast at dusk' },
  ];
  const model = homeModel(input({ ...doc, works, media }));
  assert.equal(model.band.photo?.work.id, 'coast');
  assert.equal(model.band.photo?.count, 3);
});

test('under an id prefix every href the model resolves carries it once (the preview frame’s ids)', () => {
  const prefixed = (doc: Doc) => homeModel(inputFor(pairOf(doc), { idPrefix: 'pv-' }));
  // The hero's own action, an in-page fragment.
  assert.equal(prefixed(base()).action?.href, '#pv-contact');
  // No action of its own: the contact section's anchor, which the outline has prefixed already.
  const sections = (base().sections as Doc[]).map((section) =>
    section.id === 'top' ? { ...section, ctas: undefined } : section,
  );
  const fallback = prefixed(base({ sections }));
  assert.equal(fallback.action?.href, '#pv-contact');
  assert.equal(fallback.action?.own, true);
  // The seal's link and every field's index, once each.
  const model = prefixed(base());
  assert.ok(model.seal?.href?.startsWith('#pv-'), model.seal?.href);
  assert.doesNotMatch(model.seal?.href ?? '', /pv-pv-/);
  for (const field of model.fields)
    for (const entry of field.index) {
      assert.ok(entry.href?.startsWith('#pv-'), entry.href);
      assert.doesNotMatch(entry.href ?? '', /pv-pv-/);
    }
});

test('a second hero with no About to close goes to the last field the index reaches, never a field of its own', () => {
  const doc = base();
  const sections = [
    ...(doc.sections as Doc[]).filter((section) =>
      ['top', 'work', 'numbers', 'contact'].includes(section.id as string),
    ),
    { kind: 'hero', id: 'again', tagline: 'A second opening.' },
  ];
  const model = homeModel(input({ ...doc, sections }));
  const primary = model.navigation.primary.map((destination) => destination.id);
  assert.ok(!primary.includes('about'), 'nothing places About here');
  for (const field of model.fields)
    assert.ok(primary.includes(field.id), `${field.id} field without a destination`);
  const holding = model.fields.find((field) => field.sections.some(({ id }) => id === 'again'));
  assert.equal(holding?.id, model.fields.at(-1)!.id, 'it closes the last field');
});

test('only a ready image anchors the band: else the signature’s ready cover, else the plates (TF-M6)', () => {
  const unready = (doc: Doc, ready: readonly string[] = []) => {
    const loaded = inputFor(pairOf(doc), { media: 'as-loaded' });
    const live = inputFor(pairOf(doc));
    const media = Object.fromEntries(
      Object.entries(loaded.media).map(([id, asset]) => [
        id,
        ready.includes(id) ? live.media[id]! : asset,
      ]),
    );
    return { ...loaded, media } as typeof loaded;
  };
  // Nothing processed: no photograph, the signature and the next proof record as plates.
  const none = anchorBandOf(unready(base()));
  assert.equal(none.photo, undefined);
  assert.deepEqual(
    none.companions.map((each) => (each.kind === 'work' ? each.work.id : each.record.id)),
    ['loom', 'years'],
  );
  // Only the signature's cover is ready: it anchors, and takes no plate of its own (N6).
  const cover = anchorBandOf(unready(base(), ['loom-cover']));
  assert.equal(cover.photo?.work.id, 'loom');
  assert.equal(cover.photo?.signature, true);
  // The series' second image is ready and its first isn't: the ready one anchors.
  const second = anchorBandOf(unready(base(), ['coast-2']));
  assert.equal(second.photo?.work.id, 'coast');
  assert.equal(second.photo?.image.asset, 'coast-2');
  for (const name of FIXTURE_NAMES) {
    const band = homeModel(fixtureInput(name, 'as-loaded')).band;
    assert.equal(band.photo, undefined, `${name}: an unprocessed image anchored the band`);
  }
});
