import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationUnit } from '@portfolio/schema';
import { contractValidators } from '@portfolio/variant-contract';
import { DEFAULT_VISITOR_CONTROLS, validateAppearance } from './index';
import { testRegistry, VARIANTS } from './test-support/packs';

const registry = testRegistry();

const PORTFOLIO = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Fixture' },
  sections: [
    { kind: 'lede', id: 'about', title: 'About', body: 'Builds calm software.' },
    { kind: 'lede', id: 'notes', title: 'Notes', body: 'Short notes.' },
  ],
};

const APPEARANCE = {
  variant: 'acme-gallery',
  designLanguage: 'platform-neutral',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  displayMode: 'system',
};

function site(extra: Record<string, unknown> = {}, appearance: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    appearance: { ...APPEARANCE, ...appearance },
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    features: { feed: true },
    ...extra,
  };
}

/** The pair checked the way the host will check it: #5's validators, then this one. */
function check(
  siteDocument: Record<string, unknown>,
  {
    live = false,
    portfolio = PORTFOLIO,
  }: { live?: boolean; portfolio?: Record<string, unknown> } = {},
) {
  const result = validatePublicationUnit(
    {
      portfolio: { text: JSON.stringify(portfolio), format: 'json', name: 'portfolio.json' },
      site: { text: JSON.stringify(siteDocument), format: 'json', name: 'site.json' },
    },
    {
      validators: [
        ...contractValidators(VARIANTS, { live }),
        validateAppearance(registry, { live }),
      ],
    },
  );
  return {
    ...result,
    records: result.diagnostics.map(({ code, severity, document, pointer }) => [
      code,
      severity,
      document,
      pointer,
    ]),
  };
}

test('a registered selection passes, and every appearance entry is checked', () => {
  const result = check(site());
  assert.deepEqual(result.records, []);
  assert.ok(result.pair);
  assert.deepEqual(
    result.notChecked.filter((entry) => entry.startsWith('site.appearance')),
    [],
  );
});

test('an unregistered pack blocks publish, and only warns on the live pair', () => {
  const unavailable = check(site({}, { designLanguage: 'missing-pack' }));
  assert.deepEqual(unavailable.records, [
    ['appearance.unavailable', 'blocks-publish', 'site', '/appearance/designLanguage'],
  ]);
  assert.match(
    unavailable.diagnostics[0]!.message,
    /^\/appearance\/designLanguage names a design language this build doesn't register\. Preview shows platform-neutral in its place\.$/,
  );
  assert.ok(unavailable.pair, 'preview still renders');
  const live = check(site({}, { designLanguage: 'missing-pack' }), { live: true });
  assert.deepEqual(live.records, [
    ['appearance.unavailable', 'warning', 'site', '/appearance/designLanguage'],
  ]);
});

test('a Research pack is not publishable, and preview renders it', () => {
  for (const live of [false, true]) {
    const result = check(site({}, { colorScheme: 'fixture-research' }), { live });
    assert.deepEqual(result.records, [
      ['appearance.not-publishable', 'blocks-publish', 'site', '/appearance/colorScheme'],
    ]);
    assert.ok(result.pair);
  }
});

test('an id registered on another axis is schema.invalid, and blocks preview', () => {
  const scheme = check(site({}, { colorScheme: 'platform-neutral' }));
  assert.deepEqual(scheme.records, [
    ['schema.invalid', 'blocks-preview', 'site', '/appearance/colorScheme'],
  ]);
  assert.equal(scheme.pair, null);
  assert.match(
    scheme.diagnostics[0]!.message,
    /names a design language this build registers, not a color scheme/,
  );
  const variant = check(site({}, { variant: 'humanist-ui' }));
  assert.deepEqual(variant.records, [
    ['schema.invalid', 'blocks-preview', 'site', '/appearance/variant'],
    ['variant.unavailable', 'blocks-publish', 'site', '/appearance/variant'],
  ]);
});

test('an explicit mode the scheme lacks is mode-incompatible; system and high contrast never are', () => {
  const result = check(site({}, { colorScheme: 'fixture-dark-only', displayMode: 'light' }), {
    live: true,
  });
  assert.deepEqual(result.records, [
    ['appearance.mode-incompatible', 'blocks-publish', 'site', '/appearance/displayMode'],
  ]);
  for (const displayMode of ['system', 'dark', 'high-contrast']) {
    assert.deepEqual(
      check(site({}, { colorScheme: 'fixture-dark-only', displayMode })).records,
      [],
      displayMode,
    );
  }
});

test('a generator scheme needs a valid appearanceInputs entry', () => {
  assert.deepEqual(check(site({}, { colorScheme: 'fixture-seed' })).records, [
    ['appearance.input-missing', 'blocks-publish', 'site', '/appearance/colorScheme'],
  ]);
  assert.deepEqual(
    check(
      site(
        { appearanceInputs: { 'fixture-seed': { sourceAsset: 'hero' } } },
        { colorScheme: 'fixture-seed' },
      ),
    ).records,
    [['appearance.input-missing', 'blocks-publish', 'site', '/appearanceInputs/fixture-seed']],
  );
  assert.deepEqual(
    check(
      site(
        { appearanceInputs: { 'fixture-seed': { seedColor: '#3366ff' } } },
        { colorScheme: 'fixture-seed' },
      ),
    ).records,
    [],
  );
  assert.deepEqual(
    check(
      site(
        { appearanceInputs: { 'fixture-asset': { sourceAsset: 'hero' } } },
        { colorScheme: 'fixture-asset' },
      ),
    ).records,
    [],
  );
});

test('every appearanceInputs entry is keyed by a generator scheme, or goes unchecked', () => {
  const result = check(
    site({
      appearanceInputs: {
        'warm-parchment': { seedColor: '#3366ff' },
        'platform-neutral': { seedColor: '#3366ff' },
        'fixture-asset': { seedColor: '#3366ff' },
        'acme-sunrise': { seedColor: '#3366ff' },
      },
    }),
  );
  assert.deepEqual(result.records, [
    ['appearance.input-missing', 'blocks-publish', 'site', '/appearanceInputs/fixture-asset'],
    ['schema.invalid', 'blocks-preview', 'site', '/appearanceInputs/platform-neutral'],
    ['schema.invalid', 'blocks-preview', 'site', '/appearanceInputs/warm-parchment'],
  ]);
  assert.ok(result.notChecked.includes('site.appearanceInputs.acme-sunrise'));
  assert.ok(!result.notChecked.includes('site.appearanceInputs.warm-parchment'));
});

test("the content's scripts are checked against the typography profile, visible sections only", () => {
  const portfolio = {
    ...PORTFOLIO,
    locale: 'ru',
    sections: [
      { ...PORTFOLIO.sections[0], lang: 'ja' },
      { ...PORTFOLIO.sections[1], lang: 'el' },
      { kind: 'lede', id: 'english', title: 'English', body: 'Hello.', lang: 'en-GB' },
    ],
  };
  const hidden = site({ sections: { notes: { hidden: true } } });
  const result = check(hidden, { portfolio });
  assert.deepEqual(result.records, [
    ['appearance.script-coverage', 'warning', 'portfolio', '/locale'],
    ['appearance.script-coverage', 'warning', 'portfolio', '/sections/0/lang'],
  ]);
  const [locale, japanese] = result.diagnostics;
  assert.match(
    locale!.message,
    /^\/locale is written in the Cyrl script, which humanist-ui doesn't cover/,
  );
  assert.equal(
    locale!.remediation,
    'Select a typography profile that covers Cyrl: multilingual-system.',
  );
  assert.match(japanese!.message, /Jpan script/);
  assert.equal(japanese!.stableId, 'about');
  // A record in another script is checked too, where a visible section shows it (#10), and
  // not when it's private or only a hidden section lists it.
  const records = {
    ...PORTFOLIO,
    works: [
      { id: 'tokyo-notes', title: '東京', medium: 'writing', lang: 'ja' },
      {
        id: 'private-notes',
        title: 'Ιδιωτικό',
        medium: 'writing',
        lang: 'el',
        visibility: 'private',
      },
      { id: 'draft-notes', title: 'Черновик', medium: 'writing', lang: 'ru' },
    ],
    sections: [
      ...PORTFOLIO.sections,
      { kind: 'works', id: 'essays', items: ['tokyo-notes', 'private-notes'] },
      { kind: 'works', id: 'drafts', items: ['draft-notes'] },
    ],
  };
  assert.deepEqual(
    check(site({ sections: { drafts: { hidden: true } } }), { portfolio: records }).records.filter(
      ([code]) => code === 'appearance.script-coverage',
    ),
    [['appearance.script-coverage', 'warning', 'portfolio', '/works/0/lang']],
  );
  // A profile covering every part of a script covers it.
  assert.deepEqual(
    check(
      { ...hidden, appearance: { ...APPEARANCE, typography: 'multilingual-system' } },
      { portfolio },
    ).records,
    [],
  );
});
