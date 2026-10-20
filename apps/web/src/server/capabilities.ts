// The deployment profiles and what each may do (#1, item 9). Pure data with
// stable IDs: later issues, the route table, the operation registry, and
// proxy.ts all key off this matrix, never off route names. A capability a
// profile doesn't list is absent there.

export const PROFILES = ['owner', 'demo', 'read-only'] as const;
export type Profile = (typeof PROFILES)[number];

/** `public`: anyone. `session`: only with an owner session (#2). */
export type Access = 'public' | 'session';

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
  'preview.grant': { owner: 'session' }, // #7
} as const satisfies Record<string, Partial<Record<Profile, Access>>>;

export type Capability = keyof typeof CAPABILITY_MATRIX;

export const CAPABILITIES = Object.keys(CAPABILITY_MATRIX) as readonly Capability[];

/** How `profile` grants `capability`, or `absent`. */
export function accessIn(profile: Profile, capability: Capability): Access | 'absent' {
  const grants: Partial<Record<Profile, Access>> = CAPABILITY_MATRIX[capability];
  return grants[profile] ?? 'absent';
}

/**
 * Whether crawlers may index a profile's pages. Until #9 and #22 decide what
 * a demo deployment shows them, `demo` asks for nothing to be indexed:
 * proxy.ts sends `X-Robots-Tag: noindex` on every response, robots.txt
 * disallows `/`, and the sitemap is empty.
 */
export const INDEXABLE: Readonly<Record<Profile, boolean>> = {
  owner: true,
  demo: false,
  'read-only': true,
};
