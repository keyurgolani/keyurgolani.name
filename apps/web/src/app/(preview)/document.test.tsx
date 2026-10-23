import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parsePortfolio,
  parseSite,
  resolvePortfolioView,
  type PublicView,
} from '@portfolio/schema';
import { experienceHead } from '~/lib/experience-head';
import { readDeploymentConfig } from '~/server/config';
import { setDeploymentState } from '~/server/config-store';

// The preview document (#7, Slice 1, item 3): the previewed unit's language,
// direction, and head, noindex, the page's tree, and an agent that adds
// nothing, with no theme script, Studio markup, or anything else around it.

// The document imports the experience's stylesheets, which Next bundles; Node
// would read them as JavaScript.
(Module as unknown as { _extensions: Record<string, () => void> })._extensions['.css'] = () => {};

const ORIGIN = 'https://rowan.test';

/** An owner deployment, the one profile with preview grants, for the test's length. */
function owner(t: TestContext): void {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: '/srv/config',
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive: () => assert.fail('the document reads no catalog') },
    dispatch: () => assert.fail('the document runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

/** A previewed unit unlike the live site: in Hebrew, right to left. */
function unit(): PublicView {
  const portfolio = parsePortfolio(
    [
      'schemaVersion: 3',
      'locale: he',
      'direction: rtl',
      'identity:',
      '  name: Noa Preview',
      '  tagline: Draws calm maps.',
      'sections:',
      '  - kind: hero',
      '    id: top',
      '',
    ].join('\n'),
    'yaml',
  );
  const site = parseSite(
    [
      'schemaVersion: 2',
      'appearance:',
      '  variant: missing-variant',
      '  designLanguage: platform-neutral',
      '  colorScheme: warm',
      '  typography: classic',
      '  displayMode: dark',
      'visitorControls:',
      '  variant: locked',
      '  designLanguage: locked',
      '  colorScheme: locked',
      '  typography: locked',
      '  displayMode: selectable',
      'motionPolicy: respect-os',
      'features:',
      '  feed: true',
      '',
    ].join('\n'),
    'yaml',
  );
  assert.ok(portfolio.ok && site.ok, JSON.stringify([portfolio, site]));
  return resolvePortfolioView(
    { portfolio: portfolio.value, site: site.value },
    {},
    { mediaBase: '/media' },
  );
}

test("a preview document is in the previewed unit's language and direction, with its JSON-LD, around the page and nothing else", async (t) => {
  owner(t);
  const { PreviewDocument } = await import('./document');
  const view = unit();
  const html = renderToStaticMarkup(
    <PreviewDocument unit={view} origin={ORIGIN}>
      <main id="page">the page</main>
    </PreviewDocument>,
  );
  const jsonLd = experienceHead(view, ORIGIN)
    .jsonLd.map((json) => `<script type="application/ld+json">${json}</script>`)
    .join('');
  assert.ok(jsonLd.includes('Noa Preview'), jsonLd);
  // The agent renders nothing, so the body is the page alone.
  assert.equal(
    html,
    `<html lang="he" dir="rtl"><head>${jsonLd}</head><body><main id="page">the page</main></body></html>`,
  );
  // No theme script, whatever display mode the site selects: the page's
  // document boundary says it instead (#19, Slice 4).
  assert.ok(!html.includes('localStorage'), html);
  assert.ok(!html.includes('data-theme'), html);
});

test("a preview's metadata is the previewed unit's head, noindex, and names no og:url", async (t) => {
  owner(t);
  const { previewMetadata, PREVIEW_ROBOTS } = await import('./document');
  const view = unit();
  assert.deepEqual(previewMetadata(view, ORIGIN), {
    ...experienceHead(view, ORIGIN).metadata,
    robots: { index: false, follow: false },
  });
  assert.deepEqual(PREVIEW_ROBOTS, { index: false, follow: false });
  // The head is the previewed portfolio's, not the live site's.
  assert.equal(previewMetadata(view, ORIGIN).title, 'Noa Preview — Portfolio');
  // A preview frame isn't a route on the live site (#22).
  assert.equal(
    (previewMetadata(view, ORIGIN).openGraph as { url?: unknown } | undefined)?.url,
    undefined,
  );
});

test('the preview agent is a client module that renders nothing, with a channel or without (#7, Slice 3)', async (t) => {
  owner(t);
  const source = readFileSync(
    fileURLToPath(new URL('../../preview/agent.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(source, /^'use client';\n/);
  const { PreviewAgent } = await import('~/preview/agent');
  const channel = {
    mode: 'server',
    studioOrigin: ORIGIN,
    linkBase: '/preview/AAAAAAAAAAAAAAAAAAAAAA',
    nonce: 'BBBBBBBBBBBBBBBBBBBBBB',
    renderedVersion: 3,
  } as const;
  assert.equal(renderToStaticMarkup(<PreviewAgent />), '');
  assert.equal(renderToStaticMarkup(<PreviewAgent channel={channel} />), '');
  // A document with a channel is the same markup as one without.
  const { PreviewDocument } = await import('./document');
  const page = <main id="page">the page</main>;
  assert.equal(
    renderToStaticMarkup(
      <PreviewDocument unit={unit()} origin={ORIGIN} channel={channel}>
        {page}
      </PreviewDocument>,
    ),
    renderToStaticMarkup(
      <PreviewDocument unit={unit()} origin={ORIGIN}>
        {page}
      </PreviewDocument>,
    ),
  );
});

test('no preview module reads cookies or request headers (#7, item 4)', () => {
  // proxy.ts drops the Cookie header from every preview request; this keeps
  // the modules from reaching for it, or for anything else the request says.
  const roots = [
    fileURLToPath(new URL('.', import.meta.url)),
    fileURLToPath(new URL('../../preview/', import.meta.url)),
  ];
  let checked = 0;
  for (const root of roots) {
    let files: string[];
    try {
      files = readdirSync(root, { recursive: true, encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/\.tsx?$/.test(file) || file.includes('.test.')) continue;
      const text = readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(text, /\bcookies\s*\(|next\/headers|document\.cookie/, file);
      checked++;
    }
  }
  assert.ok(checked >= 2, 'the agent and the document, at least');
});

test("a grant's frame reads no cookie, and of the request's headers only its Content-Security-Policy, for the nonce (#7, item 4; #6, Slice 2)", () => {
  // server/preview-page.ts renders the frame's document, and asks
  // server/request-nonce.ts for the nonce the variant's stylesheet carries:
  // the one module on a preview's path that reads a request header, and it
  // reads that one.
  const read = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../../server/${file}`, import.meta.url)), 'utf8');
  const page = read('preview-page.ts');
  assert.doesNotMatch(page, /\bcookies\s*\(|next\/headers|document\.cookie/);
  assert.match(page, /from '\.\/request-nonce'/);
  const nonce = read('request-nonce.ts');
  assert.doesNotMatch(nonce, /\bcookies\s*\(|document\.cookie/);
  assert.deepEqual(
    [...nonce.matchAll(/\.get\(([^)]*)\)/g)].map(([, name]) => name),
    ["'content-security-policy'"],
  );
});
