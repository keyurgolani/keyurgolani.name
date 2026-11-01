import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pageOutline, type SectionComposition } from '@portfolio/kit/sections';
import { resolvePortfolioView, routedWorks, type PublicView } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  FIRST_PARTY_PINS,
  href,
  type RouteTarget,
  type VariantManifest,
} from '@portfolio/variant-contract';
import {
  checkOutline,
  CONTRACT_FIXTURES,
  rendersSharedSection,
} from '@portfolio/variant-contract/node';
import { variantLoader } from './variant-loaders';
import { REGISTRY } from './variants';
import { resolveVisitorPath } from './visitor-routes';

// The outline check over every registered composition (stream E): each
// contract fixture, the bundled sample, and this test's own pair of
// reserved ids, on every visitor route, through the composition the host
// renders that page in, with no id prefix and with a preview frame's. A
// composition that owns its markup still holds one h1, the skip link's
// main, heading order, a frame for every section the page renders, named
// navigation, and real links (checkOutline in @portfolio/variant-contract/node).
// The sections it checks for on home are pageOutline()'s, read through the
// composition's own SectionComposition when its `.` export names one as
// `sections`, so a section it gives no anchor is checked for none.
//
// Each composition's quality unit (quality/units/<id>.ts) lists its known
// findings today as outlineKnown, exactly: the composition, the pair, the
// page, the rule, and the element or section, each found with no prefix and
// with one, and why. A finding none lists fails the run, and so does an entry
// that no longer happens, so a fix removes its line in the lane's own file.
// And a first-party composition renders no section through the kit's shared
// renderers (data-renderer="shared") unless its unit still says coverage:
// 'pending'.

Object.assign(globalThis, { React });

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const OWN = fileURLToPath(new URL('./__fixtures__/reserved-anchor/', import.meta.url));

/** A composition's unit flags the sweep reads (quality/units/<id>.ts). */
interface UnitFlags {
  readonly coverage?: 'pending';
  readonly outlineKnown?: { readonly reason: string; readonly findings: readonly string[] };
}

/** Each registered composition's unit flags, from its quality unit, empty for one with no unit. */
async function unitFlags(): Promise<ReadonlyMap<string, UnitFlags>> {
  const flags = new Map<string, UnitFlags>();
  for (const { manifest } of REGISTRY) {
    const file = `${REPO}quality/units/${manifest.id}.ts`;
    if (!existsSync(file)) continue;
    const unit = (await import(pathToFileURL(file).href)) as UnitFlags;
    flags.set(manifest.id, {
      ...(unit.coverage ? { coverage: unit.coverage } : {}),
      ...(unit.outlineKnown ? { outlineKnown: unit.outlineKnown } : {}),
    });
  }
  return flags;
}

/** The first-party compositions, which render every core kind themselves (F5). */
const FIRST_PARTY = new Set(Object.keys(FIRST_PARTY_PINS));

const PAIRS = [
  ...CONTRACT_FIXTURES.map((fixture) => ({
    name: fixture.name,
    files: fixture.files,
    dir: fixture.files.portfolio.replace(/\/portfolio\.yml$/, ''),
  })),
  {
    name: 'sample',
    files: { portfolio: `${REPO}portfolio.example.yml`, site: `${REPO}site.example.yml` },
    dir: null,
  },
  {
    name: 'reserved-anchor',
    files: { portfolio: `${OWN}portfolio.yml`, site: `${OWN}site.yml` },
    dir: null,
  },
];

/** Home, each work's own page, and each of the manifest's path views without a parameter. */
function visitorRoutes(view: PublicView, manifest: VariantManifest): RouteTarget[] {
  const slugs = [...routedWorks(view).values()].map((path) => path.slice('/work/'.length));
  const targets: RouteTarget[] = [
    { route: 'home' },
    ...slugs.map((slug) => ({ route: 'work' as const, slug })),
  ];
  for (const declared of manifest.routes.views) {
    if (declared.type !== 'path' || declared.segment.includes('{')) continue;
    if (declared.under === 'home') targets.push({ route: 'view', view: declared, params: {} });
    else
      for (const slug of slugs) targets.push({ route: 'view', view: declared, params: {}, slug });
  }
  return targets;
}

interface Sweep {
  /** Each finding's key, and on how many pages it was found. */
  readonly findings: ReadonlyMap<string, number>;
  /** The pages each composition rendered, by `<pair> <path>`. */
  readonly pages: ReadonlyMap<string, readonly string[]>;
  /** The findings' full text, by key, for a failure's message. */
  readonly detail: ReadonlyMap<string, string>;
  /** Each first-party composition's pages that render a shared section, `<pair> <path>`. */
  readonly shared: ReadonlyMap<string, readonly string[]>;
}

let swept: Promise<Sweep> | undefined;

/** Every finding on every page, by the composition that rendered it. Run once. */
function sweep(): Promise<Sweep> {
  swept ??= (async () => {
    const findings = new Map<string, number>();
    const detail = new Map<string, string>();
    const pages = new Map<string, string[]>();
    const shared = new Map<string, string[]>();
    for (const { name, files, dir } of PAIRS) {
      const read = readPair(files);
      assert.ok(read.ok, name);
      if (!read.ok) continue;
      const unit = dir ? readUnitFiles(dir) : { snapshots: {} };
      const view = resolvePortfolioView(
        read.pair,
        {
          snapshots: unit.snapshots,
          ...('media' in unit && unit.media ? { media: unit.media } : {}),
        },
        { mediaBase: '/media' },
      );
      for (const entry of REGISTRY) {
        for (const target of visitorRoutes(view, entry.manifest)) {
          const segments = href(target).split('/').filter(Boolean).map(decodeURIComponent);
          const resolved = await resolveVisitorPath(
            { segments, basePath: '', selected: entry.manifest.id },
            async () => view,
          );
          assert.equal(resolved.kind, 'render', `${name} ${JSON.stringify(target)}`);
          if (resolved.kind !== 'render') continue;
          const { manifest } = resolved.composition.rendered;
          // A page the fallback renders for another selection is the fallback's, checked once.
          if (manifest.id !== entry.manifest.id && entry.manifest.id !== 'fallback') continue;
          const loaded = (await variantLoader(manifest.id)()) as {
            readonly default: React.ComponentType<{ input: unknown }>;
            readonly sections?: SectionComposition;
          };
          const Variant = loaded.default;
          const path = href(resolved.target);
          const rendered = pages.get(manifest.id) ?? [];
          rendered.push(`${name} ${path}`);
          pages.set(manifest.id, rendered);
          for (const idPrefix of ['', 'pv-']) {
            const input = buildRenderInput({
              view,
              manifest,
              route: resolved.target,
              basePath: '',
              origin: 'https://rowan.test',
              requestTime: '2026-01-01T00:00:00Z',
              idPrefix,
            });
            const html = renderToStaticMarkup(<Variant input={input} />);
            if (idPrefix === '' && FIRST_PARTY.has(manifest.id) && rendersSharedSection(html)) {
              shared.set(manifest.id, [...(shared.get(manifest.id) ?? []), `${name} ${path}`]);
            }
            // Home and a view of it render the reading order; a case study renders its work alone.
            const sections =
              resolved.target.route === 'home' ||
              (resolved.target.route === 'view' && resolved.target.view.under === 'home')
                ? pageOutline(input, loaded.sections).sections.map(({ id, anchor }) =>
                    anchor === undefined ? { id } : { id, anchor },
                  )
                : undefined;
            for (const finding of checkOutline(html, input.ids, sections ? { sections } : {})) {
              const where = finding.section ?? finding.at.replaceAll(idPrefix, '');
              const key = `${manifest.id} ${name} ${path} ${finding.code} ${where}`;
              findings.set(key, (findings.get(key) ?? 0) + 1);
              detail.set(key, `${key}: ${finding.message}`);
            }
          }
        }
      }
    }
    return { findings, pages, detail, shared };
  })();
  return swept;
}

test('every registered composition renders home as itself on every pair, and its own case studies', async () => {
  const { pages } = await sweep();
  for (const { manifest } of REGISTRY) {
    const own = pages.get(manifest.id) ?? [];
    for (const { name } of PAIRS) {
      assert.ok(own.includes(`${name} /`), `${manifest.id} renders ${name}'s home`);
    }
  }
});

test('every finding on every page is a known one, found with no prefix and with one, and every known one still happens', async () => {
  const { findings, detail } = await sweep();
  const flags = await unitFlags();
  const known = new Set(
    [...flags.values()].flatMap(({ outlineKnown }) => outlineKnown?.findings ?? []),
  );
  const unexpected = [...findings.keys()].filter((key) => !known.has(key)).sort();
  assert.deepEqual(
    unexpected.map((key) => detail.get(key)),
    [],
    "findings no unit's outlineKnown lists",
  );
  const stale = [...known].filter((key) => !findings.has(key)).sort();
  assert.deepEqual(
    stale,
    [],
    "outlineKnown entries that no longer happen: remove them from the composition's unit",
  );
  for (const key of known) {
    assert.equal(findings.get(key), 2, `${key} is found with no prefix and with pv-`);
  }
});

test("a first-party composition renders no section through the shared renderers unless its unit's coverage is pending", async (t) => {
  const { shared } = await sweep();
  const flags = await unitFlags();
  for (const id of FIRST_PARTY) {
    const pagesWithShared = shared.get(id) ?? [];
    if (flags.get(id)?.coverage === 'pending') {
      t.diagnostic(
        `${id}: coverage pending, ${pagesWithShared.length} pages render a shared section`,
      );
      continue;
    }
    assert.deepEqual(
      pagesWithShared,
      [],
      `${id} renders a shared section on these pages, and its unit says coverage is done`,
    );
  }
});
