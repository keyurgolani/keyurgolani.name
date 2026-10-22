import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createElement, isValidElement, type ReactElement } from 'react';
import {
  parsePortfolio,
  parseSite,
  resolvePortfolioView,
  type ParsedPair,
  type PublicPortfolio,
  type PublicView,
} from '@portfolio/schema';
import { buildRenderInput } from '@portfolio/variant-contract';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { loadComposition, REGISTRY } from '~/lib/variants';

// #4 item 16 and #10 item 5: the published view is the only input to the
// variants, so no hidden section, no record or asset only a hidden section
// reaches, no private record or asset, and no unregistered extension data
// reaches what the server sends a browser. An RSC payload carries what server components render and
// the props of each client component, including data a client component
// never renders. The walk below collects every string of both, for each
// registered variant, the fallback composition included. (The browser suite
// fetches the real payload for the host's variant.)

const PORTFOLIO = `schemaVersion: 3
locale: en
direction: ltr
identity:
  name: Rowan Visible
  extensions:
    '@other/x': { note: canary-unregistered-field }
links:
  - url: https://rowan.test
    label: Site
    extensions:
      '@other/x': { note: canary-link-extension }
practice:
  services:
    - items: [{ name: canary-hidden-practice }]
contact:
  message: canary-hidden-contact
works:
  - id: visible-work
    title: Visible Work
    medium: software
  - id: secret-work
    title: canary-private-record
    medium: writing
    visibility: private
    cover: { asset: secret-cover }
  - id: draft-work
    title: canary-hidden-record
    medium: writing
    cover: { asset: draft-cover }
chronology:
  - id: visible-role
    kind: role
    title: Visible Engineer
    organization: Acme
    period: { start: '2020' }
  - id: hidden-role
    kind: role
    title: canary-hidden-role
    organization: Hidden Org
    period: { start: '2019' }
media:
  - id: secret-cover
    kind: image
    source: covers/secret.png
    alt: canary-private-media
    visibility: private
  - id: draft-cover
    kind: image
    source: covers/draft.png
    alt: canary-hidden-media
sections:
  - kind: hero
    id: top
    tagline: Builds calm software.
  - kind: works
    id: work
    title: Work
    items: [visible-work, secret-work]
  - kind: chronology
    id: roles
    title: Roles
    items: [visible-role]
  - kind: works
    id: drafts
    title: canary-hidden-title
    items: [draft-work]
  - kind: chronology
    id: secret-roles
    title: Hidden roles
    items: [hidden-role]
  - kind: practice
    id: services
    title: Services
    part: services
  - kind: contact
    id: contact
    title: Contact
  - kind: '@other/x/notes'
    id: notes
    title: canary-unregistered-title
    data: { text: canary-unregistered-section }
`;

const SITE = `schemaVersion: 2
appearance:
  variant: missing-variant
  designLanguage: platform-neutral
  colorScheme: warm
  typography: classic
  displayMode: system
visitorControls:
  variant: locked
  designLanguage: locked
  colorScheme: locked
  typography: locked
  displayMode: selectable
motionPolicy: respect-os
features:
  feed: true
sections:
  drafts: { hidden: true }
  secret-roles: { hidden: true }
  services: { hidden: true }
  contact: { hidden: true }
`;

const MARKERS = [
  'canary-unregistered-field',
  'canary-link-extension',
  'canary-hidden-title',
  'canary-hidden-role',
  'canary-hidden-record',
  'canary-hidden-media',
  'canary-hidden-practice',
  'canary-hidden-contact',
  'canary-private-record',
  'canary-private-media',
  'canary-unregistered-title',
  'canary-unregistered-section',
];

function pair(): ParsedPair {
  const portfolio = parsePortfolio(PORTFOLIO, 'yaml');
  const site = parseSite(SITE, 'yaml');
  assert.ok(portfolio.ok, JSON.stringify(portfolio));
  assert.ok(site.ok, JSON.stringify(site));
  return { portfolio: portfolio.value, site: site.value };
}

/** Every export of each `'use client'` module in the kit and the workspace's variant packages. */
async function clientComponents(): Promise<Set<unknown>> {
  const packages = new URL('../../../../packages/', import.meta.url);
  const found = new Set<unknown>();
  for (const name of readdirSync(packages)) {
    const manifest = JSON.parse(readFileSync(new URL(`${name}/package.json`, packages), 'utf8'));
    if (name !== 'kit' && manifest.portfolio?.kind !== 'variant') continue;
    const src = new URL(`${name}/src/`, packages);
    for (const file of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(file) || file.includes('.test.')) continue;
      const url = new URL(file, src);
      if (!/^\s*['"]use client['"]/.test(readFileSync(url, 'utf8'))) continue;
      for (const value of Object.values(await import(url.href))) found.add(value);
    }
  }
  return found;
}

/**
 * Every string an RSC payload for `node` would carry. A server component is
 * rendered and its output walked; a client component's props are walked
 * whole, rendered or not. A component this didn't list as a client one but
 * whose hooks throw outside a render is treated as one too.
 */
async function payloadStrings(
  node: unknown,
  clients: ReadonlySet<unknown>,
  out: string[] = [],
): Promise<string[]> {
  if (typeof node === 'string') {
    out.push(node);
  } else if (node instanceof Promise) {
    await payloadStrings(await node, clients, out);
  } else if (Array.isArray(node)) {
    for (const child of node) await payloadStrings(child, clients, out);
  } else if (isValidElement(node)) {
    const { type, props } = node as ReactElement<Record<string, unknown>>;
    if (typeof type === 'function' && !clients.has(type)) {
      let rendered: unknown;
      try {
        rendered = await (type as (props: unknown) => unknown)(props);
      } catch {
        return payloadStrings(props, clients, out);
      }
      await payloadStrings(rendered, clients, out);
    } else {
      // A client component, a host element, a fragment, or a provider.
      await payloadStrings(props, clients, out);
    }
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) await payloadStrings(value, clients, out);
  }
  return out;
}

const found = (strings: readonly string[]) =>
  MARKERS.filter((marker) => strings.some((text) => text.includes(marker)));

/** A registered variant's element for a view, as the host renders it. */
async function element(id: string, view: PublicView) {
  const entry = REGISTRY.find(({ manifest }) => manifest.id === id)!;
  const input = buildRenderInput({
    view,
    manifest: entry.manifest,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
  });
  return createElement(await loadComposition(id), { input });
}

/** The pair's published view, as the host builds it. */
const viewOf = (input: ParsedPair) => resolvePortfolioView(input, {}, { mediaBase: '/media' });

test('no variant sends a browser a hidden section, a private or unreached record, or unregistered extension data', async () => {
  const clients = await clientComponents();
  const input = pair();
  const view = viewOf(input);
  const ids = REGISTRY.map(({ manifest }) => manifest.id);
  assert.ok(ids.includes('fallback'), ids.join(', '));
  for (const id of ids) {
    const strings = await payloadStrings(await element(id, view), clients);
    // The walk reaches the visible content, rendered or passed as props.
    assert.ok(strings.includes('Rowan Visible') && strings.includes('Visible Engineer'), id);
    assert.deepEqual(found(strings), [], id);

    // Given the parsed pair instead (forced past the type's brand, which
    // otherwise refuses it), the same walk finds the hidden section, so it
    // would see a leak.
    const raw = { ...view, portfolio: input.portfolio as unknown as PublicPortfolio };
    assert.ok(
      found(await payloadStrings(await element(id, raw), clients)).includes('canary-hidden-role'),
      id,
    );
  }
});

test('a variant takes only the public view, by type', () => {
  const input = pair();
  const props = (portfolio: PublicPortfolio) => ({ portfolio });
  // @ts-expect-error A parsed portfolio isn't the public view's.
  assert.ok(props(input.portfolio));
  assert.ok(props(viewOf(input).portfolio));
});
