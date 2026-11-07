import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import { bandsOf, proofTiles } from '../model';
import {
  count,
  escaped,
  FIXTURE_NAMES,
  fixtureInput,
  fragmentLinks,
  idsIn,
  inputFor,
  MANIFEST,
  PACKAGE_DIR,
  pairOf,
  RAW_MANIFEST,
  render,
  renderInput,
  sampleInput,
} from './harness.test';

// Aurora Glass's home page, rendered as the server sends it, so what these
// hold is also what a page with no JavaScript shows: one h1 holding the
// name and the thesis (AG-M1), the signature sheet before the tiles in
// source order (AG-M2), five destinations at most, one pane per band with
// its sections as lites (AG-M3), plain heads (AG-M5), at most three blurred
// surfaces (AG-M6), two loops gated on the ambient state (AG-M7), and no
// pane painted translucent by the composition (the glass ruling).

const sample = () => renderInput(sampleInput());
const CSS = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');

test('every core kind renders bespoke, and the manifest says so', () => {
  assert.equal(MANIFEST.renderedKinds.length, 14);
  assert.equal(MANIFEST.performanceTier, 'medium');
  assert.equal(MANIFEST.budgets?.animation, 2);
  const html = sample();
  assert.equal(count(html, /data-renderer="shared"/g), 0);
  assert.ok(count(html, /data-renderer="bespoke"/g) > 20);
});

test('the sample and every contract fixture pass the outline check', () => {
  const inputs = [
    ['sample', sampleInput()] as const,
    ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
  ];
  for (const [name, input] of inputs) {
    const html = renderInput(input);
    const findings = checkOutline(html, input.ids, { sections: pageOutline(input).sections });
    assert.deepEqual(findings, [], `${name}: ${JSON.stringify(findings, null, 1)}`);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    const known = new Set([...ids, input.ids.main]);
    for (const fragment of fragmentLinks(html))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of html.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    for (const section of input.portfolio.sections)
      if ('title' in section && typeof section.title === 'string' && section.title.trim() !== '')
        assert.ok(
          html.includes(escaped(section.title.trim())),
          `${name}: ${section.id}'s title "${section.title}" is missing`,
        );
    assert.equal(count(html, /<h1\b/g), 1, `${name}: one h1`);
    assert.equal(count(html, /data-visitor-control-slot/g), 1, `${name}: one visitor slot`);
  }
});

test('the opening: the thesis is the display line inside the one h1, the name at title size, the greeting a label (AG-M1, N5)', () => {
  const html = sample();
  assert.match(
    html,
    /<h1 class="ag-id__h1" id="ag--opening"><span class="ag-id__name" data-type-role="title">Anamika Devi<\/span><span class="ag-hidden">: <\/span><span class="ag-id__line" data-type-role="display" data-length="short">I make failure legible\.<\/span><\/h1>/,
  );
  assert.match(html, /<p class="ag-id__greet" data-type-role="label">Hello, I&#x27;m<\/p>/);
  // The rest of the thesis is the standfirst, in the thesis section's own frame.
  assert.match(
    html,
    /<section id="thesis"[^>]*class="ag-standfirst"[^>]*>[\s\S]*?The systems I build/,
  );
  // The thesis has no band of its own.
  assert.doesNotMatch(html, /class="ag-sec[^"]*" [^>]*data-section-id="thesis"/);
});

test('source order: the pane, then the signature sheet, then the tiles (AG-M2)', () => {
  const html = sample();
  const pane = html.indexOf('class="ag-pane ag-frost ag-id"');
  const sheet = html.indexOf('id="ag--signature"');
  const tiles = html.indexOf('class="ag-tiles"');
  assert.ok(pane > 0 && sheet > pane && tiles > sheet, `${pane} ${sheet} ${tiles}`);
  assert.match(
    html,
    /Signature work, since <time class="ag-num" dateTime="2022-01">January 2022<\/time>/,
  );
  assert.match(
    html,
    /<h2 class="ag-sig__title"[^>]*><a class="ag-stretch" href="\/sample\/work\/postmortem-template-kit">Postmortem Template Kit/,
  );
});

test('stat tiles: from the proof strip, at most three, metrics to their first comma, an award its year and title', () => {
  const tiles = proofTiles(sampleInput());
  assert.ok(tiles.length <= 3 && tiles.length > 0);
  for (const tile of tiles) assert.doesNotMatch(tile.label, /,/);
  assert.equal(proofTiles(renderableWith({ proof: 'off' })).length, 0);
});

test('the capsule: the name and at most five destinations, Contact the filled call (N1)', () => {
  const html = sample();
  const capsule =
    /<nav class="ag-capsule ag-frost" aria-label="Primary">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  // The Index's plain stand-in (no script) isn't a destination.
  const links = count(capsule, /<a\b(?![^>]*ag-capsule__index--plain)/g);
  assert.ok(links <= 6, `${links} links`); // the name and five destinations
  assert.match(
    capsule,
    /class="ag-capsule__cta"[^>]*><span class="ag-capsule__cta-text">Get in touch</,
  );
  assert.match(capsule, /popoverTarget="ag--index"|popovertarget="ag--index"/i);
});

test('with no script the Index is a plain link to a contents list after main; marked live, the popover', () => {
  const html = sample();
  const capsule =
    /<nav class="ag-capsule ag-frost" aria-label="Primary">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  assert.match(capsule, /<button type="button" class="ag-capsule__index ag-capsule__index--live"/);
  assert.match(capsule, /<a class="ag-capsule__index ag-capsule__index--plain" href="#ag--index"/);
  assert.ok(html.indexOf('</main>') < html.indexOf('id="ag--index"'), 'the list follows main');
  // Last, after the footer, so leaving the flow moves nothing; and no dialog while it's a list.
  assert.ok(
    html.indexOf('</footer>') < html.indexOf('id="ag--index"'),
    'the list follows the footer',
  );
  // A contents list, not a closed popover the page shows (row 62): the enhancement makes it one.
  assert.match(html, /<div class="ag-index ag-pane" id="ag--index"><div class="ag-index__head">/);
  assert.doesNotMatch(html, /id="ag--index"[^>]*\bpopover=/);
  assert.equal(count(html, /<dialog\b/g), 0);
  // Unmarked, the button and the Close are gone and the dialog is in the flow; marked, the link is.
  assert.match(
    CSS,
    /\.ag:not\(\[data-ag-live\]\) \.ag-capsule__index--live,\s*\[data-variant='aurora-glass'\] \.ag\[data-ag-live\] \.ag-capsule__index--plain \{\s*display: none;/,
  );
  assert.match(
    CSS,
    /\.ag:not\(\[data-ag-live\]\) \.ag-index \{\s*display: block;\s*position: static;/,
  );
  assert.match(CSS, /\.ag:not\(\[data-ag-live\]\) \.ag-index__close \{\s*display: none;/);
});

test('one band per destination, every section a lite of its pane, heads plain (AG-M3, AG-M5)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const bands = bandsOf(input, pageOutline(input));
  assert.deepEqual(
    bands.map((band) => band.id),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  assert.equal(count(html, /class="ag-band__pane"/g), 4);
  // No free-standing card grid and no pill heads: every section head is a plain heading in its lite.
  assert.doesNotMatch(html, /class="ag-pill/);
  assert.equal(count(html, /<h3 id="[^"]+--h" class="ag-sec__title"/g) > 15, true);
});

test('the signature work shows once; the band links back to it (N6, AG-S6)', () => {
  const html = sample();
  assert.equal(count(html, />Postmortem Template Kit</g), 2); // the sheet's title and the back-reference
  assert.match(
    html,
    /<a href="#ag--signature"><span>Postmortem Template Kit<\/span>, the signature work, opens the page<\/a>/,
  );
});

test('the signature shows once in every form: its band keeps one line back to it (N6)', () => {
  const media = ['software', 'writing', 'audio-video', 'image-series', 'photography', 'music'];
  for (const medium of media) {
    const input = inputFor(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Kai Bell', tagline: 'Keeps records.' },
        signature: 'lead-piece',
        works: [
          { id: 'lead-piece', title: 'Lead Piece', medium, summary: 'The one.' },
          { id: 'second-piece', title: 'Second Piece', medium, summary: 'The other.' },
        ],
        sections: [
          { kind: 'hero', id: 'top', tagline: 'I keep careful records.' },
          { kind: 'works', id: 'made', title: 'Made', items: ['lead-piece', 'second-piece'] },
        ],
      }),
    );
    const html = renderInput(input);
    assert.equal(count(html, />Lead Piece</g), 2, `${medium}: the sheet's title and the line back`);
    assert.match(
      html,
      /<p class="ag-backref" data-type-role="body-compact" id="[^"]+"><a href="#ag--signature"><span>Lead Piece<\/span>, the signature work, opens the page<\/a><\/p>/,
      medium,
    );
    assert.match(html, />Second Piece</, `${medium}: the rest still shows in its form`);
    const findings = checkOutline(html, input.ids, { sections: pageOutline(input).sections });
    assert.deepEqual(findings, [], `${medium}: ${JSON.stringify(findings)}`);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${medium}: an id repeats`);
  }
});

test('a series titled as its Looking section gets no second heading; another title keeps its h4', () => {
  const html = (title: string) =>
    render(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Kai Bell', tagline: 'Keeps records.' },
        works: [{ id: 'walks', title, medium: 'photography', summary: 'Walks.' }],
        sections: [
          { kind: 'hero', id: 'top', tagline: 'I keep careful records.' },
          { kind: 'works', id: 'looking', title: 'Looking', items: ['walks'] },
        ],
      }),
    );
  assert.doesNotMatch(html('looking'), /<h4[^>]*>looking<\/h4>/i);
  assert.equal(count(html('looking'), /<h4\b/g), 0);
  assert.match(html('Coastal walks'), /<h4 class="ag-row__title"[^>]*>Coastal walks<\/h4>/);
});

/** A processed image's derived value, as the media pipeline would record it. */
const READY = (id: string) => ({
  state: 'ready' as const,
  value: {
    sha256: 'f'.repeat(64),
    mime: 'image/png',
    bytes: 1,
    width: 1200,
    height: 800,
    aspectRatio: 1.5,
    renditions: [
      {
        url: `/media/${id}/w1200.png`,
        name: 'w1200',
        mime: 'image/png',
        bytes: 1,
        width: 1200,
        height: 800,
      },
    ],
  },
  derivedAt: '2026-01-01T00:00:00Z',
});

/** An element's accessible name as text: its words, less what's aria-hidden. */
const nameOf = (html: string) =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

test('a linked series titled as its section: its link is named "Looking, 3 photographs"', () => {
  // The sample's series is titled as its section (Looking), with three photographs; here they're
  // ready, as the demo serves them, and the series takes a link.
  const input = sampleInput();
  const series = input.portfolio.works.find((work) => work.id === 'looking-photographs')!;
  (series as { url?: string }).url = 'https://photos.example.com';
  const media = Object.fromEntries(
    Object.entries(input.media).map(([id, asset]) => [
      id,
      id.startsWith('looking-') && asset.kind === 'image'
        ? { ...asset, derived: READY(id) }
        : asset,
    ]),
  );
  const html = renderInput({ ...input, media } as typeof input);
  const note = /<header class="ag-looking__note">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? '';
  assert.equal(count(note, /<h4\b/g), 0, 'no second heading');
  const link = /<a href="https:\/\/photos\.example\.com">([\s\S]*?)<\/a>/.exec(note)?.[1];
  assert.ok(link, 'the caption holds the link');
  assert.equal(nameOf(link), 'Looking, 3 photographs');
});

test('At a glance: each figure lite takes two tracks by subgrid, value and words, so the statements share one line and each note follows its own', () => {
  assert.match(
    CSS,
    /\.ag-figures \.ag-lite \{\s*grid-row: span 2;\s*display: grid;\s*grid-template-rows: subgrid;/,
  );
  assert.match(CSS, /\.ag-figures \.ag-figure__value \{\s*grid-row: 1;/);
  assert.match(CSS, /\.ag-figures \.ag-figure__words \{\s*grid-row: 2;/);
  // The note follows its own statement, inside the words.
  assert.match(
    sample(),
    /<div class="ag-figure__words"><p class="ag-figure__caption"[^>]*>[\s\S]*?<\/p><p class="ag-figure__note"/,
  );
});

test('blur only on the capsule and the identity pane, at most three surfaces (AG-M6)', () => {
  const html = sample();
  assert.equal(count(html, /\bag-frost\b/g), 2);
  const blurred = [...CSS.matchAll(/([^{}]+)\{[^}]*backdrop-filter/g)].map(([, selector]) =>
    selector!.trim(),
  );
  assert.deepEqual(blurred, ["[data-variant='aurora-glass'] .ag-frost"]);
});

test('reduced motion: every lift, rise and the Index drop wait for no-preference and the page motion; the Index only fades', () => {
  // The no-preference blocks, by balanced braces.
  const blocks: string[] = [];
  let rest = CSS;
  for (;;) {
    const at = rest.indexOf('@media (prefers-reduced-motion: no-preference)');
    if (at < 0) break;
    let depth = 0;
    let end = rest.indexOf('{', at);
    for (; end < rest.length; end += 1) {
      if (rest[end] === '{') depth += 1;
      else if (rest[end] === '}' && --depth === 0) break;
    }
    blocks.push(rest.slice(at, end + 1));
    rest = rest.slice(0, at) + rest.slice(end + 1);
  }
  assert.ok(blocks.length >= 4);
  // Outside them, nothing moves on hover or press, and nothing rises or drops in.
  assert.doesNotMatch(rest, /var\(--ui-state-(?:hover|active)-transform\)/);
  assert.doesNotMatch(rest, /animation(?:-name)?:\s*aurora-glass-(?:rise|drop)/);
  // Inside them, every rule also waits for the page's own motion setting.
  for (const block of blocks)
    for (const [, selector] of block.slice(block.indexOf('{') + 1).matchAll(/([^{}]+)\{/g))
      for (const part of selector!.split(/,\s*(?![^()]*\))/))
        assert.match(
          part.trim(),
          /^\[data-variant='aurora-glass'\]:not\(\[data-motion='reduced'\], \[data-motion='static'\]\)/,
          part,
        );
  // The Index fades by default and drops in only inside the gate.
  assert.match(rest, /\.ag-index:popover-open \{[^}]*animation: aurora-glass-fade /);
  assert.match(
    blocks.join('\n'),
    /\.ag-index:popover-open \{\s*animation-name: aurora-glass-drop;/,
  );
});

test('the focused skip link is raised above .ag, its sky and its chrome (C1)', () => {
  // Whether it paints on top is the e2e's to say (elementFromPoint); here, that it's positioned at the least z-index.
  const skip = /\[data-ui-slot='skip-link'\]:focus \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(skip, /position: relative;\s*z-index: 1;/);
  // .ag is the positioned, isolated context the skip link sits before.
  assert.match(
    CSS,
    /\[data-variant='aurora-glass'\] \.ag \{\s*position: relative;\s*isolation: isolate;/,
  );
});

test('Pause: the ornament holds it above 75rem, the capsule as its last item below; the ring sits on surface (G1, S2, C2)', () => {
  const html = sample();
  const capsule =
    /<nav class="ag-capsule ag-frost" aria-label="Primary">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  assert.match(
    capsule,
    /<button type="button" class="ag-orn ag-orn--capsule" id="ag--pause-capsule" aria-pressed="false" aria-describedby="ag--pause-capsule-held" data-ag-pause="" hidden=""><span class="ag-orn__mark" aria-hidden="true"><\/span><span class="ag-orn__word">Pause the sky<\/span><\/button><span class="ag-orn__held" id="ag--pause-capsule-held" data-ag-held="" hidden=""><\/span>$/,
  );
  assert.equal(count(html, /data-ag-pause=""/g), 2);
  assert.match(CSS, /\.ag-capsule \.ag-orn--capsule \{\s*display: none;/);
  assert.match(
    CSS,
    /@media \(max-width: 75rem\) \{\s*\[data-variant='aurora-glass'\] \.ag-capsule \.ag-orn--capsule:not\(\[hidden\]\) \{\s*display: inline-flex;\s*\}\s*\[data-variant='aurora-glass'\] \.ag-ornament \.ag-orn \{\s*display: none;/,
  );
  // The ring (the platform's) over a surface halo past its offset and its width, in both places.
  // In the ornament the halo is always there, so focus changes the ring against surface only.
  assert.match(
    CSS,
    /\.ag-ornament \.ag-orn::before \{[^}]*inset: calc\(-1 \* var\(--ui-focus-offset\) - 3 \* var\(--ui-focus-width\)\);[^}]*z-index: -1;[^}]*border: var\(--ui-focus-width\) var\(--ui-focus-style\) transparent;[^}]*background-color: var\(--color-surface-default\);/,
  );
  assert.match(
    CSS,
    /\.ag-ornament \.ag-orn:focus-visible::before \{\s*border-color: var\(--color-focus\);/,
  );
  assert.doesNotMatch(CSS, /outline-offset: 0/);
});

test('below 75rem an ornament with no visitor control goes, column and gap with it, so the capsule runs to the end line (G1)', () => {
  const block = CSS.slice(CSS.indexOf('@media (max-width: 75rem)'));
  assert.match(
    block,
    /\.ag-chrome:not\(:has\(\.ag-ornament \[data-visitor-control-slot\]:not\(:empty\)\)\) \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    block,
    /\.ag-ornament:not\(:has\(\[data-visitor-control-slot\]:not\(:empty\)\)\) \{\s*display: none;/,
  );
  // The mark alone only below 64rem, not at it.
  assert.match(
    CSS,
    /@media \(max-width: 63\.99rem\) \{\s*\[data-variant='aurora-glass'\] \.ag-capsule \.ag-orn--capsule \.ag-orn__word/,
  );
});

test('Pause shows its state in both places: pressed, it fills and its mark turns to play; the capsule copy hovers as its neighbours do', () => {
  assert.match(
    CSS,
    /:is\(\.ag-ornament \.ag-orn, \.ag-capsule \.ag-orn--capsule\)\[aria-pressed='true'\] \{\s*background-image: none;\s*background-color: var\(--color-text-primary\);\s*color: var\(--color-text-inverse\);/,
  );
  assert.match(
    CSS,
    /\.ag-orn\[aria-pressed='true'\] \.ag-orn__mark \{[^}]*clip-path: polygon\(0 0, 100% 50%, 0 100%\);/,
  );
  assert.match(CSS, /:is\(\.ag-capsule__dest a, \.ag-capsule__index, \.ag-orn--capsule\):hover \{/);
});

test('two loops, each gated on the ambient state, and none without the enhancement (AG-M7, K-4 b)', () => {
  const loops = [...CSS.matchAll(/\{[^}]*infinite[^}]*\}/g)].map(([rule]) => rule);
  assert.equal(loops.length, 2);
  for (const rule of loops)
    assert.match(rule!, /animation-play-state: var\(--motion-ambient-state\);\s*\}$/);
  // Both start only once the enhancement marks the root.
  assert.equal(count(CSS, /\.ag\[data-ag-sky\] [^{]*\{\s*animation: aurora-glass-/g), 2);
  assert.match(CSS, /--layout-motion-ambient: 36s;/);
  // The Pause ships hidden, as a toggle.
  assert.match(
    sample(),
    /<button type="button" class="ag-orn" id="ag--pause" aria-pressed="false" aria-describedby="ag--pause-held" data-ag-pause="" hidden="">/,
  );
});

test('the glass ruling: no pane painted translucent by the composition', () => {
  // The appearance lint (translucentBackgrounds) runs in the round's audits, which
  // read it from its module; here, the same three kinds by pattern. Every mix with
  // transparent is the language's own surface stack, at --ui-surface-opacity, or a
  // ::backdrop scrim; no rule sets an opacity on a painted pane.
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector!.trim(),
    body: body!,
  }));
  for (const { selector, body } of rules) {
    for (const [mix] of body.matchAll(/color-mix\([^;]*?transparent\)/g)) {
      if (/::backdrop$/.test(selector)) continue;
      assert.match(mix, /var\(--ui-surface-opacity\)/, `${selector}: ${mix}`);
    }
    if (/background/.test(body)) assert.doesNotMatch(body, /(?:^|;)\s*opacity:\s*0?\.\d/, selector);
    if (/background(?:-image)?:\s*var\(--ui-surface-material\)/.test(body)) {
      assert.fail(`${selector} paints the bare material`);
    }
  }
});

test('no text on the sky: the sky and the Lens are aria-hidden and hold no text', () => {
  const html = sample();
  const sky = /<div class="ag-sky" aria-hidden="true"[\s\S]*?<\/svg><\/div>/.exec(html)?.[0] ?? '';
  assert.ok(sky.length > 0);
  assert.equal(sky.replace(/<[^>]+>/g, '').trim(), '');
  assert.match(html, /<div class="ag-lens" aria-hidden="true">/);
});

test('the backdrop is one named, opaque layer: one [data-ag-backdrop] root holds every layer of the sky', () => {
  const html = sample();
  assert.equal(count(html, /data-ag-backdrop/g), 1);
  const sky =
    /<div class="ag-sky" aria-hidden="true" data-ag-backdrop=""[\s\S]*?<\/svg><\/div>/.exec(
      html,
    )?.[0];
  assert.ok(sky, 'the backdrop root is the sky');
  for (const layer of ['ag-sky__base', 'ag-sky__curtains', 'ag-sky__hills'])
    assert.ok(sky.includes(layer), `${layer} is inside the backdrop root`);
  for (const layer of ['ag-sky__base', 'ag-sky__photo', 'ag-curtain', 'ag-sky__hill'])
    assert.equal(count(html, new RegExp(`class="${layer}\\b`, 'g')) > 0, sky.includes(layer));
  // The photograph is opaque, shaped by its mask alone.
  const photo = /\.ag-sky__photo \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.doesNotMatch(photo, /opacity/);
  assert.match(photo, /mask-image/);
  // P1 recommends no appearance (lead A's ruling).
  assert.equal('recommendedAppearance' in RAW_MANIFEST, false);
});

/** A CSS block, the at-rule or rule starting at `at`, through its balanced closing brace. */
function blockAt(css: string, at: number): string {
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  return css.slice(at);
}

test('polish: twelve tracks fit 320, split lites reach the pane, the third lane folds with a branch', () => {
  // 1. On a phone the gutter steps down, so eleven of them fit a 320px page: inside the 48rem block itself.
  const phone = blockAt(CSS, CSS.indexOf('@media (max-width: 48rem)'));
  assert.ok(phone.length > 100 && phone.endsWith('}'));
  assert.match(
    phone,
    /\[data-variant='aurora-glass'\] \{\s*--layout-grid-gutter: var\(--space-xs\);\s*\}/,
  );
  // 2. The narrow padding skips the split lite, whose lites run to the pane's edges.
  assert.match(
    CSS,
    /:is\(\.ag-band__head, \.ag-sec:not\(\.ag-sec--split\)\) \{\s*padding-inline: var\(--space-m\);/,
  );
  // 3. Lanes 1 and 2 share one offset, and a branch from the rail's own line centres on the bead.
  assert.match(
    CSS,
    /\.ag-stop:is\(\[data-lane='1'\], \[data-lane='2'\]\) \{\s*margin-inline-start: var\(--space-m\);/,
  );
  const branch =
    /\.ag-stop:is\(\[data-lane='1'\], \[data-lane='2'\]\)::before \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(branch, /var\(--layout-bead\) \/ 2 - var\(--layout-rail-line\) \/ 2/);
  assert.match(branch, /border-block-start: var\(--layout-rail-line\) solid/);
  assert.match(
    CSS,
    /\.ag-rail::before \{[^}]*border-inline-start: var\(--layout-rail-line\) solid/,
  );
  assert.match(
    CSS,
    /\.ag-stop__bead \{[^}]*inline-size: var\(--layout-bead\);\s*block-size: var\(--layout-bead\);/,
  );
  assert.doesNotMatch(CSS, /margin-inline-start: var\(--space-xl\);/);
  // 5. The band's geometry against the capsule, and Pause's height, are the e2e's (aurora-glass.spec.ts) and
  // the round's probes under four languages; here, that nothing shortens a capsule item below its height.
  assert.doesNotMatch(CSS, /2\.75rem - /);
});

test('a chronology stop reads as it shows: its title, then its dates', () => {
  const html = sample();
  const stops = [...html.matchAll(/<div class="ag-stop__body">([\s\S]*?)<\/div><\/li>/g)].map(
    ([, body]) => body!,
  );
  assert.ok(stops.length > 3);
  for (const body of stops) {
    const title = body.indexOf('class="ag-stop__title"');
    const when = body.indexOf('class="ag-stop__when');
    assert.ok(title >= 0 && when > title, body.slice(0, 120));
  }
});

test('a page with no works: the pane spans the grid and the Lens moves into its corner', () => {
  const html = render(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Kai Bell', tagline: 'Keeps records.' },
      sections: [{ kind: 'hero', id: 'top', tagline: 'I keep careful records.' }],
    }),
  );
  assert.match(html, /class="ag-shingle ag-opening" data-sheet="no"/);
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /I keep careful records\./);
  // No sheet, no tiles: the Lens is still in the opening, after the pane.
  const opening = /<div class="ag-shingle ag-opening"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
  assert.ok(html.indexOf('class="ag-lens"') > html.indexOf('data-sheet="no"'));
  assert.doesNotMatch(opening, /id="ag--signature"|class="ag-tiles/);
  // The pane spans all twelve columns, and the Lens moves to the top end corner, smaller.
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(/[[\]().]/g, '\\$&')} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
  assert.match(rule(".ag-opening[data-sheet='no'] .ag-id"), /grid-column: 1 \/ -1;/);
  const lens = rule(".ag-opening[data-sheet='no'] .ag-lens");
  assert.match(lens, /grid-column: 10 \/ 13;/);
  assert.match(lens, /align-self: start;/);
  assert.match(lens, /justify-self: end;/);
  assert.match(lens, /inline-size: min\(100%, 12rem\);/);
  assert.match(rule('.ag-lens'), /grid-column: 8 \/ 12;/);
});

test('a page with no hero and no thesis still has its one h1, the identity tagline', () => {
  const html = render(
    pairOf({
      schemaVersion: 3,
      locale: 'de',
      direction: 'ltr',
      identity: { name: 'Jürgen Weiß', tagline: 'Baut Brücken aus Text.' },
      sections: [{ kind: 'lede', id: 'about', title: 'Über mich', body: 'Hallo.' }],
    }),
  );
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /Baut Brücken aus Text\./);
  // The composition's own words are marked English on a German page.
  assert.match(html, /<span lang="en">About<\/span>/);
});

function renderableWith(controls: Readonly<Record<string, string | boolean>>) {
  const input = sampleInput();
  return { ...input, controls: { ...input.controls, ...controls } };
}
