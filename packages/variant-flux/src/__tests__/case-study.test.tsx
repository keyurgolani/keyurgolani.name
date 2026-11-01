import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { caseStudyOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { plainInline, widestWordEms } from '../model';
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
  render,
  renderInput,
  sampleInput,
  textOf,
} from './harness.test';

// A work's own page in Flux (brief §5.10, P2): routes.work is bespoke, and
// on the sample and every contract fixture each routed work renders
// Flux's own page, with one h1, the work's title; every part of its case
// study under the outline's anchor, its words on the page, and the Index
// listing each; the bar marking the destination that lists the work; and
// every same-page fragment landing.

/** Every work a pair routes to its own page, as the inputs for those pages. */
function casePages(at: (route: VariantRenderInput['route']) => VariantRenderInput) {
  const home = at({ route: 'home' });
  return home.portfolio.works.flatMap((work) => {
    if (!work.slug || !work.caseStudy) return [];
    const input = at({ route: 'work', slug: work.slug });
    const outline = caseStudyOutline(input);
    return outline ? [{ input, outline }] : [];
  });
}

const PAGES = [
  ['sample', casePages((route) => sampleInput(undefined, route))] as const,
  ...FIXTURE_NAMES.map((name) => [name, casePages((route) => fixtureInput(name, route))] as const),
];

test('routes.work is bespoke, and the sample and the complete fixture have pages of their own', () => {
  assert.equal(MANIFEST.routes.work, 'bespoke');
  const named = new Map(PAGES);
  assert.ok(named.get('sample')!.length > 0);
  assert.ok(named.get('complete')!.length > 0);
});

test("each work's page: one h1, its title; Flux's own markup; the outline check clean", () => {
  for (const [name, pages] of PAGES)
    for (const { input, outline } of pages) {
      const html = renderInput(input);
      const where = `${name} ${outline.work.slug}`;
      assert.equal(count(html, /<h1[\s>]/g), 1, where);
      assert.match(html, /class="fx fx--case"/, where);
      assert.ok(html.includes(`>${escaped(outline.work.title)}</h1>`), where);
      const findings = checkOutline(html, input.ids, { sections: [] });
      assert.deepEqual(findings, [], `${where}: ${JSON.stringify(findings, null, 1)}`);
      const ids = idsIn(html);
      assert.equal(new Set(ids).size, ids.length, `${where}: an id repeats`);
      for (const fragment of fragmentLinks(html))
        assert.ok(ids.includes(fragment), `${where}: #${fragment} lands nowhere`);
    }
});

test('every part of a case study is on the page under its anchor, its words shown, the Index listing it', () => {
  for (const [name, pages] of PAGES)
    for (const { input, outline } of pages) {
      const html = renderInput(input);
      const { text } = textOf(html);
      const folded = text.toLocaleLowerCase();
      const where = `${name} ${outline.work.slug}`;
      const ids = idsIn(html);
      for (const part of outline.parts) {
        assert.ok(ids.includes(part.anchor), `${where}: no ${part.key} anchor`);
        assert.ok(html.includes(`href="${part.href}"`), `${where}: the Index has no ${part.key}`);
      }
      const study = outline.work.caseStudy;
      const said = [
        ...(
          [
            'challenge',
            'context',
            'role',
            'constraints',
            'evidence',
            'outcomes',
            'reflection',
          ] as const
        ).map((key) => study[key]),
        ...(study.decisions ?? []).flatMap((each) => [
          each.decision,
          each.rationale,
          each.alternatives,
        ]),
        outline.work.summary,
        outline.work.description,
      ];
      for (const source of said) {
        if (!source?.trim()) continue;
        for (const line of plainInline(source).split(/\n+/)) {
          const words = line.trim().toLocaleLowerCase().slice(0, 60);
          if (words) assert.ok(folded.includes(words), `${where}: "${words}" isn't shown`);
        }
      }
    }
});

test('the bar marks the destination that lists the work, and its tabs go home', () => {
  const { input, outline } = PAGES.find(([name]) => name === 'sample')![1][0]!;
  const html = renderInput(input);
  assert.match(html, /class="fx fx--case" data-fx-here="work"/);
  assert.match(html, /<li class="fx-tabs__dest" data-fx-tab="work" data-current="">/);
  assert.equal(count(html, /<li class="fx-tabs__dest"[^>]*data-current/g), 1);
  assert.match(html, /href="\/sample#fx--sheet-writing"/);
  // The crumb links to the sheet that lists it; the way on goes back there too.
  assert.ok(count(html, /href="\/sample#fx--sheet-work"/g) >= 3, outline.work.slug);
});

const STUDIED = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', tagline: 'Letterpress and small tools.' },
  sections: [
    { kind: 'hero', id: 'top', greeting: 'Hi, I am', tagline: 'I print things.' },
    { kind: 'works', id: 'work', title: 'Work', items: ['press', 'type'] },
    { kind: 'evidence', id: 'awards', title: 'Awards', items: ['prize'] },
  ],
  works: [
    {
      id: 'press',
      title: 'Kontaktaufnahmemöglichkeiten Press',
      slug: 'press',
      medium: 'software',
      summary: 'A press, rebuilt.',
      evidence: ['prize'],
      caseStudy: { challenge: 'It jammed.', outcomes: 'It prints.' },
    },
    {
      id: 'type',
      title: 'Type',
      slug: 'type',
      medium: 'software',
      summary: 'Wood type, catalogued.',
      caseStudy: { reflection: 'Slower is fine.' },
    },
  ],
  evidence: [{ id: 'prize', type: 'award', title: 'The Small Prize', receivedAt: '2025' }],
};

test("with cited records and no evidence text, the evidence part's anchor is the record", () => {
  const input = inputFor(pairOf(STUDIED), { route: { route: 'work', slug: 'press' } });
  const outline = caseStudyOutline(input)!;
  const evidence = outline.parts.find((part) => part.key === 'evidence');
  assert.ok(evidence, 'the cited award makes an evidence part');
  const html = renderInput(input);
  assert.match(html, new RegExp(`<section class="fx-case__record" id="${evidence.anchor}"`));
  assert.match(html, /The Small Prize/);
  // It links to where it sits on home.
  assert.match(html, /href="\/sample#prize"[^>]*>(<span[^>]*>)?In /);
  // The next case study leads on; the last one goes back to Work.
  assert.match(html, /<a href="\/sample\/work\/type">Type<\/a>/);
  const last = renderInput(inputFor(pairOf(STUDIED), { route: { route: 'work', slug: 'type' } }));
  assert.match(last, /fx-case__back fx-case__back--only/);
});

test("a title's widest word sets its fit, so a long word never breaks inside", () => {
  const input = inputFor(pairOf(STUDIED), { route: { route: 'work', slug: 'press' } });
  const html = renderInput(input);
  const ems = widestWordEms('Kontaktaufnahmemöglichkeiten Press');
  assert.ok(ems > 10);
  assert.match(html, new RegExp(`class="fx-case__title"[^>]*style="--layout-fx-ems:${ems}"`));
  assert.equal(widestWordEms('お気軽にお問い合わせ'), 1.06);
});

test('the wipe (FX-M5): one transition name, the curtain on home and a work page, none with it off', () => {
  assert.deepEqual(MANIFEST.transitions, { crossDocument: true, names: ['flux-wipe'] });
  const control = MANIFEST.controls?.items.find((item) => item.id === 'wipe');
  assert.equal(control?.type, 'boolean');
  assert.equal(control?.default, true);
  const curtain = /<span class="fx-wipe" aria-hidden="true"><\/span>/g;
  for (const route of [{ route: 'home' }, { route: 'work', slug: 'press' }] as const) {
    assert.equal(count(render(pairOf(STUDIED), { route }), curtain), 1, route.route);
    assert.equal(
      count(render(pairOf(STUDIED, { wipe: false }), { route }), curtain),
      0,
      route.route,
    );
  }

  // The ink lives in an animation under no-preference alone, so a stilled transition shows none.
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  assert.equal(count(css, /::view-transition-[a-z-]+\(/g), 2);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?::view-transition-new\(flux-wipe\) \{\s*mix-blend-mode: normal;\s*animation: flux-wipe-pour /,
  );
  // The first ink pours over the page being left (data-fx-wipe, at full motion, over everything
  // on it), and the old curtain, then the ink, holds whole over the host's root crossfade, under
  // the new one's pour, neither adding its light to the other's (SF-P2-1).
  const block = css.slice(
    css.indexOf('::view-transition-new(flux-wipe)'),
    css.indexOf('@keyframes flux-wipe-hold'),
  );
  assert.match(
    block,
    /::view-transition-old\(flux-wipe\) \{\s*mix-blend-mode: normal;\s*animation: flux-wipe-hold max\(var\(--ui-motion-fast\), calc\(var\(--ui-motion-slow\) \* 0\.448\)\)\s*step-end both;/,
  );
  assert.match(
    block,
    /\[data-variant='flux'\]\[data-motion='full'\] \.fx\[data-fx-wipe='pour'\] \.fx-wipe \{\s*z-index: 5;\s*background-color: var\(--color-signature-start\);\s*animation: flux-wipe-rise min\(calc\(var\(--ui-motion-slow\) \* 0\.448\), var\(--motion-feedback\)\)/,
  );
  // The pour's cap is the feedback slot, which sits under the lead's 250ms (POUR_CAP_MS).
  const feedback = /--layout-motion-feedback: (\d+)ms;/.exec(css);
  assert.ok(feedback && Number(feedback[1]) <= 250, feedback?.[0]);
  assert.match(css, /@keyframes flux-wipe-hold \{\s*to \{\s*opacity: 0;/);
});
