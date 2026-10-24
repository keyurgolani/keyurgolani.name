// The deployment profiles and what each may do (#1, item 9). Pure data with
// stable IDs: later issues, the route table, the operation registry, and
// proxy.ts all key off this matrix, never off route names. A capability a
// profile doesn't list is absent there. A test fixture's capability is the
// one that depends on the build: on in every profile, or in none, by the
// fixture flags registry generation wrote.

import { FIXTURE_FLAGS } from '../lib/generated/registry.meta';

export const PROFILES = ['owner', 'demo', 'read-only'] as const;
export type Profile = (typeof PROFILES)[number];

/** `public`: anyone. `session`: only with an owner session (#2). */
export type Access = 'public' | 'session';

/**
 * The test fixtures' capabilities (#19, Slice 3; #7's preview fixtures add
 * theirs), each with the build-time flag that turns it on and the flag's key
 * in the generated FIXTURE_FLAGS: a row of scripts/fixture-gate.ts. Only a
 * test build sets one, so a build with the flag grants the capability to
 * anyone in every profile. A build without it grants it in none, and its
 * routes answer as a path no route matches does. The flag counts only when
 * the app is built: set when the server starts, it changes nothing.
 */
export const FIXTURE_CAPABILITIES = {
  'appearance.fixtures': { flag: 'APPEARANCE_FIXTURES', key: 'appearance' },
  // #6's catalog fixture, /studio/_catalog-fixture: owner only, with a session.
  'catalog.fixtures': { flag: 'BUDGET_FIXTURES', key: 'budget', access: 'owner-session' },
} as const satisfies Record<
  string,
  { readonly flag: string; readonly key: string; readonly access?: 'owner-session' }
>;

/** What a fixture capability grants in a build with its flag: anyone, in every profile. */
export const FIXTURE_ACCESS = Object.freeze({
  owner: 'public',
  demo: 'public',
  'read-only': 'public',
} as const satisfies Record<Profile, Access>);

/**
 * What an owner-session fixture capability grants in a build with its flag:
 * the owner with a session, as preview.grant does, and no one else, so demo
 * and read-only answer it as any unknown Studio path.
 */
export const FIXTURE_OWNER_ACCESS = Object.freeze({
  owner: 'session',
} as const satisfies Partial<Record<Profile, Access>>);

/** Whether registry generation ran with the fixture flag whose FIXTURE_FLAGS key is `key`. */
export function builtWithFixtures(key: string): boolean {
  const flags: Readonly<Record<string, boolean | undefined>> = FIXTURE_FLAGS;
  return flags[key] === true;
}

function fixtureGrants(
  capability: keyof typeof FIXTURE_CAPABILITIES,
): Partial<Record<Profile, Access>> {
  const fixture: { readonly key: string; readonly access?: 'owner-session' } =
    FIXTURE_CAPABILITIES[capability];
  if (!builtWithFixtures(fixture.key)) return {};
  return fixture.access === 'owner-session' ? FIXTURE_OWNER_ACCESS : FIXTURE_ACCESS;
}

export const CAPABILITY_MATRIX = {
  // owner: the live revision; demo: the bundled sample; read-only: the
  // revision built at startup.
  'catalog.read': { owner: 'public', demo: 'public', 'read-only': 'public' },
  'feed.read': { owner: 'public', 'read-only': 'public' },
  'sample.read': { demo: 'public' },
  'reference.read': { demo: 'public' }, // #9
  'sandbox.view': { demo: 'public' }, // #9
  'health.read': { owner: 'public', demo: 'public', 'read-only': 'public' },
  'ready.read': { owner: 'public', demo: 'public', 'read-only': 'public' },
  // A visitor's appearance preference cookie (#19, Slice 4). Demo's appearance is the query's.
  'appearance.preference': { owner: 'public', 'read-only': 'public' },
  'auth.session': { owner: 'public' }, // #2
  // Under demo these are browser-local (#9) and never reach the server.
  'source.read': { owner: 'session' },
  'draft.read': { owner: 'session' },
  'history.read': { owner: 'session' },
  // Variant changes included. It writes the draft only, never the live revision.
  'draft.write': { owner: 'session' },
  'config.import': { owner: 'session' },
  'config.export': { owner: 'session' },
  'studio.view': { owner: 'session' }, // #8
  'config.status': { owner: 'session' },
  publish: { owner: 'session' },
  rollback: { owner: 'session' },
  'asset.write': { owner: 'session' },
  // #10: deriving media at a draft save, and fetching a remote image source
  // for it. Never a visitor's: demo and read-only fetch nothing this way.
  'media.ingest': { owner: 'session' },
  'media.fetchRemote': { owner: 'session' },
  'preview.grant': { owner: 'session' }, // #7
  // /_fixtures/appearance (#19, Slice 3), only in a build with APPEARANCE_FIXTURES=1.
  'appearance.fixtures': fixtureGrants('appearance.fixtures'),
  // /studio/_catalog-fixture (#6, item 5), only in a build with BUDGET_FIXTURES, and only to the owner.
  'catalog.fixtures': fixtureGrants('catalog.fixtures'),
} as const satisfies Record<string, Partial<Record<Profile, Access>>>;

export type Capability = keyof typeof CAPABILITY_MATRIX;

export const CAPABILITIES = Object.keys(CAPABILITY_MATRIX) as readonly Capability[];

/** How `profile` grants `capability`, or `absent`. */
export function accessIn(profile: Profile, capability: Capability): Access | 'absent' {
  const grants: Partial<Record<Profile, Access>> = CAPABILITY_MATRIX[capability];
  return grants[profile] ?? 'absent';
}

/**
 * Whether crawlers may index a profile's pages. `demo` asks for nothing to
 * be indexed (#22): proxy.ts sends `X-Robots-Tag: noindex` on every
 * response, robots.txt lets crawlers fetch the pages that say so, the
 * sitemap is empty, and no page carries JSON-LD.
 */
export const INDEXABLE: Readonly<Record<Profile, boolean>> = {
  owner: true,
  demo: false,
  'read-only': true,
};
