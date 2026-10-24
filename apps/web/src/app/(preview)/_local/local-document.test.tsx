import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { axisFallback } from '@portfolio/appearance';
import { FALLBACK_APPEARANCE, resolveDocumentAppearance } from '~/lib/document-appearance-core';
import { frameSandbox } from '~/lib/preview-frame';
import { runImport } from '~/lib/demo/import/pipeline';
import {
  CANARY,
  EXAMPLE,
  HOSTILE_FIXTURES,
  pairFiles,
  portfolioWith,
} from '~/lib/demo/import/test-support/hostile';
import { VARIANT_LOADERS } from '~/lib/generated/registry.loaders';
import { localCatalog } from '~/server/local-catalog';
import { localRegistries } from '~/lib/local-catalog';
import type { LocalDocumentMessage, LocalRender } from './local-document';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The kit's sections import their stylesheet, which Next bundles. Outside
// Next a stylesheet resolves to an empty module.
const SERVER_ONLY = createRequire(import.meta.url).resolve('server-only');
const EMPTY = pathToFileURL(join(dirname(SERVER_ONLY), 'empty.js')).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier.endsWith('.css')
      ? { url: EMPTY, shortCircuit: true }
      : nextResolve(specifier, context),
});

// Demo Studio's local preview frame (#7, Slice 6; #9): a document Studio
// sends renders in the browser, checked again, through the server's own
// Markdown post-pass, with no media URL the content names, and inert
// whatever it holds. Markdown renders nothing until the post-pass is in.
// Node runs each test file in a process of its own: the post-pass this file
// installs is its document's.

const ORIGIN = 'https://demo.rowan.test';

// A document, as the frame is: the post-pass installs in one alone.
Object.assign(globalThis, { window: globalThis, document: {} });
const registries = localRegistries(localCatalog());

async function frame() {
  return import('./local-document');
}

/** A pair of files as the document message Studio sends: #137's import's own sources. */
function documentOf(
  files: ReturnType<typeof pairFiles>,
  selection: Record<string, string> = {},
): LocalDocumentMessage {
  const imported = runImport(files);
  assert.equal(imported.kind, 'imported', JSON.stringify(imported));
  if (imported.kind !== 'imported') throw new Error('not imported');
  return { sources: imported.unit.sources, selection };
}

/** The markup of `render` in its composition. */
async function markup(render: LocalRender): Promise<string> {
  assert.equal(render.kind, 'render');
  if (render.kind !== 'render') return '';
  const { LocalDocumentView } = await frame();
  const load = VARIANT_LOADERS[render.composition.rendered.manifest.id]!;
  const { default: Variant } = await load();
  return renderToStaticMarkup(
    <LocalDocumentView render={render} registries={registries} Variant={Variant} nonce="n0nce" />,
  );
}

/** Every URL an attribute of `html` loads from: what a browser fetches as it renders. */
const loads = (html: string) =>
  [...html.matchAll(/\s(?:src|srcset|poster|data)="([^"]*)"/g)].map(([, value]) => value!);

/** Every URL an attribute of `html` names. */
const urls = (html: string) =>
  [...html.matchAll(/\s(?:href|src|srcset|poster|action|formaction|xlink:href)="([^"]*)"/g)].map(
    ([, value]) => value!,
  );

test("the local frame is sandboxed to scripts alone, under every profile's rule for demo, a preview origin or none", () => {
  for (const previewOrigin of [null, 'https://preview.rowan.test']) {
    assert.equal(frameSandbox('demo', previewOrigin, true), 'allow-scripts', String(previewOrigin));
  }
});

test('the frame shows no document until the post-pass is in, and none when it fails to load', async () => {
  const { frameView } = await frame();
  const shown = { render: {} as never, Variant: (() => null) as never };
  assert.equal(frameView('loading', shown, false).kind, 'waiting');
  assert.equal(frameView('failed', shown, false).kind, 'unavailable');
  assert.equal(frameView('failed', null, false).kind, 'unavailable');
  assert.equal(frameView('ready', null, false).kind, 'waiting');
  assert.equal(frameView('ready', shown, true).kind, 'not-rendered');
  assert.equal(frameView('ready', shown, false).kind, 'document');
});

test('the example renders in the composition its site selects, and in each one Studio selects', async () => {
  const { installPostPass } = await import('@portfolio/kit/markdown-local');
  await installPostPass();
  const { renderLocal } = await frame();
  const base = await renderLocal({
    document: documentOf(pairFiles(EXAMPLE.portfolio)),
    route: '/',
    registries,
    origin: ORIGIN,
  });
  assert.equal(
    base.kind === 'render' && base.composition.rendered.manifest.id,
    'editorial-evidence',
  );
  assert.match(await markup(base), /Anamika Devi/);
  for (const { manifest } of registries.variants) {
    if (manifest.id === 'fallback') continue;
    const render = await renderLocal({
      document: documentOf(pairFiles(EXAMPLE.portfolio), { variant: manifest.id }),
      route: '/',
      registries,
      origin: ORIGIN,
    });
    assert.equal(render.kind === 'render' && render.appearance.selection.variant, manifest.id);
    const html = await markup(render);
    assert.match(html, new RegExp(`data-variant="${manifest.id}"`), manifest.id);
    // Links stay below the frame's link base.
    for (const url of urls(html).filter((each) => each.startsWith('/'))) {
      assert.match(
        url,
        /^\/(?:preview\/local(?:\/|#|$)|_next\/|_portfolio\/)/,
        `${manifest.id} ${url}`,
      );
    }
  }
});

/** Link markup a document could name, in Markdown and in plain-text fields, to make the frame fetch. */
const LINKS = [
  `<link rel="prefetch" href="https://evil.example/${CANARY}-prefetch">`,
  `<link rel=preconnect href=//evil.example/${CANARY}-preconnect>`,
  `<LINK REL="dns-prefetch" HREF="https://evil.example/${CANARY}-dns">`,
  `<link rel="stylesheet" href="https://evil.example/${CANARY}.css">`,
].join(' ');

test("link markup in a document's Markdown and plain-text fields renders no <link> element in any composition, so content can't make the frame prefetch (threat preview-7)", async () => {
  const { installPostPass } = await import('@portfolio/kit/markdown-local');
  await installPostPass();
  const { renderLocal } = await frame();
  const portfolio = portfolioWith((data) => {
    (data.practice as Record<string, unknown>).thesis = `Before ${LINKS} after.`;
    const [work] = data.works as { summary?: string; description?: string }[];
    work!.summary = LINKS;
    work!.description = `A list:\n\n- ${LINKS}\n\n> ${LINKS}`;
    (data.identity as Record<string, unknown>).tagline = LINKS;
  });
  for (const { manifest } of registries.variants.filter(
    ({ manifest }) => manifest.id !== 'fallback',
  )) {
    for (const route of ['/']) {
      const render = await renderLocal({
        document: documentOf(pairFiles(portfolio), { variant: manifest.id }),
        route,
        registries,
        origin: ORIGIN,
      });
      const html = await markup(render);
      const what = `${manifest.id} ${route}`;
      // The only <link> elements are the frame's own stylesheets, from the build's files.
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag);
      for (const tag of links) {
        assert.match(tag, /^<link rel="stylesheet" href="\/_portfolio\//, `${what}: ${tag}`);
      }
      assert.doesNotMatch(html, /<link\b[^>]*(?:prefetch|preconnect|evil\.example)/i, what);
      assert.doesNotMatch(html, new RegExp(`<[^>]*${CANARY}[^>]*>`), what);
    }
  }
});

test("every hostile fixture the import takes renders inert in every composition, through the server's post-pass", async () => {
  const { installPostPass } = await import('@portfolio/kit/markdown-local');
  await installPostPass();
  const { renderLocal } = await frame();
  let checked = 0;
  for (const fixture of HOSTILE_FIXTURES.filter(({ expect }) => expect === 'imported')) {
    for (const { manifest } of registries.variants.filter(
      ({ manifest }) => manifest.id !== 'fallback',
    )) {
      const render = await renderLocal({
        document: documentOf(fixture.files, { variant: manifest.id }),
        route: '/',
        registries,
        origin: ORIGIN,
      });
      const html = await markup(render);
      const what = `${fixture.name}, ${manifest.id}`;
      // What the content says is text: no element it names, no attribute it sets.
      assert.doesNotMatch(html, /<script/i, what);
      assert.doesNotMatch(html, /<[^>]*\son[a-z]+=/i, what);
      assert.doesNotMatch(html, new RegExp(`<[^>]*${CANARY}[^>]*>`), what);
      for (const url of urls(html)) {
        assert.doesNotMatch(url, /^\s*(?:javascript|vbscript|data):/i, `${what}: ${url}`);
        assert.ok(!url.includes(CANARY), `${what}: ${url}`);
      }
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test("no media source the content names reaches the page: a remote one renders as Not loaded in the demo, and a data: one doesn't import", async () => {
  const { installPostPass } = await import('@portfolio/kit/markdown-local');
  await installPostPass();
  const { renderLocal } = await frame();
  const remote = `https://evil.example/${CANARY}.png`;
  const inline = `data:image/png;base64,${Buffer.from(CANARY).toString('base64')}`;
  const portfolio = portfolioWith((data) => {
    const media = data.media as { source: string; kind: string }[];
    media[0]!.source = remote;
    media[1]!.source = remote.replace('.png', '.mp4');
    media[1]!.kind = 'video';
  });
  // #4's MediaSourceSchema refuses a data: source, so content can't name one.
  const withData = runImport(
    pairFiles(
      portfolioWith((data) => {
        (data.media as { source: string }[])[0]!.source = inline;
      }),
    ),
  );
  assert.equal(withData.kind, 'refused');
  let shownNotLoaded = 0;
  for (const { manifest } of registries.variants.filter(
    ({ manifest }) => manifest.id !== 'fallback',
  )) {
    const html = await markup(
      await renderLocal({
        document: documentOf(pairFiles(portfolio), { variant: manifest.id }),
        route: '/',
        registries,
        origin: ORIGIN,
      }),
    );
    assert.ok(!html.includes('evil.example'), manifest.id);
    // A placeholder says why: the demo loads no media, never that it's still processing.
    assert.doesNotMatch(html, /data-media-reason="(?!not-loaded")/, manifest.id);
    if (/data-media-reason=/.test(html)) {
      shownNotLoaded += 1;
      assert.match(html, /Not loaded in the demo/, manifest.id);
    }
    assert.ok(!html.includes(Buffer.from(CANARY).toString('base64')), manifest.id);
    // Nothing loads from anywhere but the build's own files.
    for (const url of loads(html)) {
      assert.doesNotMatch(url, /^(?:https?:|data:|blob:|\/\/)/, `${manifest.id}: ${url}`);
    }
  }
  assert.ok(shownNotLoaded > 0, 'some composition shows a media placeholder');
});

test('a document that fails the check, or a route it has no page at, renders nothing', async () => {
  const { renderLocal } = await frame();
  const invalid = await renderLocal({
    document: {
      sources: {
        portfolio: { name: 'portfolio.yml', format: 'yaml', text: 'schemaVersion: 3\n' },
        site: { name: 'site.yml', format: 'yaml', text: EXAMPLE.site },
      },
      selection: {},
    },
    route: '/',
    registries,
    origin: ORIGIN,
  });
  assert.deepEqual(invalid, { kind: 'invalid' });
  const missing = await renderLocal({
    document: documentOf(pairFiles(EXAMPLE.portfolio)),
    route: '/work/no-such-work',
    registries,
    origin: ORIGIN,
  });
  assert.deepEqual(missing, { kind: 'not-found' });
});

test('a selection sets only the five appearance axes, as text', async () => {
  const { withSelection } = await frame();
  const run = runImport(pairFiles(EXAMPLE.portfolio));
  if (run.kind !== 'imported') throw new Error('not imported');
  const site = withSelection(run.unit.models.site, {
    variant: 'kinetic-cosmos',
    displayMode: 'dark',
    motionPolicy: 'always',
    routes: 'x',
  });
  assert.equal(site.appearance.variant, 'kinetic-cosmos');
  assert.equal(site.appearance.displayMode, 'dark');
  assert.equal(site.motionPolicy, run.unit.models.site.motionPolicy);
  assert.deepEqual(site.routes, run.unit.models.site.routes);
});

test("the frame's module installs the post-pass, and its page renders no document on the server", () => {
  const shell = readFileSync(new URL('./local-preview.tsx', import.meta.url), 'utf8');
  assert.match(shell, /ssr: false/);
  assert.match(shell, /import\('\.\/local-document'\)/);
  // The frame installs the kit's own post-pass by default, before any document renders.
  const frame = readFileSync(new URL('./local-document.tsx', import.meta.url), 'utf8');
  assert.match(frame, /\binstall = installPostPass\b/);
  assert.match(frame, /install\(\)\.then\(/);
  const page = readFileSync(new URL('../preview/local/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /getLive|readLive|catalog\.getLive|getPublicView/);
});

/** brand-seed's committed record as #10 would store it: a well-formed entry, which renders its own sets. */
function storedBrandSeed(): unknown {
  const record = JSON.parse(
    readFileSync(
      new URL(
        '../../../../../../packages/appearance-schemes/generated/brand-seed.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { result: { generator: unknown; input: { seedColor: string }; tokens: unknown } };
  return {
    generator: record.result.generator,
    inputsHash: createHash('sha256').update(record.result.input.seedColor).digest('hex'),
    tokens: record.result.tokens,
  };
}

test("an imported site that names a generated scheme renders the axis fallback in /preview/local: stored schemes are an owner revision's, the demo has none, and nothing imported pulls stored data in", async () => {
  const { installPostPass } = await import('@portfolio/kit/markdown-local');
  await installPostPass();
  const { renderLocal } = await frame();
  const stored = { 'brand-seed': storedBrandSeed() };
  // The entry is well formed: given to the resolver, it renders brand-seed itself.
  const given = resolveDocumentAppearance({
    site: { appearance: { ...FALLBACK_APPEARANCE, colorScheme: 'brand-seed' } } as never,
    variant: 'fallback',
    profile: 'demo',
    registry: registries.appearance,
    schemes: stored,
  });
  assert.equal(given.selection.colorScheme, 'brand-seed');

  const site = EXAMPLE.site.replace('  colorScheme: warm-parchment', '  colorScheme: brand-seed');
  assert.notEqual(site, EXAMPLE.site);
  const message = documentOf(pairFiles(EXAMPLE.portfolio, site));
  // Stored data offered everywhere the frame might look, each read recorded: on the
  // message, and in the browser's stores. No network either.
  const reads: string[] = [];
  const offered = Object.create(null) as Record<string, unknown>;
  for (const key of ['schemes', 'derived', 'snapshots']) {
    Object.defineProperty(offered, key, {
      get: () => (reads.push(`message.${key}`), key === 'schemes' ? stored : { schemes: stored }),
    });
  }
  const trapped = Object.assign(offered, message) as LocalDocumentMessage;
  const globals = [
    'fetch',
    'XMLHttpRequest',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'caches',
  ];
  const kept = globals.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const key of globals) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => {
        reads.push(key);
        throw new Error(`the frame read ${key}`);
      },
    });
  }
  let render: LocalRender;
  try {
    render = await renderLocal({ document: trapped, route: '/', registries, origin: ORIGIN });
  } finally {
    for (const [key, descriptor] of kept) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
  assert.deepEqual(reads, [], 'nothing stored was read, and nothing fetched');
  assert.equal(render.kind, 'render');
  if (render.kind !== 'render') return;
  assert.equal(render.appearance.selection.colorScheme, axisFallback('colorScheme'));
  assert.ok(render.appearance.fallbackAxes.includes('colorScheme'));
  assert.deepEqual(
    render.appearance.diagnostics
      .filter(({ axis }) => axis === 'colorScheme')
      .map(({ code }) => code),
    ['appearance.input-missing'],
  );
});
