import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import workerThreads from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePortfolioView, routedWorks, type PublicView } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  href,
  type RouteTarget,
  type VariantManifest,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES } from '@portfolio/variant-contract/node';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { variantLoader } from '~/lib/variant-loaders';
import { REGISTRY } from '~/lib/variants';
import { resolveVisitorPath } from '~/lib/visitor-routes';

// The network-off render (#10, item 8; threat row github-3): with no source
// adapter and no network, every contract fixture and the bundled sample
// render completely, on every visitor route they have, through every
// registered composition, from their documents, the snapshots beside them,
// and nothing else. Every way out is replaced by one that fails the test:
// fetch, which is Node's own undici (no other undici is installed);
// node:http, node:https, node:net, and node:tls, down to a socket's connect;
// node:dgram and node:dns, which send UDP; and node:child_process and
// node:worker_threads, which could do any of it elsewhere.
// Each page renders with react-dom's server renderer, so a component that
// throws fails the test too.

// tsx compiles the variants' JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every pair a published page renders here: the contract fixtures, and the bundled sample. */
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
];

/** A module or prototype as the mocks see it: its functions, by name. */
type Methods = Record<string, (...args: unknown[]) => unknown>;

/** Replaces every way this process could reach a network with one that records it and throws. */
function blockNetwork(t: TestContext): string[] {
  const calls: string[] = [];
  const refuse =
    (what: string) =>
    (...args: unknown[]): never => {
      calls.push(`${what} ${String(args[0])}`);
      throw new Error(`A render called the network: ${what}.`);
    };
  t.mock.method(globalThis, 'fetch', async (input: unknown) => refuse('fetch')(input));
  for (const [name, module] of [
    ['http', http],
    ['https', https],
  ] as const) {
    t.mock.method(module, 'request', refuse(`${name}.request`));
    t.mock.method(module, 'get', refuse(`${name}.get`));
  }
  t.mock.method(net, 'connect', refuse('net.connect'));
  t.mock.method(net, 'createConnection', refuse('net.createConnection'));
  t.mock.method(net.Socket.prototype, 'connect', refuse('net.Socket.connect'));
  t.mock.method(tls, 'connect', refuse('tls.connect'));
  t.mock.method(dgram, 'createSocket', refuse('dgram.createSocket'));
  for (const method of ['send', 'connect', 'bind'] as const) {
    t.mock.method(dgram.Socket.prototype, method, refuse(`dgram.Socket.${method}`));
  }
  // Every lookup and resolve, callback and promise alike.
  for (const [name, module] of [
    ['dns', dns],
    ['dns.promises', dns.promises],
  ] as const) {
    const methods = module as unknown as Methods;
    for (const key of Object.keys(methods)) {
      if (!/^(lookup|resolve|reverse)/.test(key)) continue;
      if (typeof methods[key] !== 'function') continue;
      t.mock.method(methods, key, refuse(`${name}.${key}`));
    }
  }
  t.mock.method(
    childProcess.ChildProcess.prototype as unknown as Methods,
    'spawn',
    refuse('child_process spawn'),
  );
  for (const method of [
    'spawn',
    'exec',
    'execFile',
    'fork',
    'spawnSync',
    'execSync',
    'execFileSync',
  ] as const) {
    t.mock.method(childProcess, method, refuse(`child_process.${method}`));
  }
  t.mock.method(workerThreads, 'Worker', refuse('worker_threads.Worker'));
  // An ESM named import of a builtin, such as `import { lookup } from
  // 'node:dns'`, reads the mocks too.
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}

/**
 * Every visitor route `view` has for a composition: home, each work's case
 * study, and each of the manifest's path views, under home and under each
 * case study. Its fragment views render within their parent route.
 */
function visitorRoutes(view: PublicView, manifest: VariantManifest): RouteTarget[] {
  const slugs = [...routedWorks(view).values()].map((path) => path.slice('/work/'.length));
  const targets: RouteTarget[] = [
    { route: 'home' },
    ...slugs.map((slug) => ({ route: 'work' as const, slug })),
  ];
  for (const declared of manifest.routes.views) {
    if (declared.type !== 'path') continue;
    assert.ok(
      !declared.segment.includes('{'),
      `${manifest.id}'s ${declared.id} takes a parameter: give this test its values`,
    );
    if (declared.under === 'home') targets.push({ route: 'view', view: declared, params: {} });
    else
      for (const slug of slugs) targets.push({ route: 'view', view: declared, params: {}, slug });
  }
  return targets;
}

test('with no adapter and no network, every fixture and the sample render completely, on every visitor route, through every registered composition', async (t) => {
  const calls = blockNetwork(t);
  const ids = REGISTRY.map(({ manifest }) => manifest.id);
  assert.ok(ids.includes('fallback'), ids.join(', '));
  let pages = 0;
  let caseStudies = 0;
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
        const where = `${name} in ${entry.manifest.id}, ${JSON.stringify(target)}`;
        // The composition the host renders the page in: a work page a
        // variant leaves to the host renders in the fallback composition (#10b).
        const segments = href(target).split('/').filter(Boolean).map(decodeURIComponent);
        const resolved = await resolveVisitorPath(
          { segments, basePath: '', selected: entry.manifest.id },
          async () => view,
        );
        assert.equal(resolved.kind, 'render', where);
        if (resolved.kind !== 'render') continue;
        const { manifest } = resolved.composition.rendered;
        const Variant = (await variantLoader(manifest.id)()).default;
        const input = buildRenderInput({
          view,
          manifest,
          route: resolved.target,
          basePath: '',
          origin: 'https://rowan.test',
          requestTime: '2026-01-01T00:00:00Z',
        });
        // A component that throws fails here.
        const html = renderToStaticMarkup(<Variant input={input} />);
        pages += 1;
        if (resolved.target.route === 'work') {
          // A case study's own page: the kit's CaseStudy, with the work's
          // title as the page's one h1.
          const { slug } = resolved.target;
          const work = view.portfolio.works.find((candidate) => candidate.slug === slug);
          assert.ok(work, where);
          assert.ok(html.includes(`data-work-id="${work.id}"`), where);
          const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
          assert.equal(headings.length, 1, where);
          assert.match(headings[0]![0], /pf-case-study__title/, where);
          assert.ok(headings[0]![1]!.includes(escaped(work.title)), where);
          caseStudies += 1;
          continue;
        }
        // Complete: every section lands on the page, its id an element's, and
        // shows its title. A works section's title may go, as when a
        // composition folds one into its chapters, as Obsidian Atelier does
        // (#115). With no sections, the owner's name shows.
        const { sections } = view.portfolio;
        const unplaced = sections
          .map(({ id }) => id)
          .filter((id) => !new RegExp(`\\bid="[^"]*${id}"`).test(html));
        assert.deepEqual(unplaced, [], where);
        const untitled = sections
          .filter((section) => section.kind !== 'works')
          .map((section) => (section as { title?: unknown }).title)
          .filter((title): title is string => typeof title === 'string')
          .filter((title) => !html.includes(escaped(title)));
        assert.deepEqual(untitled, [], where);
        if (sections.length === 0) {
          assert.ok(html.includes(escaped(read.pair.portfolio.identity.name)), where);
        }
      }
    }
  }
  assert.ok(pages > PAIRS.length * REGISTRY.length, 'more than the home pages rendered');
  assert.ok(caseStudies > 0, 'a case study rendered');
  assert.deepEqual(calls, [], 'no render called a source');
});

/** `text` as react-dom writes it into markup. */
function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}
