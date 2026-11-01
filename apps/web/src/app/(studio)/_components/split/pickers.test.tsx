import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compositionStatus } from '@portfolio/variant-contract/status';
import type { AppearanceCatalog } from '~/lib/studio/appearance';
import { STUDIO_THUMBNAILS } from '~/lib/generated/registry.thumbnails';
import { ALL } from '~/lib/studio/catalog-filter';
import { compositionOptions } from '~/lib/studio/picker-catalog';
import { appearanceCatalog } from '~/server/studio-appearance';
import {
  AxisPicker,
  compositionView,
  CompositionThumbnail,
  LanguageSpecimen,
  loudness,
  modeLine,
  paletteOf,
  readyCount,
  RecipeStrip,
  SchemeChip,
  scrollEdges,
  stepOption,
  TypeSpecimen,
} from './pickers';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The Appearance pickers (owner direction, 2026-10-25; the dossier's 3.2 and
// the Studio mockup's rail): every option a specimen of itself, drawn with
// the other axes' current values, as an APG radio group, with no native
// select for an axis, and what an option is behind its info disclosure.

const option = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: `About ${name}.`,
  tier: 'stable',
  provenance: ['First party'],
  performance: '2 KB of CSS',
  access: null,
  status: 'ready' as const,
  statusLabel: null,
  ...extra,
});

const CATALOG: AppearanceCatalog = {
  axes: [
    {
      axis: 'variant',
      label: 'Composition',
      fallback: 'fallback',
      options: [
        // Each composition's signature is its manifest's studio.signature, through the catalog.
        option('editorial-evidence', 'Editorial Evidence', { signature: 'Margin index' }),
        option('spatial-bento', 'Spatial Bento', { signature: 'Tile field' }),
      ],
    },
    {
      axis: 'colorScheme',
      label: 'Color scheme',
      fallback: 'paper-ink',
      options: [
        option('arctic-aurora', 'Arctic Aurora', {
          specimen: {
            kind: 'scheme',
            light: { canvas: '#f1f8fb', text: '#16323c', accent: '#2e8fa3', secondary: '#8b63b8' },
            dark: { canvas: '#0b1d28', text: '#e7fbff', accent: '#59d6cb', secondary: '#c18beb' },
            swatches: [],
            modes: ['light', 'dark'],
          },
        }),
      ],
    },
    {
      axis: 'typography',
      label: 'Typography',
      fallback: 'neutral-ui',
      options: [
        option('editorial-serif', 'Editorial Serif', {
          specimen: {
            kind: 'type',
            display: 'Georgia, serif',
            body: 'Charter, serif',
            displayWeight: '700',
            style: 'serif',
            source: 'system',
            stills: null,
          },
        }),
      ],
    },
    {
      axis: 'designLanguage',
      label: 'Design language',
      fallback: 'platform-neutral',
      options: [
        option('neobrutalist', 'Neobrutalist', {
          specimen: {
            kind: 'language',
            radiusControl: '4px',
            radiusCard: '8px',
            borderControl: '3px solid',
            borderCard: '3px solid',
            shadowCard: '5px 5px 0 var(--color-border-strong)',
          },
        }),
        option('glassmorphism', 'Glassmorphism', { tier: 'experimental' }),
      ],
    },
    {
      axis: 'displayMode',
      label: 'Display mode',
      fallback: 'system',
      options: [option('system', 'System'), option('dark', 'Dark')],
    },
  ],
};

const picker = (axis: AppearanceCatalog['axes'][number]['axis'], value: string) =>
  renderToStaticMarkup(
    <AxisPicker
      axis={axis}
      catalog={CATALOG}
      label={`${axis} the site shows`}
      value={value}
      unoffered={(fallback) => `This build doesn't offer it, so ${fallback} shows.`}
      onChange={() => {}}
    />,
  );

/** Each native radio in `html`, by its option: its group's name, whether it's checked or off, and its name. */
const radiosIn = (html: string) =>
  [...html.matchAll(/data-option="([^"]+)"><input type="radio" ([^>]*)\/>/g)].map(
    ([, id, attrs]) => ({
      id: id!,
      group: /name="([^"]+)"/.exec(attrs!)?.[1],
      checked: /checked=""/.test(attrs!),
      disabled: /disabled=""/.test(attrs!),
      label: /aria-label="([^"]+)"/.exec(attrs!)?.[1],
    }),
  );

/** The radio group's own markup in `html`, from its open tag to the div that closes it. */
const groupOf = (html: string) => {
  const start = html.indexOf('<div role="radiogroup"');
  assert.notEqual(start, -1, 'a radio group');
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<(\/?)div\b/g)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index! + '</div>'.length);
  }
  throw new Error('the radio group never closes');
};

/** What Tab stops at besides a radio: a button, a disclosure, a link, a field or a tabindex. */
const OTHER_STOP = /<(button|summary|a|select|textarea)\b|<input(?![^>]*type="radio")|tabindex="0"/;

test('no axis is a native select: each is a radio group with one Tab stop, the checked option', () => {
  for (const { axis, options } of CATALOG.axes) {
    const html = picker(axis, options[0]!.id);
    assert.doesNotMatch(html, /<select/, axis);
    assert.equal((html.match(/role="radiogroup"/g) ?? []).length, 1, axis);
    // One checked, so the browser's one Tab stop is it, and every input of the group shares a name.
    assert.equal((html.match(/checked=""/g) ?? []).length, 1, axis);
    const radios = radiosIn(html);
    assert.equal(new Set(radios.map(({ group }) => group)).size, 1, axis);
    assert.equal(radios.find(({ checked }) => checked)?.id, options[0]!.id, axis);
    // Nothing else in the group takes Tab, so one press leaves it (the APG radio group).
    assert.doesNotMatch(groupOf(html), OTHER_STOP, axis);
  }
});

test('a composition is a 16:10 drawing of its structure in the current scheme, in SVG with no frame and no text', () => {
  const ids = [
    'editorial-evidence',
    'kinetic-cosmos',
    'obsidian-atelier',
    'spatial-bento',
    'horizontal-cinema',
  ];
  for (const id of ids) {
    const html = renderToStaticMarkup(<CompositionThumbnail id={id} />);
    assert.match(
      html,
      new RegExp(
        `^<svg class="studio-thumb" data-composition="${id}" viewBox="0 0 136 85" preserveAspectRatio="xMidYMid slice" aria-hidden="true"`,
      ),
    );
    assert.doesNotMatch(html, /iframe|<img/);
    // A picture, not words: its headline is a bar, so nothing in it reads as text at 6px
    // or has a contrast to fail.
    assert.doesNotMatch(html, /<text/);
  }
  // Each composition draws its own, so no two thumbnails are the same.
  const drawn = new Set(
    ids.map((id) =>
      renderToStaticMarkup(<CompositionThumbnail id={id} />).replace(
        /data-composition="[^"]+"/,
        '',
      ),
    ),
  );
  assert.equal(drawn.size, 5);
  // The picker draws them in the current scheme's ground and ink.
  const html = renderToStaticMarkup(
    <AxisPicker
      axis="variant"
      catalog={CATALOG}
      label="Composition"
      value="editorial-evidence"
      selection={{
        colorScheme: 'arctic-aurora',
        typography: 'editorial-serif',
        displayMode: 'dark',
      }}
      unoffered={() => null}
      onChange={() => {}}
    />,
  );
  assert.match(html, /<rect x="0" y="0" width="136" height="85" fill="#0b1d28">/);
  // Editorial's headline bar runs across the measure, in the scheme's ink.
  assert.match(
    html,
    /<rect x="5" y="14.22" width="126.00" height="11.78" rx="1.52" fill="#e7fbff">/,
  );
  assert.match(html, /class="studio-choice__sub">Margin index</);
  assert.equal(paletteOf(CATALOG, { colorScheme: 'arctic-aurora' }).canvas, '#f1f8fb');
});

test('a scheme is a split chip on its own light and dark grounds, its name under it, under a search and the character chips; a typography pack is set in its own stacks', () => {
  const chip = renderToStaticMarkup(
    <SchemeChip specimen={CATALOG.axes[1]!.options[0]!.specimen ?? null} />,
  );
  assert.match(chip, /background:#f1f8fb;color:#16323c/);
  assert.match(chip, /background:#0b1d28;color:#e7fbff/);
  assert.equal((chip.match(/>Aa</g) ?? []).length, 2);
  const schemes = picker('colorScheme', 'arctic-aurora');
  // The current one's name is the index row's (round 5b), so no readout repeats it here: each
  // chip carries its own name under it.
  assert.doesNotMatch(schemes, /studio-readout/);
  assert.match(schemes, /class="studio-choice__label studio-scheme__name">Arctic Aurora</);
  assert.match(schemes, /placeholder="Find a scheme, like sage or night"/);
  assert.match(schemes, /role="switch" class="studio-toggle" aria-checked="false"/);
  assert.match(schemes, /aria-label="Arctic Aurora, light and dark"/);
  const type = renderToStaticMarkup(
    <TypeSpecimen specimen={CATALOG.axes[2]!.options[0]!.specimen ?? null} />,
  );
  assert.match(type, /font-family:Georgia, serif;font-weight:700">Aa</);
  assert.match(
    picker('typography', 'editorial-serif'),
    /font-family:Charter, serif">I make failure legible\.</,
  );
});

test('the design languages have a search, a quiet-to-loud count, real geometry, and a tier beside each that is not stable', () => {
  const html = picker('designLanguage', 'neobrutalist');
  assert.match(
    html,
    /<input id="[^"]+" class="studio-search__input" type="search" placeholder="Find a language, like brutalist"/,
  );
  // Quiet to loud is said once, in the panel's line (A P2-4); the picker lists, under All, a run
  // a family, each with its count, and a family view says how many of all it holds.
  assert.doesNotMatch(html, /Quiet to loud/);
  const all = renderToStaticMarkup(
    <AxisPicker
      axis="designLanguage"
      catalog={appearanceCatalog()}
      label="Design language"
      value="no-such-language"
      onChange={() => {}}
      unoffered={() => null}
    />,
  );
  assert.deepEqual(
    [
      ...all.matchAll(
        /class="studio-group__name">([A-Za-z ]+?) <span class="studio-group__count">/g,
      ),
    ].map(([, name]) => name),
    ['Quiet', 'Product systems', 'Expressive', 'Raw', 'Retro'],
  );
  // A tier is never a tag on the row, where it took the name's room (P1-1): it's the About's,
  // in words an owner reads.
  assert.doesNotMatch(html, /studio-choice__tier/);
  assert.match(
    picker('designLanguage', 'glassmorphism'),
    /<dt>Tier<\/dt><dd>Experimental: held to the same contract as the stable ones<\/dd>/,
  );
  // Quiet first: the glass card with no tokens before the hard-shadowed, heavy-bordered one.
  assert.ok(
    html.indexOf('data-option="glassmorphism"') < html.indexOf('data-option="neobrutalist"'),
  );
  const loud = CATALOG.axes[3]!.options[0]!.specimen ?? null;
  assert.ok(loudness(loud) > loudness(null));
  const language = renderToStaticMarkup(<LanguageSpecimen specimen={loud} />);
  // The card corner at true scale (A P2-D), on a card twice the specimen, cropped to it.
  assert.match(language, /width:7\.5rem;height:5rem/, 'a card larger than its window');
  assert.match(language, /border-radius:8px/, 'the card radius at true scale');
  assert.match(language, /border:3px solid/, 'a border at its own weight, up to 3px');
  assert.match(
    language,
    /box-shadow:5px 5px 0 #1d1d1f/,
    "a hard shadow at true scale, in the scheme's text",
  );
  // The control is a miniature: its height and radius at the same fraction of the real one.
  assert.match(
    language,
    /height:12\.8px;width:[\d.]+px;border:3px solid #[0-9a-f]{6};border-radius:1\.3px/,
  );
  // A 3px corner stays 3px, never squared off as 0.6 made it (Letterpress against Minimal Flat).
  const letterpress = renderToStaticMarkup(
    <LanguageSpecimen specimen={{ ...(loud as object), radiusCard: '3px' } as never} />,
  );
  assert.match(letterpress, /border-radius:3px/);
});

test('the display mode is a segmented control, a mode the scheme lacks disabled with the reason under it', () => {
  assert.equal(
    modeLine('Arctic Aurora', ['light', 'dark']),
    'Arctic Aurora has light and dark sets, so every mode is available.',
  );
  assert.equal(modeLine('Night', ['dark']), "Night has only a dark set, so Light isn't available.");
  const catalog: AppearanceCatalog = {
    axes: CATALOG.axes.map((entry) =>
      entry.axis === 'displayMode'
        ? {
            ...entry,
            options: [option('system', 'System'), option('light', 'Light'), option('dark', 'Dark')],
          }
        : entry.axis === 'colorScheme'
          ? {
              ...entry,
              options: [
                option('night', 'Night', {
                  specimen: {
                    kind: 'scheme',
                    light: null,
                    dark: {
                      canvas: '#000000',
                      text: '#ffffff',
                      accent: '#ff0000',
                      secondary: '#00ff00',
                    },
                    swatches: [],
                    modes: ['dark'],
                  },
                }),
              ],
            }
          : entry,
    ),
  };
  const html = renderToStaticMarkup(
    <AxisPicker
      axis="displayMode"
      catalog={catalog}
      label="Display mode"
      value="dark"
      selection={{ colorScheme: 'night' }}
      unoffered={() => null}
      onChange={() => {}}
    />,
  );
  assert.equal(radiosIn(html).find(({ id }) => id === 'light')?.disabled, true);
  assert.match(html, /Night has only a dark set, so Light isn&#x27;t available\./);
});

test("a composition's thumbnail is its package's own drawing, and one with no ./studio-thumbnail gets the generic plate", () => {
  const palette = paletteOf(CATALOG, { colorScheme: 'arctic-aurora', displayMode: 'dark' });
  const generic = renderToStaticMarkup(
    <CompositionThumbnail id="acme-undrawn" palette={palette} />,
  );
  // The generic plate: a headline over three lines, in the palette, under the same <svg>.
  assert.match(
    generic,
    /^<svg class="studio-thumb" data-composition="acme-undrawn" viewBox="0 0 136 85"/,
  );
  assert.match(generic, /<rect x="10" y="32" width="90" height="3" fill="[^"]+"><\/rect>/);
  assert.equal((generic.match(/<rect /g) ?? []).length, 5);
  // Each variant that exports one is drawn by it, and differs from the generic plate.
  const drawn = Object.keys(STUDIO_THUMBNAILS);
  assert.ok(drawn.length > 0, 'the first-party compositions draw their own');
  const drawing = (html: string) => html.replace(/^<svg[^>]*>/, '');
  for (const id of drawn) {
    const own = renderToStaticMarkup(<CompositionThumbnail id={id} palette={palette} />);
    assert.equal(
      drawing(own),
      drawing(renderToStaticMarkup(<svg>{STUDIO_THUMBNAILS[id]!(palette)}</svg>)),
      id,
    );
    assert.notEqual(drawing(own), drawing(generic), id);
  }
  // A registered variant with no export, such as one still in progress, is not in the map.
  const registered = appearanceCatalog().axes.find((entry) => entry.axis === 'variant')!.options;
  for (const { id } of registered.filter(({ id }) => !drawn.includes(id))) {
    assert.equal(STUDIO_THUMBNAILS[id], undefined, id);
  }
});

test("the rail's count is the options that can be picked, by their status, so one counts once it's signed off (S2)", () => {
  assert.equal(readyCount([{ id: 'a' }, { id: 'b', status: 'ready' }]), 2);
  assert.equal(
    readyCount([
      { id: 'a', status: 'ready' },
      { id: 'b', status: 'pending' },
    ]),
    1,
  );
  assert.equal(readyCount([]), 0);
  // The build's compositions: as many as the contract's status calls ready, whichever they are.
  const compositions = appearanceCatalog().axes.find((entry) => entry.axis === 'variant')!.options;
  assert.equal(
    readyCount(compositions),
    compositions.filter(({ id }) => compositionStatus(id) !== 'pending').length,
  );
});

test('previous and next step through an axis and wrap; a recipe card names what it applies', () => {
  const options = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(stepOption(options, 'a', 1), 'b');
  assert.equal(stepOption(options, 'c', 1), 'a');
  assert.equal(stepOption(options, 'a', -1), 'c');
  assert.equal(stepOption(options, 'missing', 1), 'a');
  assert.equal(stepOption([], 'a', 1), null);
  const strip = renderToStaticMarkup(
    <RecipeStrip
      id="strip"
      catalog={CATALOG}
      recipes={[
        {
          id: 'night',
          name: 'Night Reading',
          description: '',
          selection: {
            variant: 'spatial-bento',
            designLanguage: 'neobrutalist',
            colorScheme: 'arctic-aurora',
            typography: 'editorial-serif',
            displayMode: 'dark',
          },
        },
      ]}
      onApply={() => {}}
      onSurprise={() => {}}
    />,
  );
  // Its name starts with what it shows: the recipe, its composition, then its scheme and type.
  assert.match(
    strip,
    />Night Reading<\/span><span class="studio-recipe__meta">Arctic Aurora<span class="studio-recipe__type">, Editorial Serif<\/span><\/span><span class="studio-visually-hidden">, Spatial Bento<\/span>/,
  );
  assert.match(strip, /fill="#0b1d28"/, "drawn in the recipe's own scheme and mode");
  assert.match(
    strip,
    />Surprise me<\/span><span class="studio-surprise__hint">a recipe, keeping pinned axes</,
  );
});

test("what an option is sits behind its info disclosure, and a value the build doesn't offer shows first with what renders instead", () => {
  const html = picker('variant', 'editorial-evidence');
  assert.match(
    html,
    /<details class="studio-info" data-axis="variant"><summary class="studio-info__summary"><svg[^>]*>.*?<\/svg><span>About Editorial Evidence<\/span>/,
  );
  const missing = picker('variant', 'missing-variant');
  assert.deepEqual(
    radiosIn(missing)
      .filter(({ checked }) => checked)
      .map(({ id, label }) => [id, label]),
    [['missing-variant', 'missing-variant, not available in this build']],
  );
  assert.match(
    missing,
    /<p class="studio-picker__fallback">This build doesn&#x27;t offer it, so the fallback composition shows\.<\/p>/,
  );
});

test("a composition's disclosure says what its description says and nothing from its provenance", () => {
  const sourced = {
    ...CATALOG,
    axes: CATALOG.axes.map((entry) =>
      entry.axis === 'variant'
        ? {
            ...entry,
            options: entry.options.map((each) => ({
              ...each,
              provenance: ['Studio A reference board', 'a museum catalogue'],
            })),
          }
        : entry,
    ),
  };
  const html = renderToStaticMarkup(
    <AxisPicker
      axis="variant"
      catalog={sourced}
      label="variant the site shows"
      value="editorial-evidence"
      unoffered={() => ''}
      onChange={() => {}}
    />,
  );
  assert.match(html, /About Editorial Evidence\./, 'the description');
  assert.doesNotMatch(html, /Provenance/);
  assert.doesNotMatch(html, /reference board|museum catalogue|First party/);
  // A pack's disclosure keeps its credit.
  assert.match(picker('colorScheme', 'arctic-aurora'), /<dt>Provenance<\/dt><dd>First party<\/dd>/);
});

test('a composition still in progress is listed after the ready ones, off, "In progress", with no drawing and no idiom line, and never a step (A2)', () => {
  const variant = CATALOG.axes.find((entry) => entry.axis === 'variant')!;
  const withPending: AppearanceCatalog = {
    axes: CATALOG.axes.map((entry) =>
      entry.axis === 'variant'
        ? {
            ...entry,
            options: [
              option('shell', 'Shell', {
                status: 'pending',
                statusLabel: 'In progress',
                description: 'Replace this with what the composition does with the portfolio.',
              }),
              ...variant.options,
            ],
          }
        : entry,
    ),
  };
  const render = (value: string) =>
    renderToStaticMarkup(
      <AxisPicker
        axis="variant"
        catalog={withPending}
        label="variant the site shows"
        value={value}
        unoffered={() => ''}
        onChange={() => {}}
      />,
    );
  const html = render('editorial-evidence');
  const order = [...html.matchAll(/data-option="([^"]+)"/g)].map(([, id]) => id);
  // The ready ones first, then every one in progress: the build's Shell and the program's four
  // the build doesn't register yet (P-5), under All, by family, behind the In progress disclosure.
  assert.deepEqual(order.slice(0, 2), ['editorial-evidence', 'spatial-bento']);
  assert.deepEqual(order.slice(2).sort(), [
    'chapters',
    'mission-control',
    'schematic',
    'shell',
    'singular',
  ]);
  assert.match(html, /<details class="studio-later"><summary class="studio-later__summary">/);
  assert.match(html, /In progress <span class="studio-group__count">5<\/span>/);
  // The disclosure, and Compare where the owner may compare, follow the radio group, never sit
  // in it: its checked radio stays its one Tab stop.
  const comparing = renderToStaticMarkup(
    <AxisPicker
      axis="variant"
      catalog={withPending}
      label="variant the site shows"
      value="editorial-evidence"
      unoffered={() => ''}
      onChange={() => {}}
      onCompare={() => {}}
    />,
  );
  const group = groupOf(comparing);
  assert.doesNotMatch(group, OTHER_STOP);
  const after = comparing.slice(comparing.indexOf(group) + group.length);
  assert.match(after, /^<button type="button" class="studio-textbutton studio-compare-link">/);
  assert.match(after, /<details class="studio-later"><summary class="studio-later__summary">/);
  // Its label carries the reason, and its native radio is off, so neither a click nor a key checks it.
  const card = /data-option="shell" title="In progress">[\s\S]*?<\/label>/.exec(html)![0];
  const input = /<input type="radio" ([^>]*)\/>/.exec(card)![1]!;
  assert.match(input, /disabled=""/);
  assert.doesNotMatch(input, /checked=""/);
  assert.match(input, /aria-label="Shell, in progress"/);
  assert.match(card, /data-pending=""/);
  assert.doesNotMatch(card, /<svg/, 'no drawing');
  assert.match(card, /studio-choice__sub--pending">In progress</);
  // A draft that already holds it shows it as the current one, with the note in its About.
  const held = render('shell');
  const heldInput = /data-option="shell"[^>]*><input type="radio" ([^>]*)\/>/.exec(held)![1]!;
  assert.match(heldInput, /checked=""/);
  // Checked, it's in the group, its Tab stop, never behind the disclosure, which holds the rest.
  assert.match(groupOf(held), /data-option="shell"/);
  assert.match(held, /In progress <span class="studio-group__count">4<\/span>/);
  assert.match(
    held,
    /In progress: its lane hasn&#x27;t signed it off, so it can&#x27;t be picked yet\./,
  );
  assert.doesNotMatch(held, /Replace this/);
  // Previous and next go round the ready ones only, from it too.
  const options = withPending.axes[0]!.options;
  assert.equal(stepOption(options, 'spatial-bento', 1), 'editorial-evidence');
  assert.equal(stepOption(options, 'editorial-evidence', -1), 'spatial-bento');
  assert.equal(stepOption(options, 'shell', 1), 'editorial-evidence');
});

test('a composition still in progress is a compact card, its name and "In progress", with no empty drawing plate (A2)', () => {
  const variant = CATALOG.axes.find((entry) => entry.axis === 'variant')!;
  const withPending: AppearanceCatalog = {
    axes: CATALOG.axes.map((entry) =>
      entry.axis === 'variant'
        ? {
            ...entry,
            options: [
              ...variant.options,
              option('shell', 'Shell', { status: 'pending', statusLabel: 'In progress' }),
            ],
          }
        : entry,
    ),
  };
  const render = (value: string) =>
    renderToStaticMarkup(
      <AxisPicker
        axis="variant"
        catalog={withPending}
        label="variant the site shows"
        value={value}
        unoffered={() => ''}
        onChange={() => {}}
      />,
    );
  const card = (html: string, id: string) =>
    new RegExp(`data-option="${id}"[^>]*>[\\s\\S]*?</label>`).exec(html)![0];
  const pending = card(render('editorial-evidence'), 'shell');
  // No plate at all, not an empty one: the card is its name and its status, in that order.
  assert.doesNotMatch(pending, /studio-thumb__art/);
  assert.match(
    pending,
    /<span class="studio-pending" data-pending=""><span class="studio-choice__label">Shell<\/span><span class="studio-choice__sub studio-choice__sub--pending">In progress<\/span><\/span>/,
  );
  // A ready one keeps its plate and drawing.
  assert.match(card(render('editorial-evidence'), 'spatial-bento'), /studio-thumb__art"><svg/);
  // A draft that holds it still shows the tick on the card.
  assert.match(card(render('shell'), 'shell'), /studio-pending[\s\S]*studio-tick/);
});

test("the typography picker shows each web-font pack as its two stills and the system packs by name, in two runs, and Studio's markup names no font a pack hosts (P-5)", () => {
  const catalog = appearanceCatalog();
  const markup = renderToStaticMarkup(
    <AxisPicker
      axis="typography"
      catalog={catalog}
      label="Typography"
      value="swiss-grotesque"
      onChange={() => {}}
      unoffered={() => null}
    />,
  );
  // The style chips open on the current pack's style: Swiss Grotesque is a sans.
  assert.match(markup, /aria-label="Type styles"/);
  assert.match(markup, /aria-pressed="true">Sans<span class="studio-family__count">\d+</);
  assert.match(
    markup,
    /class="studio-group__name">Web fonts <span class="studio-group__count">\d+</,
  );
  assert.match(markup, /class="studio-group__name">On every device </);
  const shot = catalog.axes
    .find((entry) => entry.axis === 'typography')!
    .options.filter((each) => each.specimen?.kind === 'type' && each.specimen.stills);
  if (shot.length > 0) {
    // Each still is Studio's own hashed image, sized in rem, its alt naming the role it shows.
    assert.match(
      markup,
      /<img class="studio-still" src="\/_portfolio\/studio\/swiss-grotesque-aa\.[0-9a-f]{12}\.png" alt="Swiss Grotesque: its display face, sans"/,
    );
    assert.match(markup, /style="width:[\d.]+rem;height:2\.125rem"/);
    assert.match(markup, /loading="eager"/);
    // Under All, the stills past the rail's first four rows wait to scroll into view.
    const all = renderToStaticMarkup(
      <AxisPicker
        axis="typography"
        catalog={catalog}
        label="Typography"
        value="no-such-pack"
        onChange={() => {}}
        unoffered={() => null}
      />,
    );
    assert.match(all, /aria-pressed="true">All</);
    assert.equal((all.match(/loading="eager"/g) ?? []).length, 8);
    assert.equal((all.match(/loading="lazy"/g) ?? []).length, 10);
  }
  // No family a pack ships is ever named in Studio's document: only fallbacks and system stacks.
  for (const family of [
    'Archivo',
    'Inter',
    'Fraunces',
    'JetBrains Mono',
    'Space Grotesk',
    'Newsreader',
    'IBM Plex Mono',
  ]) {
    assert.doesNotMatch(markup, new RegExp(`font-family:[^;"]*${family}`), family);
  }
});

test("a self-hosted pack the build has no stills for, as a third party's, shows its name in its fallback stack and says so, never its web font", () => {
  const thirdParty: AppearanceCatalog = {
    axes: CATALOG.axes.map((entry) =>
      entry.axis === 'typography'
        ? {
            ...entry,
            options: [
              ...entry.options,
              option('acme-type', 'Acme Type', {
                specimen: {
                  kind: 'type',
                  // As the server hands it over: the stack without the family the pack ships.
                  display: 'Georgia, serif',
                  body: 'Georgia, serif',
                  displayWeight: '600',
                  style: 'serif',
                  source: 'self-hosted',
                  fontBytes: 40960,
                  stills: null,
                },
              }),
            ],
          }
        : entry,
    ),
  };
  const markup = renderToStaticMarkup(
    <AxisPicker
      axis="typography"
      catalog={thirdParty}
      label="Typography"
      value="acme-type"
      onChange={() => {}}
      unoffered={() => null}
    />,
  );
  const row = markup.slice(markup.indexOf('data-option="acme-type"'));
  assert.doesNotMatch(row.slice(0, row.indexOf('</label>')), /<img/);
  assert.match(row, /font-family:Georgia, serif;font-weight:600">Aa</);
  assert.match(row, /class="studio-type__meta" aria-hidden="true">Shown in its fallback faces</);
  assert.match(
    markup,
    /Web fonts, 40 KB, which the preview loads once you choose it\. Shown in its fallback faces: Studio shows no picture of it\./,
  );
});

test('the schemes run by character under All, Earthy, Neutral and Vivid, each with its count, the generated ones last, an Accessible scheme tagged (ruling Q2)', () => {
  const catalog = appearanceCatalog();
  const all = renderToStaticMarkup(
    <AxisPicker
      axis="colorScheme"
      catalog={catalog}
      label="Color scheme"
      value="no-such-scheme"
      onChange={() => {}}
      unoffered={() => null}
    />,
  );
  const heads = [
    ...all.matchAll(
      /class="studio-group__name">([A-Za-z]+) <span class="studio-group__count">(\d+)</g,
    ),
  ].map(([, name, count]) => `${name} ${count}`);
  assert.deepEqual(
    heads.map((head) => head.split(' ')[0]),
    ['Earthy', 'Neutral', 'Vivid', 'Generated'],
  );
  const options = catalog.axes.find((entry) => entry.axis === 'colorScheme')!.options;
  // Every scheme the build offers is in one run or another, once.
  const total = heads.reduce((sum, head) => sum + Number(head.split(' ')[1]), 0);
  assert.equal(total, options.length);
  assert.match(all, /class="studio-scheme__tag">Accessible</);
  // The chips count each character, and open on the current one's.
  const warm = renderToStaticMarkup(
    <AxisPicker
      axis="colorScheme"
      catalog={catalog}
      label="Color scheme"
      value="warm-parchment"
      onChange={() => {}}
      unoffered={() => null}
    />,
  );
  assert.match(warm, /aria-pressed="true">Earthy<span class="studio-family__count">\d+</);
  assert.match(warm, /<div class="studio-listhead"><span>Earthy<\/span>/);
});

test("under a family chip that isn't its own, the checked composition leads the view, in the group, so it stays the Tab stop and an arrow steps from it (M1)", () => {
  const options = compositionOptions(appearanceCatalog());
  const ready = options.filter((option) => option.status !== 'pending' && option.family);
  const current = ready[0]!;
  const other = ready.find((option) => option.family !== current.family)!.family!;
  const away = compositionView(options, current.id, other);
  assert.equal(away.away, current);
  assert.deepEqual(away.lead, [current]);
  assert.equal(away.held, undefined);
  assert.ok(away.shownReady.length > 0 && away.shownReady.every((each) => each.family === other));
  assert.ok(!away.shownReady.includes(current), 'listed once, first');
  // In its own family, or under All, it's where it always is.
  for (const family of [current.family!, ALL]) {
    const home = compositionView(options, current.id, family);
    assert.equal(home.away, undefined, family);
    assert.deepEqual(home.lead, [], family);
    assert.ok(home.shownReady.includes(current), family);
  }
  // One in progress a draft holds: its own row in the group, never behind the disclosure. Every
  // first-party composition is ready (Flux, the last, flipped), so one is held in progress here,
  // listed after the ready ones as the catalogue lists them.
  const source = ready.find((option) => option.id !== current.id)!;
  const pending = { ...source, status: 'pending' as const, statusLabel: 'In progress' };
  const drafted = [...options.filter((option) => option.id !== source.id), pending];
  const elsewhere = ready.find(
    (option) => option.id !== source.id && option.family !== pending.family,
  )!.family!;
  const held = compositionView(drafted, pending.id, elsewhere);
  assert.equal(held.held, pending);
  assert.deepEqual(held.lead, []);
  assert.ok(!held.shownPending.includes(pending));
  const all = compositionView(drafted, pending.id, ALL);
  assert.equal(all.held, pending);
  assert.ok(!all.behind.includes(pending));
});

test("a chip row fades only at an end with more past it, so a chip at an end that shows whole keeps its ring whole (the Studio quality cells' focus perimeter)", () => {
  // Owner's composition chips at 1440x900: All 10 to Surface 3 in a 319px row, 319.5px wide.
  assert.equal(scrollEdges(0, 319, 319), 'none');
  assert.equal(scrollEdges(0, 319, 319.4), 'none');
  assert.equal(scrollEdges(0, 319, 400), 'end');
  assert.equal(scrollEdges(40, 319, 400), 'both');
  assert.equal(scrollEdges(81, 319, 400), 'start');
  // A right-to-left row scrolls by negative offsets.
  assert.equal(scrollEdges(-81, 319, 400), 'start');
  assert.equal(scrollEdges(-40, 319, 400), 'both');
});
