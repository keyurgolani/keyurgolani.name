import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createElement, isValidElement, type ReactElement } from 'react';
import {
  parsePortfolio,
  parseSite,
  toPublicView,
  type ParsedPair,
  type Portfolio,
} from '@portfolio/schema';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { listManifests, loadVariantModule } from '~/lib/registry';

// Item 16: the public view is the only input to the variants, so neither a
// hidden section nor unregistered extension data reaches what the server
// sends a browser. An RSC payload carries what server components render and
// the props of each client component, including data a client component
// never renders, such as Kinetic Cosmos's hero getting all of `identity`.
// The walk below collects every string of both, for each registered variant.
// (The browser suite fetches the real payload for the host's variant.)

const PORTFOLIO = `schemaVersion: 2
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
sections:
  - kind: hero
    id: top
    tagline: Builds calm software.
  - kind: experience
    id: work
    title: Work
    items:
      - role: Visible Engineer
        organization: Acme
        period: { start: '2020' }
  - kind: experience
    id: secret-work
    title: canary-hidden-title
    items:
      - role: canary-hidden-role
        organization: Hidden Org
        period: { start: '2019' }
  - kind: '@other/x/notes'
    id: notes
    title: canary-unregistered-title
    data: { text: canary-unregistered-section }
`;

const SITE = `schemaVersion: 2
appearance:
  variant: editorial
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
  secret-work: { hidden: true }
`;

const MARKERS = [
  'canary-unregistered-field',
  'canary-link-extension',
  'canary-hidden-title',
  'canary-hidden-role',
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

/** Every export of each `'use client'` module in the kit and the variants. */
async function clientComponents(): Promise<Set<unknown>> {
  const packages = new URL('../../../../packages/', import.meta.url);
  const found = new Set<unknown>();
  for (const name of readdirSync(packages)) {
    if (name !== 'kit' && !name.startsWith('variant-')) continue;
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

test('no variant sends a browser a hidden section or unregistered extension data', async () => {
  const clients = await clientComponents();
  const input = pair();
  const view = toPublicView(input);
  const slugs = listManifests().map(({ slug }) => slug);
  assert.ok(slugs.includes('editorial') && slugs.includes('kinetic-cosmos'), slugs.join(', '));
  for (const slug of slugs) {
    const variant = await loadVariantModule(slug);
    assert.ok(variant, slug);
    const render = (portfolio: Portfolio) =>
      payloadStrings(
        createElement(variant.default, { portfolio, colorScheme: 'warm', typography: 'classic' }),
        clients,
      );

    const strings = await render(view.portfolio);
    // The walk reaches the visible content, rendered or passed as props.
    assert.ok(strings.includes('Rowan Visible') && strings.includes('Visible Engineer'), slug);
    assert.deepEqual(found(strings), [], slug);

    // Given the parsed pair instead, the same walk finds the hidden section,
    // so it would see a leak.
    assert.ok(found(await render(input.portfolio)).includes('canary-hidden-role'), slug);
  }
});

test("Kinetic Cosmos's client components get identity and links whole", async () => {
  // Why the view matters even for data no variant renders: the hero's props
  // carry identity.extensions and each link's extensions into the payload.
  const clients = await clientComponents();
  const variant = await loadVariantModule('kinetic-cosmos');
  assert.ok(variant);
  const strings = await payloadStrings(
    createElement(variant.default, { portfolio: pair().portfolio }),
    clients,
  );
  assert.ok(found(strings).includes('canary-unregistered-field'));
  assert.ok(found(strings).includes('canary-link-extension'));
});
