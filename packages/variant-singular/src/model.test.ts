import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { pageOutline } from '@portfolio/kit/sections';
import {
  actionOf,
  backPointer,
  bestWorkOf,
  caseActionOf,
  caseStopsOf,
  foldLineOf,
  heroCtasOf,
  contactLinksOf,
  currentRole,
  figureRow,
  firstSentence,
  lengthClass,
  moreWorksOf,
  numbersOf,
  planOf,
  proofOf,
  recordIndex,
  referencesOf,
  whoOf,
  type CaseFields,
  type ModelInput,
} from './model';
import type { Section, Work } from '@portfolio/schema';

const MANIFEST = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// Singular's derivations over the repository's sample, the concept's four
// fixture shapes (no contact section; no signature and no featured; no
// testimonials and no metrics; one work, text only) and the N4 fixtures:
// one artifact, no proof list, no thesis, no chronology, no media, a long
// name, a non-Latin name, and right to left. Every fixture below is
// invented for the test; the sample is portfolio.example.yml.

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
  return { portfolio, controls, derived: {} } as unknown as ModelInput;
}

/** The home page's outline for a model input: at the site root, no id prefix. */
const outlineOf = (input: ModelInput) =>
  pageOutline({
    ...input,
    route: { route: 'home' },
    basePath: '',
    query: {},
    ids: { prefix: '', main: 'main' },
    media: {},
    capabilities: { renderedKinds: MANIFEST.renderedKinds, unsupportedKinds: [], views: [] },
  } as unknown as Parameters<typeof pageOutline>[0]);

const ROOT = new URL('../../../', import.meta.url);
const SAMPLE = YAML.parse(readFileSync(new URL('portfolio.example.yml', ROOT), 'utf8')) as Raw;
const sample = (controls: ModelInput['controls'] = {}) => inputOf(SAMPLE, controls);
const keys = (input: ModelInput) => planOf(input).panels.map((panel) => panel.key);
const grounds = (input: ModelInput) => planOf(input).panels.map((panel) => panel.ground);

/** Each fixture shape the concept tested, made from the sample by taking one thing out. */
function without(change: (raw: Raw) => Raw): ModelInput {
  return inputOf(change(structuredClone(SAMPLE)));
}
const sections = (raw: Raw) => raw.sections as { kind: string; id: string; items?: string[] }[];

// ───────────── the sample ─────────────

test('the sample: panel 1 is the thesis, the name and the hero tagline under it (SG-M1)', () => {
  const who = whoOf(sample());
  assert.equal(who.line, 'I make failure legible.');
  assert.equal(who.lineClass, 'short');
  assert.match(who.lede ?? '', /^I build calm software at scale/);
  assert.deepEqual(who.aside, [
    'Currently leading reliability for a platform that handles 10B requests a day.',
    'Principal Engineer, Reliability, Solstice Payments',
    'Bengaluru, India (she/her)',
  ]);
});

test('the sample: six panels in the fixed order, paper and ink by position, the accent last', () => {
  const input = sample();
  assert.deepEqual(keys(input), ['who', 'best', 'numbers', 'more', 'refs', 'contact']);
  assert.deepEqual(grounds(input), ['canvas', 'inverse', 'canvas', 'inverse', 'canvas', 'accent']);
  assert.deepEqual(
    planOf(input).panels.map((panel) => panel.band),
    ['inverse', 'canvas', 'inverse', 'canvas', 'inverse', 'inverse'],
  );
  assert.equal(bestWorkOf(input)?.id, 'postmortem-template-kit');
  assert.equal(numbersOf(input)?.section?.id, 'at-a-glance');
  assert.equal(numbersOf(input)?.figures.length, 4);
  assert.deepEqual(
    moreWorksOf(input).map((work) => work.id),
    // Featured, the best work's section, then Essays whole: it fits in the five (the lead's ruling, item 3).
    [
      'small-traces',
      'the-quiet-cost-of-legible-systems',
      'chaos-curriculum',
      'a-brief-history-of-the-phrase-cattle-not-pets',
      'postmortems-are-an-editing-problem',
    ],
  );
  assert.equal(referencesOf(input)?.id, 'words-from-collaborators');
  assert.deepEqual([...planOf(input).consumed].sort(), [
    'at-a-glance',
    'contact',
    'top',
    'want-to-work-together',
    'words-from-collaborators',
  ]);
  // Every other section, once, in authored order.
  const record = planOf(input).record.map((section) => section.id);
  assert.equal(record[0], 'thesis');
  assert.equal(record.includes('top'), false);
  assert.equal(new Set(record).size, record.length);
});

test('panel 1 is named by the hero’s own title, and by the composition’s word when the hero has none', () => {
  const input = sample();
  assert.deepEqual(planOf(input).panels[0]?.label, { text: 'Home', own: false });
  const titled = {
    ...input,
    portfolio: {
      ...input.portfolio,
      sections: input.portfolio.sections.map((section) =>
        section.kind === 'hero' ? { ...section, title: '  Hello  there ' } : section,
      ),
    },
  } as typeof input;
  assert.deepEqual(planOf(titled).panels[0]?.label, { text: 'Hello there', own: true });
});

test('the sample: each panel’s one action', () => {
  const input = sample();
  const plan = planOf(input);
  const of = (key: string) =>
    actionOf(
      input,
      plan.panels.find((panel) => panel.key === key)!,
    );
  // 'next' is the default: the composition's own way on (the lead's ruling).
  assert.deepEqual(of('who'), {
    label: 'See the work',
    own: false,
    target: { kind: 'anchor', anchor: 'sg-best-work' },
    dest: { text: 'Best work', own: false },
    dir: 'down',
  });
  // With heroAction: cta, the band is his first call to action, under his own label.
  const cta = sample({ heroAction: 'cta' });
  const first = (SAMPLE.sections as { kind: string; ctas?: { label: string }[] }[]).find(
    (section) => section.kind === 'hero',
  )!.ctas![0]!;
  const band = actionOf(cta, planOf(cta).panels[0]!)!;
  assert.equal(band.label, first.label);
  assert.equal(band.own, true);
  assert.deepEqual(band.target, { kind: 'anchor', anchor: 'contact' });
  assert.deepEqual(of('best')?.target, { kind: 'case', slug: 'postmortem-template-kit' });
  assert.equal(of('numbers')?.label, 'See the record behind them');
  assert.deepEqual(of('numbers')?.target, { kind: 'anchor', anchor: 'experience' });
  // Work Showcase only repeats panels 2 and 4, so "every work" goes to the next works section.
  assert.equal(of('more')?.label, 'See every work');
  // Essays shows whole in panel 4, so it points back too: the next works of its own is Incident History.
  assert.deepEqual(of('more')?.target, { kind: 'anchor', anchor: 'incident-history' });
  assert.equal(of('refs')?.label, 'Read papers, talks and awards');
  // The owner's own words for his address win (the lead's ruling): the nested call to action's "Email me".
  assert.equal(of('contact')?.label, 'Email me');
  assert.equal(of('contact')?.own, true);
  assert.equal(of('contact')?.object, undefined);
  assert.deepEqual(of('contact')?.target, { kind: 'url', url: 'mailto:anamika@example.com' });
});

test('the sample: the "are above" back-pointer, and the record index by destination', () => {
  const input = sample();
  const showcase = input.portfolio.sections.find((s) => s.id === 'work-showcase')!;
  assert.deepEqual(backPointer(showcase, input)?.where, ['best', 'more']);
  const essays = input.portfolio.sections.find((s) => s.id === 'essays')!;
  assert.deepEqual(backPointer(essays, input)?.where, ['more']);
  const podcast = input.portfolio.sections.find((s) => s.id === 'incident-history')!;
  assert.equal(backPointer(podcast, input), undefined);
  const groups = recordIndex(input, outlineOf(input));
  assert.deepEqual(
    groups.map((group) => group.id),
    ['work', 'writing', 'record', 'about'],
  );
  const listed = groups.flatMap((group) => group.sections.map((entry) => entry.id));
  // The index lists every record section and none of the panels'.
  assert.deepEqual(
    [...listed].sort(),
    planOf(input)
      .record.map((section) => section.id)
      .sort(),
  );
});

test('the sample: contact links are the portfolio’s and the calls to action’s, each once, never the band’s email', () => {
  const links = contactLinksOf(sample()).map((link) => link.url);
  assert.deepEqual(links, [
    'https://github.com/anamika',
    'https://linkedin.com/in/anamika',
    'https://hachyderm.io/@anamika',
    'https://anamika.example.com',
    'https://anamika.example.com/cv.pdf',
  ]);
});

test('panel 6: every address once, under one of the owner’s own labels for it, the band’s email included (the lead’s ruling)', () => {
  const key = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');
  const check = (input: ModelInput) => {
    const { portfolio } = input;
    // Every label the owner gave each address, wherever he gave it.
    const owned = new Map<string, Set<string>>();
    const hero = portfolio.sections.find((section) => section.kind === 'hero') as
      { ctas?: { url: string; label?: string }[] } | undefined;
    const ctas = portfolio.sections.filter((section) => section.kind === 'cta') as {
      primaryAction?: { url: string; label?: string };
      secondaryAction?: { url: string; label?: string };
    }[];
    for (const link of [
      ...(portfolio.links ?? []),
      ...(portfolio.contact?.links ?? []),
      ...(hero?.ctas ?? []),
      ...ctas
        .flatMap((cta) => [cta.primaryAction, cta.secondaryAction])
        .filter((a) => a !== undefined),
    ] as { url: string; label?: string }[]) {
      if (!link.label?.trim()) continue;
      const labels = owned.get(key(link.url)) ?? new Set<string>();
      labels.add(link.label.trim());
      owned.set(key(link.url), labels);
    }
    const contact = planOf(input).panels.find((panel) => panel.key === 'contact')!;
    const band = actionOf(input, contact)!;
    const shown = [
      ...contactLinksOf(input).map((link) => ({ url: link.url, label: link.label?.trim() })),
      {
        url: band.target.kind === 'url' ? band.target.url : '',
        label: band.own ? band.label : undefined,
      },
    ];
    const keys = shown.map((each) => key(each.url));
    assert.equal(new Set(keys).size, keys.length, `an address twice: ${keys.join(' ')}`);
    for (const each of shown) {
      const labels = owned.get(key(each.url));
      if (labels) assert.ok(labels.has(each.label ?? ''), `${each.url}: ${each.label} is not his`);
    }
  };
  check(sample());
  // An unlabelled link first, and his label for the same address after it: his words show.
  const raw = structuredClone(SAMPLE) as Raw & { links: { url: string; label?: string }[] };
  raw.links = raw.links.map((link) => ({ url: link.url }));
  check(inputOf(raw));
  assert.equal(
    contactLinksOf(inputOf(raw)).find((link) => link.url.endsWith('cv.pdf'))?.label,
    'Resume',
  );
});

test('with heroAction: cta panel 1’s band is his first call to action that lands on home; the rest go to Contents, in his words, but a stop’s duplicate', () => {
  // His "Get in touch" goes to #contact, which Contents lists as stop 06, "Get in touch": a true
  // duplicate (P1-7). In words of his own, it would stay.
  assert.deepEqual(
    heroCtasOf(sample()).map((cta) => cta.label),
    ['Resume'],
  );
  assert.deepEqual(
    heroCtasOf(sample({ heroAction: 'cta' })).map((cta) => cta.label),
    ['Resume'],
  );
  // A call to action to a place home doesn't have goes nowhere: neither the band nor Contents takes it.
  const raw = structuredClone(SAMPLE);
  const hero = sections(raw).find((section) => section.kind === 'hero') as unknown as {
    ctas: { url: string; label: string }[];
  };
  hero.ctas[0]!.url = '#no-such-place';
  const lost = inputOf(raw);
  const own = structuredClone(SAMPLE);
  (
    sections(own).find((section) => section.kind === 'hero') as unknown as {
      ctas: { url: string; label: string }[];
    }
  ).ctas[0]!.label = 'Write to me';
  assert.deepEqual(
    heroCtasOf(inputOf(own)).map((each) => each.label),
    ['Write to me', 'Resume'],
  );
  const lostCta = inputOf(raw, { heroAction: 'cta' });
  assert.equal(actionOf(lostCta, planOf(lostCta).panels[0]!)?.label, 'Resume');
  assert.deepEqual(heroCtasOf(lostCta), []);
  assert.deepEqual(
    heroCtasOf(lost).map((each) => each.label),
    ['Resume'],
  );
});

// ───────────── the controls ─────────────

test('controls: introSource, bestWork, heroAction and contactLabel', () => {
  const hero = whoOf(sample({ introSource: 'hero' }));
  assert.match(hero.line ?? '', /^I build calm software/);
  assert.equal(hero.lineClass, 'long');
  assert.equal(hero.lede, 'I make failure legible.');
  assert.equal(bestWorkOf(sample({ bestWork: 'small-traces' }))?.id, 'small-traces');
  // A stale id falls back to the signature.
  assert.equal(bestWorkOf(sample({ bestWork: 'no-such-work' }))?.id, 'postmortem-template-kit');
  const input = sample({ heroAction: 'cta' });
  const who = planOf(input).panels[0]!;
  assert.deepEqual(actionOf(input, who), {
    label: 'Get in touch',
    own: true,
    target: { kind: 'anchor', anchor: 'contact' },
    dir: 'down',
  });
  // contactLabel says what the band says when no call to action to the address has words of its
  // own: the sample's "Email me" goes, so the control decides.
  const unworded = (controls: ModelInput['controls']) => {
    const raw = structuredClone(SAMPLE);
    for (const section of sections(raw) as { kind: string; primaryAction?: unknown }[]) {
      if (section.kind === 'cta') delete section.primaryAction;
    }
    return inputOf(raw, controls);
  };
  const byAddress = unworded({ contactLabel: 'email' });
  const contact = planOf(byAddress).panels.at(-1)!;
  assert.equal(actionOf(byAddress, contact)?.label, 'Email');
  assert.equal(actionOf(byAddress, contact)?.object, 'anamika@example.com');
  assert.equal(actionOf(byAddress, contact)?.dest, undefined);
  const byName = unworded({});
  assert.equal(actionOf(byName, planOf(byName).panels.at(-1)!)?.object, 'Anamika Devi');
  assert.equal(
    numbersOf(sample({ numbersSection: 'words-from-collaborators' }))?.section?.id,
    'at-a-glance',
  );
  assert.equal(referencesOf(sample({ referencesSection: 'publications' }))?.id, 'publications');
});

// ───────────── the concept's four fixture shapes ─────────────

test('no contact section: the calls to action stay in the record, and the last panel isn’t the accent', () => {
  const input = without((raw) => ({
    ...raw,
    sections: sections(raw).filter((s) => s.kind !== 'contact'),
  }));
  assert.deepEqual(keys(input), ['who', 'best', 'numbers', 'more', 'refs']);
  assert.equal(grounds(input).includes('accent'), false);
  assert.ok(planOf(input).record.some((section) => section.id === 'want-to-work-together'));
});

test('no signature and no featured: the first work of the first works section is the best', () => {
  const input = without((raw) => {
    const copy = { ...raw };
    delete copy.signature;
    copy.featured = [];
    return copy;
  });
  assert.equal(bestWorkOf(input)?.id, 'postmortem-template-kit');
  assert.deepEqual(
    moreWorksOf(input).map((work) => work.id),
    // Then Essays, whole, since all three fit; Incident History's three don't, and it's never split.
    [
      'small-traces',
      'chaos-curriculum',
      'the-quiet-cost-of-legible-systems',
      'a-brief-history-of-the-phrase-cattle-not-pets',
      'postmortems-are-an-editing-problem',
    ],
  );
});

test('no testimonials and no metrics: numbers from the proof list, references from publications', () => {
  const input = without((raw) => ({
    ...raw,
    sections: sections(raw).filter(
      (s) => s.id !== 'at-a-glance' && s.id !== 'words-from-collaborators',
    ),
  }));
  // The proof list holds two metrics, so panel 3 stands, on an id of its own.
  assert.equal(numbersOf(input)?.section, undefined);
  assert.deepEqual(
    numbersOf(input)?.figures.map((entry) => entry.id),
    ['tenure-years', 'services-owned'],
  );
  assert.equal(planOf(input).panels[2]?.anchor, 'sg-numbers');
  assert.equal(referencesOf(input)?.id, 'publications');
  const none = without((raw) => ({
    ...raw,
    proof: [],
    sections: sections(raw).filter((s) => s.id !== 'at-a-glance'),
  }));
  assert.equal(numbersOf(none), undefined);
  assert.equal(keys(none).includes('numbers'), false);
});

test('one work, text only: no more-work panel, the counter renumbers, no frame for a missing cover', () => {
  const input = inputOf({
    identity: { name: 'Rowan Vale', email: 'rowan@vale.test' },
    works: [{ id: 'only', title: 'The Only Thing', medium: 'writing', summary: 'A long essay.' }],
    sections: [
      { kind: 'hero', id: 'top', tagline: 'I write slowly.' },
      { kind: 'works', id: 'work', title: 'Work', items: ['only'] },
      { kind: 'contact', id: 'contact' },
    ],
    contact: { message: 'Write to me.' },
  });
  assert.deepEqual(keys(input), ['who', 'best', 'contact']);
  assert.deepEqual(grounds(input), ['canvas', 'inverse', 'accent']);
  assert.equal(planOf(input).panels.at(-1)?.n, 3);
  // The works section only repeats panel 2: a back-pointer in the record.
  assert.deepEqual(backPointer(planOf(input).record[0]!, input)?.where, ['best']);
  // With nowhere of its own to go, panel 2's action is the next panel.
  assert.deepEqual(actionOf(input, planOf(input).panels[1]!)?.target, {
    kind: 'anchor',
    anchor: 'contact',
  });
});

// ───────────── the N4 fixtures ─────────────

test('N4: one artifact, no proof, no thesis, no chronology, no media', () => {
  const input = inputOf({
    identity: { name: 'Sam Ito', tagline: 'Furniture maker' },
    works: [{ id: 'chair', title: 'Chair', medium: 'object' }],
    sections: [{ kind: 'works', id: 'w', items: ['chair'] }],
  });
  const who = whoOf(input);
  // No thesis and no hero: the identity's tagline is the line, and there's no lede.
  assert.equal(who.line, 'Furniture maker');
  assert.equal(who.lede, undefined);
  assert.deepEqual(who.aside, []);
  assert.equal(currentRole(input), undefined);
  assert.deepEqual(keys(input), ['who', 'best']);
  // With no email and no contact, the last panel's action goes to the record.
  assert.equal(actionOf(input, planOf(input).panels[1]!)?.label, 'See the record');
  const bare = inputOf({ identity: { name: 'Sam Ito' } });
  assert.deepEqual(keys(bare), ['who']);
  assert.equal(whoOf(bare).line, undefined);
  assert.equal(actionOf(bare, planOf(bare).panels[0]!), undefined);
});

test('N4: a long name, a non-Latin name, right to left', () => {
  const long = inputOf({ identity: { name: 'Maximiliana Oyelaran-Featherstonehaugh de la Cruz' } });
  assert.equal(planOf(long).panels[0]?.key, 'who');
  const rtl = inputOf({
    locale: 'ar',
    direction: 'rtl',
    identity: { name: 'ليلى حداد', email: 'layla@haddad.test' },
    practice: { thesis: 'أبني أدوات هادئة. تدوم طويلاً.' },
    sections: [
      { kind: 'practice', id: 'thesis', part: 'thesis' },
      { kind: 'contact', id: 'contact' },
    ],
    contact: { message: 'اكتبي لي.' },
  });
  assert.equal(whoOf(rtl).line, 'أبني أدوات هادئة.');
  const contact = planOf(rtl).panels.at(-1)!;
  assert.equal(actionOf(rtl, contact)?.object, 'ليلى حداد');
  assert.equal(firstSentence('मैं धीरे लिखती हूँ। फिर भी।').lead, 'मैं धीरे लिखती हूँ।');
  assert.equal(firstSentence('静かな道具を作る。長く使える。').lead, '静かな道具を作る。');
  assert.equal(lengthClass('I make failure legible.'), 'short');
});

// ───────────── the parts ─────────────

test('a figure’s row drops a unit its statement starts with, and keeps it otherwise', () => {
  const folded = figureRow(
    {
      id: 'y',
      type: 'metric',
      statement: 'Years building',
      metric: { value: 9, unit: 'years' },
    } as never,
    'en',
  );
  assert.equal(folded.unit, undefined);
  const kept = figureRow(
    {
      id: 's',
      type: 'metric',
      statement: 'Of studios renew',
      metric: { value: 92, unit: '%' },
    } as never,
    'en',
  );
  assert.equal(kept.unit, '%');
  assert.equal(
    figureRow(
      { id: 'n', type: 'metric', statement: 'Requests', metric: { value: 1200000 } } as never,
      'en',
    ).value,
    '1,200,000',
  );
});

test('proofOf: highlights first, else the cited evidence’s titles, at most three', () => {
  const input = inputOf({
    evidence: [
      { id: 'a', type: 'award', title: 'Best tool' },
      { id: 'b', type: 'press', title: 'In the paper' },
    ],
  });
  assert.deepEqual(
    proofOf(input, {
      id: 'w',
      title: 'W',
      medium: 'software',
      highlights: ['1', '2', '3', '4'],
    } as never),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    proofOf(input, { id: 'w', title: 'W', medium: 'software', evidence: ['b', 'a'] } as never),
    ['In the paper', 'Best tool'],
  );
});

test('a contact section with no record, email or link plans no panel, and its calls to action stay in the record (P1 review S5)', () => {
  const input = without((raw) => {
    const identity = { ...(raw.identity as Record<string, unknown>) };
    delete identity.email;
    const out: Raw = { ...raw, identity, links: [] };
    delete out.contact;
    return out;
  });
  const plan = planOf(input);
  assert.deepEqual(keys(input), ['who', 'best', 'numbers', 'more', 'refs']);
  assert.equal(plan.panels.at(-1)?.n, plan.panels.length);
  // Nothing points at the missing panel: the references band goes on to the record.
  const refs = plan.panels.find((panel) => panel.key === 'refs')!;
  assert.notDeepEqual(actionOf(input, refs)?.target, { kind: 'anchor', anchor: 'contact' });
  assert.ok(plan.record.some((section) => section.kind === 'cta'));
});

test('a hero call to action at /#id or /path is this site’s: down the page or to its own page, never named by a raw URL (P1 delta S4)', () => {
  const at = (url: string) => {
    const input = without((raw) => {
      for (const section of sections(raw) as { kind: string; ctas?: { url: string }[] }[]) {
        if (section.kind === 'hero' && section.ctas?.[0]) section.ctas[0].url = url;
      }
      return raw;
    });
    const controlled = { ...input, controls: { heroAction: 'cta' } } as ModelInput;
    return actionOf(controlled, planOf(controlled).panels[0]!)!;
  };
  const home = at('/#experience');
  assert.equal(home.dir, 'down');
  assert.deepEqual(home.target, { kind: 'url', url: '/#experience' });
  assert.equal(home.dest?.own, true);
  assert.doesNotMatch(home.dest?.text ?? '', /#/);
  const page = at('/work/postmortem-template-kit');
  assert.equal(page.dest, undefined);
  const away = at('https://anamika.example.com/cv.pdf');
  assert.equal(away.dir, 'out');
  assert.deepEqual(away.dest, { text: 'anamika.example.com', own: true });
});

// ───────────── the case page's stops (P2) ─────────────

type CaseWork = Work & { readonly caseStudy: CaseFields };

/** The sample's case-study work, changed by `change`. */
function caseWork(change: (work: Record<string, unknown>) => void = () => {}): CaseWork {
  const raw = structuredClone(SAMPLE) as Raw & { works: Record<string, unknown>[] };
  const work = raw.works.find((each) => each.id === 'postmortem-template-kit')!;
  change(work);
  return work as unknown as CaseWork;
}
const stopKeys = (work: CaseWork) => caseStopsOf(work).map((stop) => stop.key);

test('the case stops: the sample has all six, paper and ink by position, the accent last', () => {
  const stops = caseStopsOf(caseWork());
  assert.deepEqual(
    stops.map((stop) => stop.key),
    ['brief', 'exhibit', 'problem', 'choices', 'result', 'hindsight'],
  );
  assert.deepEqual(
    stops.map((stop) => stop.ground),
    ['canvas', 'inverse', 'canvas', 'inverse', 'canvas', 'accent'],
  );
  assert.deepEqual(
    stops.map((stop) => stop.band),
    ['inverse', 'canvas', 'inverse', 'canvas', 'inverse', 'inverse'],
  );
  assert.deepEqual(
    stops.map((stop) => stop.n),
    [1, 2, 3, 4, 5, 6],
  );
});

test('the case stops: no cover and no media, no Exhibit; the counter renumbers', () => {
  const work = caseWork((raw) => {
    delete raw.cover;
    delete raw.media;
  });
  assert.deepEqual(stopKeys(work), ['brief', 'problem', 'choices', 'result', 'hindsight']);
  assert.equal(caseStopsOf(work).at(-1)?.n, 5);
});

test('the case stops: no decisions, constraints or role, no Choices; constraints alone keep it, a role too', () => {
  const none = caseWork((raw) => {
    const study = raw.caseStudy as Record<string, unknown>;
    delete study.decisions;
    delete study.constraints;
    delete study.role;
  });
  assert.ok(!stopKeys(none).includes('choices'));
  const within = caseWork((raw) => {
    const study = raw.caseStudy as Record<string, unknown>;
    delete study.decisions;
    study.constraints = 'Two weeks, one team.';
  });
  assert.ok(stopKeys(within).includes('choices'));
  const role = caseWork((raw) => {
    raw.caseStudy = { role: 'I led it.' };
  });
  assert.deepEqual(stopKeys(role), ['brief', 'exhibit', 'choices']);
});

test('the case stops: no reflection, no Hindsight, and the accent moves to the last stop there is', () => {
  const work = caseWork((raw) => {
    delete (raw.caseStudy as Record<string, unknown>).reflection;
  });
  const stops = caseStopsOf(work);
  assert.ok(!stops.some((stop) => stop.key === 'hindsight'));
  assert.equal(stops.at(-1)?.ground, 'accent');
  assert.equal(stops.filter((stop) => stop.ground === 'accent').length, 1);
});

test('the case stops: a study with only a reflection is Brief, then Hindsight on the accent', () => {
  const work = caseWork((raw) => {
    delete raw.cover;
    delete raw.media;
    raw.caseStudy = { reflection: 'I would start with the template.' };
  });
  assert.deepEqual(stopKeys(work), ['brief', 'hindsight']);
  assert.deepEqual(
    caseStopsOf(work).map((stop) => stop.ground),
    ['canvas', 'accent'],
  );
});

test('the case bands: each leads to the next stop by name, the last back to the portfolio’s More work', () => {
  const input = sample();
  const stops = caseStopsOf(caseWork());
  const actions = stops.map((stop) => caseActionOf(stops, stop, input));
  assert.deepEqual(
    actions.slice(0, -1).map((action) => action.target),
    stops.slice(1).map((stop) => ({ kind: 'anchor', anchor: stop.anchor })),
  );
  assert.equal(actions[0]?.label, 'See the work');
  const last = actions.at(-1)!;
  assert.equal(last.label, 'Back to the portfolio');
  assert.equal(last.dir, 'out');
  assert.deepEqual(last.target, { kind: 'url', url: '/#sg-more-work' });
  // One stop only (every case-study field makes a stop, so only a list of one): its band goes down to the Notes.
  const alone = stops.slice(0, 1);
  assert.equal(caseActionOf(alone, alone[0]!, input).label, 'Read the notes');
  assert.deepEqual(caseActionOf(alone, alone[0]!, input).target, {
    kind: 'anchor',
    anchor: 'sg-case-notes',
  });
});

// ───────────── the record's folds (P2) ─────────────

test('a closed row says what it holds: counts in the composition’s words, prose as the owner’s first sentence, or nothing', () => {
  const input = sample();
  const line = (id: string) =>
    foldLineOf(input.portfolio.sections.find((section) => section.id === id) as Section, input);
  assert.deepEqual(line('experience'), { kind: 'count', text: '4 entries, 2014 to now' });
  assert.deepEqual(line('talks'), { kind: 'count', text: '3 talks' });
  const about = line('about');
  assert.equal(about?.kind, 'prose');
  // The owner's words, Markdown reduced, the first sentence only.
  assert.match(
    about!.text,
    /^I work at the messy intersection of distributed systems and organizational psychology/,
  );
  assert.ok(!about!.text.includes('**'));
  assert.ok(about!.text.endsWith('.'));
  // A row with nothing to count and no prose shows the plus alone.
  assert.equal(line('on-github'), undefined);
  // No row says "Read it" (the lead's ruling, item 2).
  for (const section of planOf(input).record) {
    assert.notEqual(foldLineOf(section, input)?.text, 'Read it');
  }
});
