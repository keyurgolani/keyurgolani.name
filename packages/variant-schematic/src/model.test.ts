import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkGrouping } from '@portfolio/kit/sections';
import { resolvePortfolioView, type ParsedPair, type Work } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  currentRole,
  depthCount,
  GROUPING,
  depthOf,
  dimensionLabels,
  drawingNumber,
  essayHeights,
  evidenceForm,
  filledRows,
  firstSentence,
  initialsOf,
  interfaceOf,
  linkLabel,
  monthsBetween,
  penTrace,
  proofOf,
  revisionsOf,
  sheetSet,
  signatureOf,
  weeklySums,
  workForm,
} from './model';

// Schematic's derivations on the fixtures N4 names: the sample, one
// artifact, no proof list, no thesis, no chronology, no case studies (SC-S2),
// a long name, a non-Latin name, and RTL. No person-specific literal: each
// fixture is the sample with one field changed.

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ROOT = new URL('../../../', import.meta.url);
const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();
const SNAPSHOTS = {
  github: JSON.parse(readFileSync(new URL('snapshots/github.json', ROOT), 'utf8')) as unknown,
};

function sample(): ParsedPair {
  const read = readPair({
    portfolio: new URL('portfolio.example.yml', ROOT).pathname,
    site: new URL('site.example.yml', ROOT).pathname,
  });
  assert.ok(read.ok);
  return read.pair;
}

function inputOf(pair: ParsedPair, idPrefix = ''): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, { snapshots: SNAPSHOTS }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-26T12:00:00Z',
    idPrefix,
  });
}

type Portfolio = ParsedPair['portfolio'];
const withPortfolio = (change: (p: Portfolio) => Portfolio) => {
  const pair = sample();
  return inputOf({ ...pair, portfolio: change(pair.portfolio) });
};

test('firstSentence: the first sentence as plain text, marks and links dropped', () => {
  assert.equal(firstSentence('**I make failure legible.** The rest.'), 'I make failure legible.');
  assert.equal(firstSentence('[A link](https://x.test) then. More.'), 'A link then.');
  assert.equal(firstSentence('No stop at all'), 'No stop at all');
  assert.equal(firstSentence('   '), undefined);
  assert.equal(firstSentence('最初の文。次の文。'), '最初の文。');
});

test('initials and the drawing number come from the letters of the name alone', () => {
  assert.equal(initialsOf('Rowan  de la Cruz'), 'RDLC');
  assert.equal(drawingNumber('Ана Петрова'), 'АП-001');
  assert.equal(drawingNumber('— 42 —'), undefined);
});

test('the sample: five sheets, the grouping hook refuses nothing, Figure 1 on the cover', () => {
  const input = inputOf(sample());
  const set = sheetSet(input);
  assert.deepEqual(checkGrouping({ grouping: GROUPING }, [set.outline]), []);
  assert.equal(set.cover?.kind, 'hero');
  assert.equal(signatureOf(input)?.id, 'postmortem-template-kit');
  assert.equal(set.notes.length, 3);
  // Figure numbers run page-wide after Figure 1, in reading order.
  const figs = [...set.viewOf.values()].filter((v) => v.fig).map((v) => v.fig!);
  assert.deepEqual(
    figs,
    [...figs].sort((a, b) => a - b),
  );
  assert.equal(figs[0], 2);
  // Every view number restarts on its sheet.
  for (const sheet of set.sheets)
    assert.deepEqual(
      sheet.views.map((v) => v.no),
      sheet.views.map((_, i) => i + 1),
    );
});

test('the cover dimension: thesis, else the current role, else the tagline, else ticks only', () => {
  const noThesis = withPortfolio((p) => ({ ...p, practice: { ...p.practice, thesis: undefined } }));
  assert.equal(dimensionLabels(noThesis).width?.source, 'role');
  assert.equal(dimensionLabels(noThesis).height, undefined);
  const noRole = withPortfolio((p) => ({
    ...p,
    practice: { ...p.practice, thesis: undefined },
    chronology: p.chronology?.map((c) => ({ ...c, kind: 'study' as const })),
  }));
  assert.equal(dimensionLabels(noRole).width?.source, 'tagline');
  const nothing = withPortfolio((p) => ({
    ...p,
    practice: { ...p.practice, thesis: undefined },
    chronology: [],
    identity: { ...p.identity, tagline: undefined },
  }));
  assert.equal(dimensionLabels(nothing).width, undefined);
});

test('no proof list: no notes; heroNotes picks its own, at most four', () => {
  const none = withPortfolio((p) => ({ ...p, proof: undefined }));
  assert.equal(proofOf(none).length, 0);
  const pair = sample();
  const ids = (pair.portfolio.evidence ?? []).slice(0, 6).map((e) => e.id);
  const site = {
    ...pair.site,
    variantControls: { schematic: { version: 1, values: { heroNotes: ids.slice(0, 4) } } },
  };
  const chosen = inputOf({ ...pair, site } as ParsedPair);
  assert.deepEqual(
    proofOf(chosen).map((e) => e.id),
    ids.slice(0, 4),
  );
});

test('IN/OUT: the first sentences of challenge and outcomes, both or neither (SC-S2)', () => {
  const input = inputOf(sample());
  const work = signatureOf(input)!;
  const { io, ports } = interfaceOf(work, input);
  assert.ok(io?.in.endsWith('.'));
  assert.ok(ports.some((p) => p.own && p.href.includes('/work/')));
  // On its own page the case route is left out.
  assert.ok(!interfaceOf(work, input, { full: true }).ports.some((p) => p.href.includes('/work/')));
  const halfStudy = { ...work, caseStudy: { challenge: 'Only a challenge.' } } as Work;
  assert.equal(interfaceOf(halfStudy, input).io, undefined);
  // No case studies anywhere: every figure still draws, without IN/OUT.
  const noCases = withPortfolio((p) => ({
    ...p,
    works: p.works?.map((work) => ({ ...work, caseStudy: undefined }) as Work),
  }));
  for (const w of noCases.portfolio.works) assert.equal(interfaceOf(w, noCases).io, undefined);
});

test('depth: measured, parts and references, the role only when nothing is measured', () => {
  const input = inputOf(sample());
  const work = signatureOf(input)!;
  const depth = depthOf(work, input, sheetSet(input).noteOf);
  assert.ok(depth.measured.length > 0);
  assert.equal(depth.role, undefined);
  assert.match(depthCount(depth, 'en'), /measured value/);
  const bare = depthOf(
    { ...work, highlights: [], tools: [], evidence: [], role: 'Maintainer' } as Work,
    input,
    new Map(),
  );
  assert.equal(bare.role, 'Maintainer');
  assert.equal(depthCount(bare, 'en'), '');
});

test('one artifact: the cover draws it, and no works section draws it again', () => {
  const input = withPortfolio((p) => {
    const first = p.works![0]!;
    return {
      ...p,
      works: [first],
      signature: first.id,
      featured: undefined,
      archive: undefined,
      sections: (p.sections ?? [])
        .map((s) => (s.kind === 'works' ? { ...s, items: [first.id] } : s))
        .filter(
          (s, i, all) => s.kind !== 'works' || all.findIndex((x) => x.kind === 'works') === i,
        ),
    };
  });
  const set = sheetSet(input);
  assert.equal(set.signature?.id, input.portfolio.works[0]!.id);
  assert.equal(
    [...set.viewOf.values()].filter((v) => v.section.kind === 'works' && v.fig).length,
    0,
  );
});

test('no chronology: no current role, no revision block, the sheets still number', () => {
  const input = withPortfolio((p) => ({
    ...p,
    chronology: [],
    sections: (p.sections ?? []).filter((s) => s.kind !== 'chronology'),
  }));
  assert.equal(currentRole(input), undefined);
  assert.ok(
    sheetSet(input).sheets.every((sheet, i) => sheet.no === `S-${String(i + 1).padStart(2, '0')}`),
  );
});

test('forms: works by medium, evidence by one type, else a plain list', () => {
  const w = (medium: string) => ({ id: medium, title: medium, medium }) as Work;
  assert.equal(workForm([w('writing'), w('research')]), 'essays');
  assert.equal(workForm([w('software'), w('writing')]), 'drawings');
  assert.equal(workForm([w('audio-video')]), 'episodes');
  assert.equal(
    evidenceForm([
      { id: 'a', type: 'talk' },
      { id: 'b', type: 'award' },
    ] as never),
    'list',
  );
  assert.equal(evidenceForm([{ id: 'a', type: 'metric', metric: { value: 3 } }] as never), 'chain');
  assert.equal(evidenceForm([{ id: 'a', type: 'metric', metric: { key: 'x' } }] as never), 'list');
});

test('drawn to scale: essay heights, revisions counting down, the patent span, the pen trace', () => {
  const heights = essayHeights([
    { id: 'a', readingTimeMinutes: 14 },
    { id: 'b', readingTimeMinutes: 7 },
    { id: 'c' },
  ] as Work[]);
  assert.deepEqual([...heights.values()], [24, 19.5, 15]);
  assert.deepEqual(
    [...revisionsOf([{ id: 'x' }, { id: 'y' }, { id: 'z' }] as never).values()],
    ['03', '02', '01'],
  );
  assert.equal(monthsBetween('2019-03', '2022-07'), 40);
  assert.equal(monthsBetween('2022', '2019'), undefined);
  const days = Array.from({ length: 21 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    count: i < 7 ? 1 : i < 14 ? 5 : 2,
  }));
  const weeks = weeklySums(days);
  assert.deepEqual(
    weeks.map((wk) => wk.sum),
    [7, 35, 14],
  );
  assert.equal(penTrace(weeks).busiest?.start, '2026-01-08');
});

test('a long name and a non-Latin RTL portfolio derive without throwing', () => {
  const long = withPortfolio((p) => ({
    ...p,
    identity: {
      ...p.identity,
      name: 'Maximiliana Wilhelmina Theodora von Hohenzollern-Sigmaringen',
    },
  }));
  assert.equal(drawingNumber(long.portfolio.identity.name), 'MWTVH-001');
  const rtl = withPortfolio((p) => ({
    ...p,
    locale: 'ar',
    direction: 'rtl',
    identity: { ...p.identity, name: 'ليلى حداد' },
  }));
  assert.equal(drawingNumber(rtl.portfolio.identity.name), 'لح-001');
  assert.ok(sheetSet(rtl).sheets.length > 0);
});

test("a link's label is the kit's: label, platform, else where it goes, a mail address or a written host", () => {
  assert.equal(linkLabel({ url: 'mailto:ada@example.com' }), 'ada@example.com');
  assert.equal(linkLabel({ url: 'tel:+15550100' }), '+15550100');
  assert.equal(linkLabel({ url: 'https://bücher.de/katalog' }), 'bücher.de');
  assert.equal(linkLabel({ url: 'https://www.example.com/a' }), 'example.com');
  assert.equal(linkLabel({ url: 'https://x.test', platform: 'GitHub' }), 'GitHub');
  assert.equal(linkLabel({ url: 'https://x.test', label: 'Slides', platform: 'GitHub' }), 'Slides');
});

test('a port in content keeps the render: /#id and #id take the id prefix', () => {
  const pair = sample();
  const works = (pair.portfolio.works ?? []).map((work, i) =>
    i === 0 ? { ...work, links: [{ url: '/#contact', label: 'Ask' }] } : work,
  );
  const input = inputOf({ ...pair, portfolio: { ...pair.portfolio, works } } as ParsedPair, 'pv-');
  const work = input.portfolio.works.find((w) => w.links?.some((l) => l.url === '/#contact'));
  assert.ok(work);
  const { ports } = interfaceOf(work, input);
  assert.equal(ports.find((port) => port.label === 'Ask')?.href, '/#pv-contact');
});

test('a title block draws its rows full: a lone one-column cell takes two, and a row the next cell cannot join ends in its last cell', () => {
  const spans = (cells: (1 | 2 | 4)[]) =>
    filledRows(cells.map((span, i) => ({ key: String(i), span }))).map((cell) => cell.span);
  // Role, period, medium, made with, recognition (no "for"): medium takes two.
  assert.deepEqual(spans([2, 2, 1, 2, 4]), [2, 2, 2, 2, 4]);
  // With "for", medium and for pair in one row with made with.
  assert.deepEqual(spans([2, 2, 1, 1, 2, 4]), [2, 2, 1, 1, 2, 4]);
  // No period: role, then medium alone, so the row is role and medium, and made with ends its own row.
  assert.deepEqual(spans([2, 1, 2, 4]), [2, 2, 4, 4]);
  // One fact: the whole row.
  assert.deepEqual(spans([1]), [4]);
  // Every row sums to four.
  for (const cells of [
    [2, 2, 1, 2, 4],
    [2, 1, 1, 4],
    [1, 2],
    [2, 4, 1, 1],
  ] as (1 | 2 | 4)[][]) {
    const total = spans(cells).reduce((a, b) => a + b, 0);
    assert.equal(total % 4, 0, cells.join(','));
  }
});
