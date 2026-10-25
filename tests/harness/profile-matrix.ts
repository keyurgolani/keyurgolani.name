// The route-level matrix (#1, AC4) for one profile, generated from the route
// table and the operation registry and run against the built server: every
// page, route, and operation the profile doesn't serve fails closed, and
// each one it serves answers. Every response the app sends carries the
// baseline headers and no cookie, and under a profile crawlers may not index
// (demo), says so; Next's trailing-slash 308s, which come before the app,
// point at the canonical path. Health and readiness answer their documented
// shapes, and the canary scan (#1, Verification item 2) finds no path,
// secret, or config summary in any response. A spec runs it for the profile
// its app options start: read-only and demo, and owner with the password
// provider (#2), whose password and hash join the canaries.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { parse } from 'yaml';
import type * as FixtureGate from '../../apps/web/scripts/fixture-gate';
import type * as PreviewStatus from '../../apps/web/src/preview/status';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import {
  CANARY_BODY,
  CANARY_DATA,
  CANARY_SECRET,
  CANARY_SOURCE,
  canaries as leakCanaries,
  FORGED_LINE,
  HOPS_FILE,
  IMAGE_PROBE,
} from './canaries.mjs';
import { DEFAULT_SITE } from './app-server.mjs';
import { expect, test, type App, type AppOptions } from './fixtures';
import { REFERENCE_MOUNT } from './reference-fixture';
import { VARIANTS } from './registry';
import {
  headerProblems,
  isPreviewPath,
  isSharedAsset,
  isStudioPath,
  withoutNonces,
} from './route-headers.mjs';
import { withRscHash } from './rsc';
import { concrete, scanTargets } from './scan-targets';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn, CAPABILITIES, INDEXABLE, PROFILES } =
  require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { fixtureFlags } = require('../../apps/web/scripts/fixture-gate.ts') as typeof FixtureGate;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listExperienceRoutes, listRoutes, RETIRED_PATTERNS, routeAccess, serves } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;
const { PREVIEW_STATUS_DOCUMENT, PREVIEW_STATUS_TYPE } =
  require('../../apps/web/src/preview/status.ts') as typeof PreviewStatus;
type Profile = Capabilities.Profile;
type Operation = Operations.Operation;

/** Where the registry writes #19's compiled packs, which the app serves under /_portfolio/pack/. */
const PACKS = fileURLToPath(new URL('../../apps/web/public/_portfolio/pack/', import.meta.url));
/** Every directory of content-hashed files it writes under public/_portfolio/ (#6). */
const SERVED_DIRS = ['pack', 'font', 'variant', 'asset', 'still'] as const;
/** What each of those files is served with (#6, item 8): apps/web/src/server/cache-rules.ts. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Each file the registry wrote under public/_portfolio/, by the path it's served at. */
export function portfolioFiles(): string[] {
  return SERVED_DIRS.flatMap((dir) => {
    const at = fileURLToPath(new URL(`../../apps/web/public/_portfolio/${dir}/`, import.meta.url));
    return existsSync(at)
      ? readdirSync(at, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map(({ name }) => `/_portfolio/${dir}/${name}`)
      : [];
  });
}

/** A _FILE every profile reads, in a canary-named directory. */
const ENV_FILES: AppOptions['envFiles'] = {
  [HOPS_FILE.key]: { path: `${CANARY_SECRET}/${HOPS_FILE.name}`, text: HOPS_FILE.text },
};

/** The read-only profile on the harness fixture, seeded for the canary scan. */
export const READ_ONLY_APP: AppOptions = { sourceName: CANARY_SOURCE, envFiles: ENV_FILES };

/**
 * The demo profile on the bundled sample pair, with no source directory:
 * demo reads none. It mounts a copy of the CI reference fixture, so the
 * matrix runs the read-only reference's routes served (#9).
 */
export const DEMO_APP: AppOptions = {
  env: {
    PORTFOLIO_PROFILE: 'demo',
    PORTFOLIO_SOURCE_DIR: '',
    PORTFOLIO_REFERENCE_DIR: REFERENCE_MOUNT,
  },
  envFiles: ENV_FILES,
  portfolio: null,
  site: null,
};

/**
 * The owner profile on the harness fixture with the password provider (#2):
 * `hash` in a _FILE beside the hop count, and a data directory made for the
 * run, each at a canary path.
 */
export function ownerApp(hash: string): AppOptions {
  return {
    sourceName: CANARY_SOURCE,
    dataName: CANARY_DATA,
    env: { PORTFOLIO_PROFILE: 'owner' },
    envFiles: {
      ...ENV_FILES,
      PORTFOLIO_AUTH_PASSWORD_HASH_FILE: {
        path: `${CANARY_SECRET}/owner_password_hash`,
        text: `${hash}\n`,
      },
    },
  };
}

export interface MatrixOptions {
  /** The run's own secrets, such as owner's password and its hash, which no response may carry. */
  readonly secrets?: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
/** Every method a client can send a path, for the checks that compare two paths' answers. */
const EVERY_METHOD = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const;

/**
 * Studio paths in every spelling a request may use (#2): the pages the table
 * lists, in another case, deeper than any page, with a fixed segment
 * percent-encoded, and with the slash encoded. Under a profile with no
 * Studio, each one answers every method as /no-such-page does.
 */
const STUDIO_SPELLINGS = [
  '/studio',
  '/studio/sign-in',
  '/studio/sign-in?state=failed&returnTo=%2Fstudio',
  '/Studio',
  '/STUDIO/sign-in',
  '/sTuDiO/x',
  '/studio/nowhere',
  '/studio/sign-in/x',
  '/%73tudio',
  '/%73tudio/sign-in',
  '/studio/%73ign-in',
  '/studio%2Fsign-in',
  '/%73tudio%2Fsign-in',
] as const;

/**
 * Preview paths in every spelling a request may use (#7): /preview and
 * /preview-assets and below, with a query, in another case, percent-encoded,
 * and with the slash encoded. No preview route but a grant's serves any of
 * them in a production build, the dev fixture route included. Under a
 * profile with no grant route, each answers every method as a preview path
 * no route matches does, under the preview's headers. Under one with grant
 * routes (owner, Slice 2), no grant is active in the matrix, so each one
 * gets the status document.
 */
const PREVIEW_SPELLINGS = [
  '/preview',
  '/preview/editorial',
  '/preview/g_7Hk-2/work/tide-tables?displayMode=dark',
  // The dev fixture route (#7, item 8), which only `next dev` serves: a
  // production build answers it as a path no route matches, in any spelling.
  '/preview/dev/fallback/complete',
  '/preview/dev/fallback/complete?displayMode=dark&motion=reduce',
  '/Preview/Dev/fallback/complete',
  '/preview/%64ev/fallback/complete',
  '/preview-assets',
  '/preview-assets/g_7Hk-2/asset/abc/large.webp',
  '/PREVIEW/x',
  '/Preview-Assets/x',
  '/%70review/x',
  '/preview%2Fx',
] as const;

/**
 * The pattern's concrete path once for each of its fixed segments, with that
 * segment's first character percent-encoded, as /%66eed.xml spells
 * /feed.xml. The route table reads it as the route; Next, which matches a
 * fixed segment as sent, as another path (#5, Slice 4).
 */
function encodedSpellings(pattern: string): string[] {
  const parts = pattern.split('/').filter(Boolean);
  const sent = concrete(pattern).split('/').filter(Boolean);
  return parts.flatMap((part, index) => {
    const segment = sent[index];
    if (part.startsWith('[') || segment === undefined) return [];
    const encoded = `%${segment.charCodeAt(0).toString(16).toUpperCase()}${segment.slice(1)}`;
    return [`/${sent.map((each, at) => (at === index ? encoded : each)).join('/')}`];
  });
}

/**
 * Paths that are a route file's own, as sent or decoded whole: each page
 * pattern with a dynamic segment written out, and again with its brackets
 * encoded, each fixed route of two segments or more with its slashes
 * encoded, and Next's /_not-found with its underscore encoded. The route
 * table finds each one names nothing, but Next's file check finds a route
 * file for it (#5, Slice 4).
 */
function routeFileSpellings(): string[] {
  const spellings = new Set(['/%5Fnot-found']);
  for (const { kind, pattern } of listRoutes()) {
    if (kind === 'page' && pattern.includes('[')) {
      spellings.add(pattern);
      spellings.add(pattern.replace(/\[/g, '%5B').replace(/\]/g, '%5D'));
    } else if (!pattern.includes('[') && pattern.indexOf('/', 1) > 0) {
      spellings.add(pattern.replace(/(?!^)\//g, '%2F'));
    }
  }
  return [...spellings];
}

/**
 * A page whose concrete path names nothing it can render: no installed
 * variant declares a view at /probe, and no live revision routes a case
 * study at /work/probe (#5, Slice 4; #10b). The route table calls it missing in every profile, so a
 * GET gets the app's 404 page, rendered from the server, and any other
 * method the proxy's plain 404, as an absent route does. A grant page's
 * /preview/probe is a grant, never a view (#7).
 */
/** The live media's renditions (#10). */
const MEDIA_PATTERN = '/media/[...path]';
/** The read-only reference's renditions (#9), which answer as /media's do. */
const REFERENCE_MEDIA_PATTERN = '/reference/media/[...path]';

/** A live revision's generated schemes' stylesheets (#20). */
const SCHEME_PATTERN = '/_portfolio/scheme/[file]';

const namesNothing = (entry: Routes.RouteEntry) =>
  entry.kind === 'page' && entry.grant === undefined && concrete(entry.pattern).includes('probe');

/**
 * A table route no profile of this build serves, as the appearance fixtures
 * are in a build made without APPEARANCE_FIXTURES=1 (#19, Slice 3). The
 * route table calls it absent and unknown, so in every profile it answers as
 * a path no route matches does.
 */
const unbuilt = (entry: Routes.RouteEntry) =>
  PROFILES.every((each) => routeAccess(each, entry) === 'absent');

/**
 * An unbuilt route that answers as a path no route matches in every profile.
 * A preview route this build doesn't serve, such as the dev fixture route
 * outside `next dev`, is unbuilt too, but under a profile with grant routes
 * the preview gate answers it with the status document instead (#7), and
 * the preview spelling checks below cover it.
 */
const unknownEverywhere = (entry: Routes.RouteEntry) =>
  unbuilt(entry) && !isPreviewPath(entry.pattern) && !isStudioPath(entry.pattern);

/**
 * A Studio route no profile of this build serves, as #6's catalog fixture is
 * in a build made without BUDGET_FIXTURES. Under owner it answers as any
 * unknown Studio path does, with Studio's headers; under demo and read-only
 * as any path no route matches.
 */
const unknownStudio = (entry: Routes.RouteEntry) => unbuilt(entry) && isStudioPath(entry.pattern);

/** Whether this run says the build under test was made with BUDGET_FIXTURES, from its environment. */
const BUDGET_BUILT = fixtureFlags(process.env).budget === true;

/**
 * Whether this run says the build under test was made with the appearance
 * fixtures: APPEARANCE_FIXTURES=1 here too, as when it was built. Unless it
 * says so, /_fixtures/appearance must be a route the build serves nowhere.
 * The answer comes from the run's environment, never from the capability
 * code, which decides what the server under test serves.
 */
const FIXTURES_BUILT = fixtureFlags(process.env).appearance === true;

/**
 * Each table route no profile of this build serves, in every spelling a
 * request may use: as listed, with a query, in another case, deeper, with a
 * fixed segment percent-encoded, and with its slashes encoded. Each one
 * answers every method as /no-such-page does.
 */
function unbuiltSpellings(): string[] {
  return listRoutes()
    .filter(unknownEverywhere)
    .flatMap(({ pattern }) => {
      const path = concrete(pattern);
      return [
        path,
        `${path}?view=all`,
        path.toUpperCase(),
        `${path}/x`,
        ...encodedSpellings(pattern),
        ...(path.indexOf('/', 1) > 0 ? [path.replace(/(?!^)\//g, '%2F')] : []),
      ];
    });
}

/**
 * The visitor pages `profile` serves at a path that names one (#6, Slice 2):
 * each renders in its composition's experience segment, which proxy.ts names
 * and next.config.ts rewrites it to, and exists for GET and HEAD alone.
 */
const visitorPages = (profile: Profile) =>
  listRoutes()
    .filter(
      (entry) =>
        entry.experience && routeAccess(profile, entry) !== 'absent' && !namesNothing(entry),
    )
    .map((entry) => concrete(entry.pattern));

/**
 * Each experience segment's path in every spelling a request may use (#6,
 * Slice 2), with what a path no route matches answers it the same: as
 * written, deeper, with a query and with `_rsc`, in another case, with a
 * fixed segment percent-encoded, %5F among them, with its slashes encoded,
 * and with an `.rsc` suffix. Only a request proxy.ts marks reaches one, so
 * each answers every method as its counterpart under /no-such-page does.
 */
function experienceSpellings(): (readonly [target: string, unknown: string])[] {
  return listExperienceRoutes().flatMap(({ pattern }) => {
    const path = concrete(pattern);
    return [
      [path, '/no-such-page'],
      [`${path}/work/tide-tables`, '/no-such-page/work/tide-tables'],
      [`${path}?view=all`, '/no-such-page?view=all'],
      [`${path}?_rsc=probe`, '/no-such-page?_rsc=probe'],
      [path.toUpperCase(), '/NO-SUCH-PAGE'],
      ...encodedSpellings(pattern).map((spelling) => [spelling, '/no-such-page'] as const),
      [path.replace(/(?!^)\//g, '%2F'), '/no-such-page'],
      [`${path}.rsc`, '/no-such-page.rsc'],
    ] as const;
  });
}

/** What the transport answers a visitor with no session, by the registry and the matrix. */
function expected(
  profile: Profile,
  operation: Operation,
  method: string,
): [status: number, code: string | null] {
  if (accessIn(profile, operation.capability) === 'absent') {
    return [404, 'not_available_in_profile'];
  }
  if (method !== (operation.kind === 'query' ? 'GET' : 'POST')) return [405, 'method_not_allowed'];
  if (operation.session) return [401, 'authentication_required'];
  // These requests send no Origin, so the origin check refuses every
  // command: owner's provider wants the exact one, and the other profiles
  // bind no provider, whose check refuses them all.
  if (operation.kind === 'command') return [403, 'request_origin_rejected'];
  return [200, null];
}

/** The site document each profile's app serves here: the harness fixture, or the bundled sample. */
const SERVED_SITES: Partial<Record<Profile, string>> = {
  'read-only': DEFAULT_SITE,
  owner: DEFAULT_SITE,
  demo: fileURLToPath(new URL('../../site.example.yml', import.meta.url)),
};

/**
 * The packs check: `ok` when this build registers the variant the profile's
 * site selects, and `degraded` while the fallback composition renders in its
 * place (#5), as it does for the harness fixture's missing-variant.
 */
function packsStatus(profile: Profile): 'ok' | 'degraded' {
  const site = SERVED_SITES[profile];
  if (!site) throw new Error(`No ${profile} app runs the matrix against the built server.`);
  const selected = (parse(readFileSync(site, 'utf8')) as { appearance: { variant: string } })
    .appearance.variant;
  return VARIANTS.some(({ manifest }) => manifest.id === selected) ? 'ok' : 'degraded';
}

/** What /api/ready answers for a profile whose checks pass, or the packs check only degrades. */
function readyBody(profile: Profile) {
  const packs = packsStatus(profile);
  return {
    status: packs === 'ok' ? 'ready' : 'degraded',
    profile,
    capabilities: CAPABILITIES.flatMap((id) => {
      const access = accessIn(profile, id);
      return access === 'absent' ? [] : [{ id, access }];
    }),
    checks: [
      { id: 'catalog', status: 'ok' },
      { id: 'packs', status: packs },
      // Owner probes its data directory (#3, item 23); the others check no owner code loaded.
      ...(profile === 'owner'
        ? [{ id: 'data-directory', status: 'ok' }]
        : [{ id: 'owner-modules', status: 'ok' }]),
    ],
  };
}

/** Whether `profile` serves a Studio page, as owner does: under another, /studio is as unknown as any path (#2). */
const hasStudio = (profile: Profile) =>
  listRoutes().some(
    (entry) =>
      entry.kind === 'page' &&
      isStudioPath(entry.pattern) &&
      routeAccess(profile, entry) !== 'absent',
  );

/**
 * Whether another entry serves `entry`'s path under `profile`, as each of
 * /studio's two entries, the owner's and Demo Studio's (#9), does for the
 * other: that entry's checks cover the path there.
 */
const shadowed = (profile: Profile, entry: Routes.RouteEntry) =>
  routeAccess(profile, entry) === 'absent' &&
  listRoutes().some(
    (other) => other.pattern === entry.pattern && routeAccess(profile, other) !== 'absent',
  );

/**
 * Whether `profile` serves a grant route, as owner does (#7, Slice 2): there
 * proxy.ts checks the grant of every request under the preview prefixes,
 * and gives each one it turns away the status document.
 */
const hasGrantRoutes = (profile: Profile) =>
  listRoutes().some(
    (entry) => entry.grant !== undefined && routeAccess(profile, entry) !== 'absent',
  );

/**
 * Expects the preview's status document (#7, Slice 2): 404, its own static
 * page, the same whatever the reason, under the preview's headers. A HEAD
 * gets the headers alone.
 */
async function expectStatusDocument(
  profile: Profile,
  response: APIResponse,
  what: string,
  method = 'GET',
) {
  expect(response.status(), what).toBe(404);
  expect(response.headers()['content-type'], what).toBe(PREVIEW_STATUS_TYPE);
  expect(await response.text(), what).toBe(method === 'HEAD' ? '' : PREVIEW_STATUS_DOCUMENT);
  expect(response.headers()['x-request-id'], what).toMatch(UUID);
  expectProfileHeaders(profile, response, what);
}

/**
 * The headers its path gets (route-headers.mjs): the baseline ones, Studio's
 * (#2) where the profile has Studio, the demo's on its showroom, /sample,
 * and Studio (#9), or the preview's (#7). No cookie, no x-portfolio-path,
 * and noindex exactly where the profile can't be indexed, or noindex,
 * nofollow on every preview path.
 */
function expectProfileHeaders(profile: Profile, response: APIResponse, what: string) {
  const headers = response.headers();
  // Every request goes to the app's own address, its PORTFOLIO_ORIGIN.
  const { pathname, origin } = new URL(response.url());
  expect(
    headerProblems(pathname, headers, {
      studio: hasStudio(profile),
      origin,
      demo: profile === 'demo',
    }),
    what,
  ).toEqual([]);
  expect(headers['set-cookie'], `${what}: no cookie`).toBeUndefined();
  // The baseline's storage path header (#1, #9 A2) is on no response, in any profile.
  expect(headers['x-portfolio-path'], `${what}: x-portfolio-path`).toBeUndefined();
  expect(headers['x-robots-tag'], `${what}: X-Robots-Tag`).toBe(
    isPreviewPath(pathname) ? 'noindex, nofollow' : INDEXABLE[profile] ? undefined : 'noindex',
  );
}

/**
 * A 404 page's body with its own path taken out of Next's payload, which
 * names the path it answers, query and all, as sent or decoded, so two 404
 * pages compare as the same page.
 */
function withoutOwnPath(body: string, target: string): string {
  const url = new URL(target, 'http://unset.invalid');
  const sent = url.pathname.split('/').filter(Boolean);
  const spellings = [sent];
  try {
    // Each segment decoded, and the path decoded whole, encoded slashes and all.
    spellings.push(sent.map((segment) => decodeURIComponent(segment)));
    spellings.push(decodeURIComponent(url.pathname).split('/').filter(Boolean));
  } catch {
    // Named as sent.
  }
  for (const spelling of spellings) {
    const segments = ['', ...spelling];
    segments[segments.length - 1] += url.search;
    // The payload is JSON inside a JSON string in a script: its quotes come
    // escaped, and its ampersands as \u0026.
    const named = `\\"c\\":${JSON.stringify(segments).replace(/"/g, '\\"').replace(/&/g, '\\u0026')}`;
    const parts = body.split(named);
    if (parts.length === 2) return parts.join('\\"c\\":"<path>"');
  }
  throw new Error(`Next's payload doesn't name ${target} once.`);
}

/**
 * A page's body with its response's CSP nonce taken out, as a page with no
 * CSP has none: the attribute on each script and stylesheet, and what Next's
 * payload says of it, which is a JS string in a script, its quotes escaped.
 */
function withoutNonce(body: string, nonce: string | undefined): string {
  if (!nonce) return body;
  return body
    .split(` nonce="${nonce}"`)
    .join('')
    .split(`,{\\"nonce\\":\\"${nonce}\\"}`)
    .join('')
    .split(`\\"nonce\\":\\"${nonce}\\"`)
    .join('\\"nonce\\":\\"$undefined\\"');
}

/**
 * An RSC payload with the id Next makes for each request it renders one for
 * taken out. It keys the payload's viewport and metadata by it, as `<id>v`
 * and `<id>m` (getFlightViewportKey and getFlightMetadataKey in Next's
 * app-render), so two requests' payloads differ there and nowhere else.
 */
function withoutFlightRequestId(body: string): string {
  const id = /"([A-Za-z0-9_-]{21})v"/.exec(body)?.[1];
  return id && body.includes(`"${id}m"`) ? body.split(id).join('<request>') : body;
}

/**
 * A response as the checks that compare two paths' answers see it: its
 * status, its headers but the date and the request ID, and its body, with a
 * 404 page's own path taken out of Next's payload, and an RSC payload's
 * request id.
 */
async function shape(response: APIResponse, target: string) {
  const text = await response.text();
  const type = response.headers()['content-type'] ?? '';
  const page = /^text\/html/.test(type) && text !== '';
  const flight = /^text\/x-component/.test(type);
  return {
    status: response.status(),
    // Each response's own nonce (#6) aside, as its date and request ID are.
    headers: Object.fromEntries(
      Object.entries(response.headers())
        .filter(([name]) => !['date', 'x-request-id'].includes(name))
        .map(([name, value]) => [name, withoutNonces(value)]),
    ),
    body: withoutNonces(
      page ? withoutOwnPath(text, target) : flight ? withoutFlightRequestId(text) : text,
    ),
  };
}

/**
 * Sends every method to each target, with `headers`, and expects each answer
 * to be exactly /no-such-page's, with the target's own query: the same
 * status, headers, and body, but for the path Next's payload names in a page.
 * `reference` names another path to answer as, or one per target, each sent
 * as is.
 */
export async function expectUnknown(
  request: APIRequestContext,
  profile: Profile,
  targets: readonly string[],
  headers: Record<string, string> = {},
  reference: string | readonly string[] = '/no-such-page',
): Promise<void> {
  for (const [index, target] of targets.entries()) {
    const query = target.includes('?') ? target.slice(target.indexOf('?')) : '';
    const unknownAt = typeof reference === 'string' ? `${reference}${query}` : reference[index]!;
    for (const method of EVERY_METHOD) {
      const what = `${method} ${target}`;
      const options = { method, maxRedirects: 0, headers };
      const response = await request.fetch(target, options);
      const unknown = await request.fetch(unknownAt, options);
      // A page is a 404. An RSC request for a missing page Next answers 200
      // with its not-found payload, so there the answer is /no-such-page's.
      expect(response.status(), what).toBe('RSC' in headers ? unknown.status() : 404);
      expect(await response.text(), what).not.toContain('Password');
      expectProfileHeaders(profile, response, what);
      expect(await shape(response, target), what).toEqual(await shape(unknown, unknownAt));
    }
  }
}

/**
 * Sends GET and POST to every scan target, with `headers` on each, and
 * expects no canary in any body or header of what comes back.
 */
export async function expectNoLeaks(
  request: APIRequestContext,
  canaries: readonly string[],
  headers: Record<string, string> = {},
): Promise<void> {
  for (const target of scanTargets()) {
    for (const method of ['GET', 'POST'] as const) {
      const response = await request.fetch(target, {
        method,
        maxRedirects: 0,
        headers,
        data: method === 'POST' ? { draft: CANARY_BODY } : undefined,
      });
      const body = (await response.body()).toString('latin1');
      const sent = response
        .headersArray()
        .map(({ name, value }) => `${name}: ${value}`)
        .join('\n');
      for (const canary of canaries) {
        expect(body, `${method} ${target}: body`).not.toContain(canary);
        expect(sent, `${method} ${target}: headers`).not.toContain(canary);
      }
    }
  }
}

/** Registers the matrix for `profile`, which the spec's app options must start. */
export function profileMatrix(profile: Profile, { secrets = [] }: MatrixOptions = {}): void {
  const annotation = { type: 'profile', description: profile };

  test(`the app under test runs ${profile}`, async ({ app }) => {
    expect(app.env.PORTFOLIO_PROFILE).toBe(profile);
  });

  for (const entry of listRoutes().filter(
    (route) => route.capability !== 'operations' && !shadowed(profile, route),
  )) {
    const access = routeAccess(profile, entry);
    const served = access !== 'absent';
    // A grant's authority is the grant in its path, never a session (#7).
    const grant = served && entry.grant !== undefined;
    // Under a profile with grant routes, every preview path no active grant
    // admits gets the status document: a grant route's own, and a preview
    // route the build doesn't serve, such as the dev fixture route outside
    // `next dev` (#7).
    const statusDocument = !served && hasGrantRoutes(profile) && isPreviewPath(entry.pattern);
    const gated = entry.kind === 'page' && access === 'session' && !grant;
    const missing = namesNothing(entry) || unbuilt(entry);
    // /media (#10): every profile serves it, and a path that names no
    // rendition the live view keeps, as the probe doesn't, is its plain 404.
    // So is demo's /reference/media (#9), for the reference's view.
    const rendition =
      served && (entry.pattern === MEDIA_PATTERN || entry.pattern === REFERENCE_MEDIA_PATTERN);
    // /_portfolio/scheme/ (#20): every profile serves it, and a name the live
    // revision's stored schemes don't compile to, as no name does for a site
    // that stores none, is its plain 404.
    const scheme = served && entry.pattern === SCHEME_PATTERN;
    const state = rendition
      ? 'served, a 404 that is never cached for a rendition the live view lacks, and a 405 to anything but GET and HEAD'
      : scheme
        ? 'served, a 404 that is never cached for a name no live scheme compiles to, HEAD the same headers, and a 405 to anything but GET and HEAD'
        : grant
          ? 'served only to an active grant, and the status document to anything else'
          : statusDocument
            ? 'the status document to every method, as every preview path no grant admits'
            : missing
              ? unbuilt(entry)
                ? 'in no profile of this build, the 404 page'
                : 'missing there, the 404 page'
              : served
                ? gated
                  ? 'served to a session, and sends a visitor to sign-in'
                  : 'served'
                : 'absent, 404 for every method';
    // /studio has two entries, the owner's and Demo Studio's (#9): each title names its capability.
    const shared = listRoutes().some((other) => other !== entry && other.pattern === entry.pattern);
    test(
      `${entry.pattern}${shared ? ` (${entry.capability})` : ''} is ${state}`,
      { annotation: [{ type: 'route', description: entry.pattern }, annotation] },
      async ({ app, request }) => {
        if (scheme) {
          // The probe, and a well-formed name with a hash no live scheme has.
          // A trailing slash is the same 404, never a 308 naming a path.
          for (const target of [
            concrete(entry.pattern),
            `/_portfolio/scheme/brand-seed.${'0'.repeat(12)}.css`,
            `/_portfolio/scheme/brand-seed.${'0'.repeat(12)}.css/`,
          ]) {
            const response = await request.get(target, { maxRedirects: 0 });
            expect(response.status(), target).toBe(404);
            expect(response.headers()['content-type'], target).toMatch(/^text\/plain/);
            expect(response.headers()['cache-control'], target).toBe('no-store');
            expect(response.headers()['x-request-id'], target).toMatch(UUID);
            expectProfileHeaders(profile, response, `GET ${target}`);
            const head = await request.head(target, { maxRedirects: 0 });
            expect(head.status(), `HEAD ${target}`).toBe(404);
            expect(head.headers()['cache-control'], `HEAD ${target}`).toBe('no-store');
            expect(await head.text(), `HEAD ${target}`).toBe('');
            expectProfileHeaders(profile, head, `HEAD ${target}`);
          }
          // GET and HEAD alone: anything else is the proxy's 405.
          for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
            const refused = await request.fetch(concrete(entry.pattern), {
              method,
              maxRedirects: 0,
            });
            expect(refused.status(), method).toBe(405);
            expect(refused.headers()['allow'], method).toBe('GET, HEAD');
            expectProfileHeaders(profile, refused, method);
          }
          return;
        }
        if (rendition) {
          const response = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
          expect(response.status()).toBe(404);
          expect(response.headers()['content-type']).toMatch(/^text\/plain/);
          expect(response.headers()['cache-control']).toBe('no-store');
          expect(response.headers()['x-request-id']).toMatch(UUID);
          expectProfileHeaders(profile, response, 'GET');
          // GET and HEAD alone: anything else is the proxy's 405.
          for (const method of ['POST', 'PUT']) {
            const refused = await request.fetch(concrete(entry.pattern), {
              method,
              maxRedirects: 0,
            });
            expect(refused.status(), method).toBe(405);
            expect(refused.headers()['allow'], method).toBe('GET, HEAD');
          }
          return;
        }
        if (grant || statusDocument) {
          // No grant is active here, so every method gets the status
          // document, and none goes to sign-in.
          for (const method of METHODS) {
            const response = await request.fetch(concrete(entry.pattern), {
              method,
              maxRedirects: 0,
            });
            await expectStatusDocument(profile, response, method, method);
          }
          // A generated scheme's stylesheet (#20), loaded as one, HEAD
          // included: still no grant, so the status document.
          if (entry.grant === 'style') {
            for (const method of ['GET', 'HEAD']) {
              const response = await request.fetch(concrete(entry.pattern), {
                method,
                headers: { 'sec-fetch-dest': 'style' },
                maxRedirects: 0,
              });
              await expectStatusDocument(profile, response, `${method} as style`, method);
            }
          }
          return;
        }
        if (missing) {
          const page = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
          expect(page.status()).toBe(404);
          // The app's 404 page, from the server: it needs no JavaScript.
          expect(page.headers()['content-type']).toMatch(/^text\/html/);
          expect(await page.text()).toMatch(/<h1>Page not found<\/h1>/);
          expect(page.headers()['x-request-id']).toMatch(UUID);
          expectProfileHeaders(profile, page, 'GET');
          for (const method of METHODS.filter((each) => each !== 'GET')) {
            const response = await request.fetch(concrete(entry.pattern), {
              method,
              maxRedirects: 0,
            });
            expect(response.status(), method).toBe(404);
            expect(response.headers()['content-type'], method).toMatch(/^text\/plain/);
            expectProfileHeaders(profile, response, method);
          }
          return;
        }
        if (served && entry.methods) {
          // A route handler that takes only the methods it lists, such as
          // POST /api/appearance (#19, Slice 4): the rest are proxy.ts's 405.
          for (const method of METHODS.filter((each) => !entry.methods!.includes(each as 'POST'))) {
            const response = await request.fetch(concrete(entry.pattern), {
              method,
              maxRedirects: 0,
            });
            expect(response.status(), method).toBe(405);
            expect(response.headers()['allow'], method).toBe(entry.methods.join(', '));
            expect(response.headers()['cache-control'], method).toBe('no-store');
            expectProfileHeaders(profile, response, method);
          }
          // A POST from no origin at all sets nothing.
          const posted = await request.post(concrete(entry.pattern), {
            form: { mode: 'dark' },
            maxRedirects: 0,
          });
          expect(posted.status()).toBe(403);
          expect(posted.headers()['set-cookie']).toBeUndefined();
          expect(posted.headers()['x-request-id']).toMatch(UUID);
          expectProfileHeaders(profile, posted, 'POST');
          return;
        }
        if (served) {
          const response = await request.get(concrete(entry.pattern), { maxRedirects: 0 });
          if (gated) {
            // No session cookie: proxy.ts sends it to sign-in before the page renders (#2).
            expect(response.status()).toBe(303);
            const location = new URL(response.headers()['location'] ?? '', app.origin);
            expect(location.origin).toBe(app.origin);
            expect(location.pathname).toBe('/studio/sign-in');
          } else {
            expect(response.status()).toBe(200);
          }
          expect(response.headers()['x-request-id']).toMatch(UUID);
          expectProfileHeaders(profile, response, 'GET');
          return;
        }
        for (const method of METHODS) {
          const response = await request.fetch(concrete(entry.pattern), {
            method,
            maxRedirects: 0,
          });
          expect(response.status(), method).toBe(404);
          // The proxy's plain answer, before Next routes it, but for a GET
          // of a Studio page under a profile with none, or of a preview path
          // under one with no grant route, which answer as an unknown path
          // does, with the 404 page (#2, #7).
          const page =
            method === 'GET' && (isStudioPath(entry.pattern) || isPreviewPath(entry.pattern));
          expect(response.headers()['content-type'], method).toMatch(
            page ? /^text\/html/ : /^text\/plain/,
          );
          expectProfileHeaders(profile, response, method);
        }
      },
    );
  }

  for (const pattern of RETIRED_PATTERNS) {
    test(
      `retired ${pattern} is 404 for every method`,
      { annotation: [{ type: 'route', description: pattern }, annotation] },
      async ({ request }) => {
        for (const method of METHODS) {
          const response = await request.fetch(concrete(pattern), { method, maxRedirects: 0 });
          expect(response.status(), method).toBe(404);
          expect(response.headers()['cache-control'], method).toBe('no-store');
          expectProfileHeaders(profile, response, method);
        }
      },
    );
  }

  for (const operation of listOperations()) {
    test(
      `operation ${operation.name} fails closed as the matrix says, for every method`,
      { annotation: [{ type: 'route', description: '/api/studio/[name]' }, annotation] },
      async ({ request }) => {
        for (const method of METHODS) {
          const response = await request.fetch(`/api/studio/${operation.name}`, {
            method,
            data: method === 'GET' ? undefined : {},
            headers: { 'x-request-id': 'client-chosen' },
          });
          const [status, code] = expected(profile, operation, method);
          expect(response.status(), method).toBe(status);
          expect(response.headers()['cache-control'], method).toBe('no-store');
          expectProfileHeaders(profile, response, method);
          if (code === null) continue;
          const { error } = (await response.json()) as { error: Record<string, string> };
          expect(Object.keys(error)).toEqual(['code', 'message', 'requestId']);
          expect(error.code, method).toBe(code);
          // The ID is the one proxy.ts set, never the client's.
          expect(error.requestId).toMatch(UUID);
          expect(response.headers()['x-request-id']).toBe(error.requestId);
        }
      },
    );
  }

  // Every page that reads the visitor's appearance cookie (#19, Slice 4) is
  // private and never stored, with the cookie or without it, the 404 page
  // too. Next sets its own Vary on every page, so no-store is what keeps one
  // visitor's appearance out of another's response; a page made cacheable,
  // by `revalidate`, a static render, or a cache header, fails here.
  if (serves(profile, '/api/appearance')) {
    test(
      'every page that reads the appearance cookie answers private and no-store, with or without one, the 404 page too',
      {
        annotation: [
          { type: 'route', description: '/api/appearance' },
          ...visitorPages(profile).map((path) => ({ type: 'route', description: path })),
          annotation,
        ],
      },
      async ({ request }) => {
        for (const path of [...visitorPages(profile), '/no-such-page']) {
          for (const cookie of [undefined, 'portfolio_appearance=mode=dark']) {
            const response = await request.get(path, {
              ...(cookie ? { headers: { cookie } } : {}),
              maxRedirects: 0,
            });
            const what = `${path} ${cookie ?? 'with no cookie'}`;
            expect(response.headers()['content-type'], what).toMatch(/^text\/html/);
            expect(await response.text(), what).toMatch(
              new RegExp(
                `data-appearance-boundary="document"[^>]* data-display-mode="${cookie ? 'dark' : 'system'}"`,
              ),
            );
            const directives = (response.headers()['cache-control'] ?? '')
              .split(',')
              .map((directive) => directive.trim().toLowerCase());
            expect(directives, what).toContain('private');
            expect(directives, what).toContain('no-store');
            expect(
              directives.filter(
                (directive) =>
                  directive === 'public' ||
                  directive === 'immutable' ||
                  /^(?:s-maxage|stale-while-revalidate)=/.test(directive),
              ),
              what,
            ).toEqual([]);
          }
        }
      },
    );
  }

  test(
    '/api/health is liveness and /api/ready reports every check ok',
    {
      annotation: [
        { type: 'route', description: '/api/health' },
        { type: 'route', description: '/api/ready' },
        annotation,
      ],
    },
    async ({ request }) => {
      const health = await request.get('/api/health');
      expect(health.status()).toBe(200);
      expect(health.headers()['cache-control']).toBe('no-store');
      expect(await health.json()).toEqual({ status: 'ok', profile });

      const ready = await request.get('/api/ready');
      expect(ready.status()).toBe(200);
      expect(ready.headers()['cache-control']).toBe('no-store');
      expect(await ready.json()).toEqual(readyBody(profile));
    },
  );

  /**
   * The canaries for this run, once the app shows it seeded them. Every path
   * the server could leak sits under its own directory: the build, the
   * bundled example, the source directory, the data directory, and the
   * _FILEs it read at startup. The summary's own fields go only to an owner
   * session, through config.status (#1, item 20).
   */
  const seeded = (app: App) => {
    expect(app.env[HOPS_FILE.key]).toContain(CANARY_SECRET);
    if (profile !== 'demo') expect(app.env.PORTFOLIO_SOURCE_DIR).toContain(CANARY_SOURCE);
    if (profile === 'owner') {
      expect(app.env.PORTFOLIO_DATA_DIR).toContain(CANARY_DATA);
      expect(app.env.PORTFOLIO_AUTH_PASSWORD_HASH_FILE).toContain(CANARY_SECRET);
      expect(secrets.length, 'the password and the hash').toBeGreaterThan(1);
    }
    return leakCanaries(path.basename(app.root), { secrets });
  };

  if (profile === 'owner') {
    test(
      'no response to GET or POST carries a path, a secret, the config summary, the password, or its hash',
      { annotation: [{ type: 'route', description: 'every route' }, annotation] },
      async ({ app, request }) => {
        await expectNoLeaks(request, seeded(app));
      },
    );
  } else {
    test(
      'no response to GET or POST carries a path, a secret, or the config summary, and no owner module loads',
      { annotation: [{ type: 'route', description: 'every route' }, annotation] },
      async ({ app, request }) => {
        await expectNoLeaks(request, seeded(app));
        // After every route and operation, still no owner module.
        const ready = (await (await request.get('/api/ready')).json()) as { checks: unknown[] };
        expect(ready.checks).toContainEqual({ id: 'owner-modules', status: 'ok' });
      },
    );
  }

  if (profile !== 'owner') {
    // With a cookie of either name, holding what looks like a token: no
    // session store reads it, and nothing clears it (#2).
    const cookie = `__Host-studio_session=${'x'.repeat(43)}; studio_session=${'x'.repeat(43)}`;
    /** Every auth operation, to GET and POST: #1's fail-closed error, under the profile's headers. */
    const authRefused = async (request: APIRequestContext) => {
      for (const operation of listOperations().filter(({ name }) => name.startsWith('auth.'))) {
        for (const method of ['GET', 'POST'] as const) {
          const response = await request.fetch(`/api/studio/${operation.name}`, {
            method,
            headers: { cookie },
            data: method === 'POST' ? {} : undefined,
          });
          expect(response.status(), `${method} ${operation.name}`).toBe(404);
          const { error } = (await response.json()) as { error: Record<string, string> };
          expect(error.code).toBe('not_available_in_profile');
          expectProfileHeaders(profile, response, `${method} ${operation.name}`);
        }
      }
    };
    const routes = [
      { type: 'route', description: '/studio' },
      { type: 'route', description: '/studio/sign-in' },
      { type: 'route', description: '/api/studio/[name]' },
      annotation,
    ];
    if (profile === 'read-only') {
      test(
        'in read-only every Studio path, in any spelling and to any method, and every auth route answer the unknown-route 404',
        { annotation: routes },
        async ({ request }) => {
          // Each one exactly as a path no route matches.
          await expectUnknown(request, profile, STUDIO_SPELLINGS, { cookie });
          await authRefused(request);
        },
      );
    } else {
      test(
        "in demo /studio is Demo Studio, and every other Studio path, in any spelling and to any method, and every auth route answer the 404, under Studio's headers",
        { annotation: routes },
        async ({ request }) => {
          // Demo Studio (#9), with no session: the cookie changes nothing, and nothing clears it.
          const studio = await request.get('/studio', { headers: { cookie }, maxRedirects: 0 });
          expect(studio.status()).toBe(200);
          expect(await studio.text()).not.toContain('Password');
          expectProfileHeaders(profile, studio, 'GET /studio');
          // Every other spelling is no page of demo's: the 404 page for a page
          // load, the plain 404 for the rest, each under Studio's headers.
          for (const target of STUDIO_SPELLINGS.filter((each) => each !== '/studio')) {
            for (const method of EVERY_METHOD) {
              const what = `${method} ${target}`;
              const response = await request.fetch(target, {
                method,
                maxRedirects: 0,
                headers: { cookie },
              });
              expect(response.status(), what).toBe(404);
              const text = await response.text();
              expect(text, what).not.toContain('Password');
              if (method === 'GET') expect(text, what).toMatch(/<h1>Page not found<\/h1>/);
              else if (method !== 'HEAD') {
                expect(response.headers()['content-type'], what).toMatch(/^text\/plain/);
              }
              expectProfileHeaders(profile, response, what);
            }
          }
          await authRefused(request);
        },
      );
    }
  }

  test(
    'a route no profile of this build serves, in any spelling and to any method, answers as /no-such-page does (#19, Slice 3)',
    {
      annotation: [
        ...listRoutes()
          .filter(unknownEverywhere)
          .map(({ pattern }) => ({ type: 'route', description: pattern })),
        annotation,
      ],
    },
    async ({ request }) => {
      const spellings = unbuiltSpellings();
      if (!FIXTURES_BUILT) {
        // A build made without the flag has no fixture page in any profile.
        expect(spellings, 'the fixture page in no profile of this build').toContain(
          '/_fixtures/appearance',
        );
      }
      await expectUnknown(request, profile, spellings);
    },
  );

  test(
    "a Studio route no profile of this build serves, in any spelling and to any method, answers as an unknown Studio path does (#6's catalog fixture)",
    {
      annotation: [
        ...listRoutes()
          .filter(unknownStudio)
          .map(({ pattern }) => ({ type: 'route', description: pattern })),
        annotation,
      ],
    },
    async ({ request }) => {
      const routes = listRoutes().filter(unknownStudio);
      if (!BUDGET_BUILT) {
        // A build made without the flag has no catalog fixture in any profile.
        expect(routes.map(({ pattern }) => pattern)).toContain('/studio/_catalog-fixture');
      }
      const spell = (pattern: string) => {
        const at = concrete(pattern);
        return [
          at,
          `${at}?x=1`,
          at.toUpperCase(),
          `${at}/x`,
          `${at}.rsc`,
          ...encodedSpellings(pattern),
        ];
      };
      const spellings = routes.flatMap(({ pattern }) => spell(pattern));
      // Under owner, each as the same spelling of a Studio path no route
      // matches, the route's own segment as `nowhere`, since Studio's
      // headers follow the path as sent; under a profile with no Studio,
      // each as any path no route matches.
      const nowhere = routes.flatMap(({ pattern }) =>
        spell(pattern.replace(/\/[^/]+$/, '/nowhere')),
      );
      // What answers `path` the same: the same spelling of a Studio path no
      // route matches under owner, and /no-such-page, its query and its .rsc
      // kept, elsewhere.
      const reference = (path: string) => {
        const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
        const bare = path.slice(0, path.length - query.length);
        return hasStudio(profile)
          ? `${bare.replace(/\/[^/]+$/, '/nowhere')}${query}`
          : `/no-such-page${bare.endsWith('.rsc') ? '.rsc' : ''}${query}`;
      };
      const counterparts = hasStudio(profile) ? nowhere : spellings.map(reference);
      await expectUnknown(request, profile, spellings, {}, counterparts);
      // As Next's router asks for its RSC payload, and as it prefetches one:
      // the answer its counterpart gets, Next's not-found payload, a 200
      // to an RSC request, never the route's.
      const asked: Record<string, string>[] = [
        { rsc: '1' },
        { rsc: '1', 'next-router-prefetch': '1' },
      ];
      for (const headers of asked) {
        for (const [index, target] of spellings.entries()) {
          for (const method of ['GET', 'HEAD'] as const) {
            const what = `${method} ${target} with ${Object.keys(headers).join(' and ')}`;
            const options = { method, maxRedirects: 0, headers };
            const response = await request.fetch(target, options);
            const counterpart = await request.fetch(counterparts[index]!, options);
            expect(response.status(), what).toBe(counterpart.status());
            expect(response.headers()['content-type'], what).toBe(
              counterpart.headers()['content-type'],
            );
            // Nothing of the route's own: no plate, and no sign-in form.
            const text = await response.text();
            expect(text, what).not.toContain('Password');
            expect(text, what).not.toContain('data-plate');
            expectProfileHeaders(profile, response, what);
          }
        }
      }
      // A trailing slash: the 308 to the path without it, as its counterpart gets.
      for (const { pattern } of routes) {
        const at = concrete(pattern);
        for (const method of EVERY_METHOD) {
          const what = `${method} ${at}/`;
          const response = await request.fetch(`${at}/`, { method, maxRedirects: 0 });
          const counterpart = await request.fetch(`${reference(at)}/`, { method, maxRedirects: 0 });
          expect(response.status(), what).toBe(counterpart.status());
          expect(response.status(), what).toBe(308);
          expect(response.headers()['location'], what).toBe(at);
          expectProfileHeaders(profile, response, what);
        }
      }
    },
  );

  test(
    'a visitor page answers GET and HEAD, its RSC payload and a prefetch of it, from its experience segment, and any other method with a 405 (#6, Slice 2)',
    { annotation: [{ type: 'route', description: 'every visitor page' }, annotation] },
    async ({ request }) => {
      const targets = visitorPages(profile);
      expect(targets, 'the home page at least').toContain('/');
      for (const target of targets) {
        for (const method of EVERY_METHOD) {
          const what = `${method} ${target}`;
          const response = await request.fetch(target, { method, maxRedirects: 0 });
          expect(response.headers()['x-request-id'], what).toMatch(UUID);
          expectProfileHeaders(profile, response, what);
          if (method === 'GET' || method === 'HEAD') {
            expect(response.status(), what).toBe(200);
            expect(response.headers()['content-type'], what).toMatch(/^text\/html/);
            continue;
          }
          // The page exists for GET: no Server Function, no render.
          expect(response.status(), what).toBe(405);
          expect(response.headers()['allow'], what).toBe('GET, HEAD');
          expect(response.headers()['content-type'], what).toMatch(/^text\/plain/);
          expect(response.headers()['cache-control'], what).toBe('no-store');
          expect(await response.text(), what).toBe('Method not allowed.');
        }
        // Next's router asks for the page's payload, and prefetches it, with
        // RSC: 1 and the `_rsc` hash of its headers; both render in the same
        // segment, with no redirect. Next names the rewrite in
        // x-nextjs-rewritten-path, which its router reads: the segment of the
        // composition the page renders and the visitor path, never the query.
        const page = await (await request.get(target, { maxRedirects: 0 })).text();
        const composition = /<div[^>]* data-variant="([a-z][a-z0-9-]{1,47})"/.exec(page)?.[1];
        expect(composition, `GET ${target}: the boundary names its composition`).toBeTruthy();
        const { pathname } = new URL(target, 'http://unset.invalid');
        const segment = `/_experience/${composition}${pathname === '/' ? '' : pathname}`;
        const router: Record<string, string>[] = [
          { rsc: '1' },
          { rsc: '1', 'next-router-prefetch': '1' },
        ];
        for (const headers of router) {
          const what = `GET ${target} with ${Object.keys(headers).join(' and ')}`;
          const response = await request.get(await withRscHash(target, headers), {
            headers,
            maxRedirects: 0,
          });
          expect(response.status(), what).toBe(200);
          expect(response.headers()['content-type'], what).toMatch(/^text\/x-component/);
          expectProfileHeaders(profile, response, what);
          expect(response.headers()['x-nextjs-rewritten-path'], what).toBe(segment);
          expect(response.headers()['x-nextjs-rewritten-query'] ?? '', what).toBe('');
        }
      }
    },
  );

  test(
    "no request reaches an experience segment but one proxy.ts marks: its path, in any spelling and to any method, answers as /no-such-page does, with a trailing slash it gets the same 308, and a client's own mark changes nothing (#6, Slice 2)",
    {
      annotation: [
        ...listExperienceRoutes().map(({ pattern }) => ({ type: 'route', description: pattern })),
        annotation,
      ],
    },
    async ({ request }) => {
      const spellings = experienceSpellings();
      expect(spellings.length, 'a segment for the fallback composition at least').toBeGreaterThan(
        0,
      );
      for (const [target, unknown] of spellings) {
        for (const method of EVERY_METHOD) {
          const what = `${method} ${target}`;
          const options = { method, maxRedirects: 0 };
          const response = await request.fetch(target, options);
          const expected = await request.fetch(unknown, options);
          expect(response.status(), what).toBe(404);
          expectProfileHeaders(profile, response, what);
          expect(await shape(response, target), what).toEqual(await shape(expected, unknown));
        }
      }
      for (const { pattern } of listExperienceRoutes()) {
        const target = `${concrete(pattern)}/`;
        for (const method of EVERY_METHOD) {
          const what = `${method} ${target}`;
          const response = await request.fetch(target, { method, maxRedirects: 0 });
          const expected = await request.fetch('/no-such-page/', { method, maxRedirects: 0 });
          expect(response.status(), what).toBe(expected.status());
          expect(response.status(), what).toBe(308);
          expect(response.headers()['location'], what).toBe(concrete(pattern));
          expectProfileHeaders(profile, response, what);
        }
      }
      // A mark of the client's own, naming a segment this build has, goes no
      // further than proxy.ts: a path no route matches is still the global
      // 404 page, not a segment's.
      const mark = { 'x-portfolio-experience': 'fallback' };
      for (const target of ['/no-such-page', '/no-such-page/work/tide-tables?view=all']) {
        for (const method of ['GET', 'HEAD'] as const) {
          const what = `${method} ${target} with a mark of the client's`;
          const options = { method, maxRedirects: 0 };
          const marked = await request.fetch(target, { ...options, headers: mark });
          const plain = await request.fetch(target, options);
          expect(marked.status(), what).toBe(404);
          expect(await shape(marked, target), what).toEqual(await shape(plain, target));
        }
      }
    },
  );

  test(
    'an unknown operation gets the same 404 envelope',
    { annotation: [{ type: 'route', description: '/api/studio/[name]' }, annotation] },
    async ({ request }) => {
      // publish, where the profile lacks it: owner registers it (#3), and
      // its own row above checks it fails closed.
      const absentPublish = accessIn(profile, 'publish') === 'absent' ? ['publish'] : [];
      for (const name of [...absentPublish, 'draft.write', 'no.such.operation']) {
        const response = await request.post(`/api/studio/${name}`, { data: {} });
        expect(response.status(), name).toBe(404);
        const { error } = (await response.json()) as { error: Record<string, string> };
        expect(error.code, name).toBe('not_available_in_profile');
        expectProfileHeaders(profile, response, name);
      }
    },
  );

  test(
    'a route spelled with a fixed segment percent-encoded is a path no route matches: the 404 page for GET, the plain 404 for POST',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // The route table reads /%66eed.xml as /feed.xml, but Next matches a
      // fixed segment as sent and would hand it to the views catch-all,
      // whose 404 needs JavaScript (#5, Slice 4).
      let spellings = 0;
      for (const entry of listRoutes().filter((route) => !shadowed(profile, route))) {
        const access = routeAccess(profile, entry);
        // A grant route takes no other spelling, whatever its grant, and
        // under a profile with grant routes no preview path gets past the
        // grant check without one (#7).
        const grant =
          access !== 'absent'
            ? entry.grant !== undefined
            : hasGrantRoutes(profile) && isPreviewPath(entry.pattern);
        for (const target of encodedSpellings(entry.pattern)) {
          spellings += 1;
          const page = await request.get(target, { maxRedirects: 0 });
          if (grant) {
            await expectStatusDocument(profile, page, `GET ${target}`);
            await expectStatusDocument(
              profile,
              await request.post(target, { maxRedirects: 0 }),
              `POST ${target}`,
            );
            continue;
          }
          if (entry.kind === 'page' && access === 'session') {
            // No session cookie: sign-in comes first, as for the route's own spelling.
            expect(page.status(), target).toBe(303);
          } else if (
            access === 'absent' &&
            !namesNothing(entry) &&
            !unbuilt(entry) &&
            !isStudioPath(entry.pattern) &&
            !isPreviewPath(entry.pattern)
          ) {
            // A route the profile doesn't serve: its plain 404, in any spelling.
            expect(page.status(), target).toBe(404);
            expect(page.headers()['content-type'], target).toMatch(/^text\/plain/);
          } else {
            // The full 404 page, from the server.
            expect(page.status(), target).toBe(404);
            expect(page.headers()['content-type'], target).toMatch(/^text\/html/);
            expect(await page.text(), target).toMatch(/<h1>Page not found<\/h1>/);
          }
          expectProfileHeaders(profile, page, `GET ${target}`);
          const posted = await request.post(target, { maxRedirects: 0 });
          expect(posted.status(), `POST ${target}`).toBe(404);
          expect(posted.headers()['content-type'], `POST ${target}`).toMatch(/^text\/plain/);
          expectProfileHeaders(profile, posted, `POST ${target}`);
        }
      }
      expect(spellings, 'spellings checked').toBeGreaterThan(10);
    },
  );

  test(
    "a path that is a route file's own, as sent or decoded whole, is a path no route matches: the 404 page for GET, the plain 404 for POST",
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // Such as /work/[slug] or /studio%2Fsign-in: the route table finds it
      // names nothing, but Next's file check finds a route file for it before
      // the afterFiles rewrite runs, and the views catch-all's 404 needs
      // JavaScript (#5, Slice 4).
      const spellings = routeFileSpellings();
      expect(spellings.length, 'spellings checked').toBeGreaterThan(5);
      for (const target of spellings) {
        const page = await request.get(target, { maxRedirects: 0 });
        // A grant route's own file path, as a grant: the status document (#7).
        if (hasGrantRoutes(profile) && isPreviewPath(target)) {
          await expectStatusDocument(profile, page, `GET ${target}`);
          await expectStatusDocument(
            profile,
            await request.post(target, { maxRedirects: 0 }),
            `POST ${target}`,
          );
          continue;
        }
        expect(page.status(), target).toBe(404);
        expect(page.headers()['content-type'], target).toMatch(/^text\/html/);
        expect(await page.text(), target).toMatch(/<h1>Page not found<\/h1>/);
        expectProfileHeaders(profile, page, `GET ${target}`);
        const posted = await request.post(target, { maxRedirects: 0 });
        expect(posted.status(), `POST ${target}`).toBe(404);
        expect(posted.headers()['content-type'], `POST ${target}`).toMatch(/^text\/plain/);
        expectProfileHeaders(profile, posted, `POST ${target}`);
      }
    },
  );

  const previewAnnotation = {
    annotation: [
      { type: 'route', description: '/preview' },
      { type: 'route', description: '/preview-assets' },
      annotation,
    ],
  };
  if (hasGrantRoutes(profile)) {
    test(
      'every preview path no active grant admits, in any spelling, to any method, and from any destination, gets the status document, under the preview headers and with no cookie read (#7)',
      previewAnnotation,
      async ({ request }) => {
        // With a session cookie and a preference, which proxy.ts never reads
        // there; as a frame's document or an image, the loads a grant route
        // takes; and with Next's router prefetch header and no RSC header,
        // which next.config.ts would send to the 404 page (#1). No grant is
        // active in the matrix, so each one gets the status document.
        const cookie = `__Host-studio_session=${'x'.repeat(43)}; theme=dark`;
        const sent: Record<string, string>[] = [
          {},
          { cookie },
          { cookie, 'sec-fetch-dest': 'iframe' },
          { 'sec-fetch-dest': 'image' },
          { 'next-router-prefetch': '1' },
        ];
        // A token of the grant's own shape that no mint made.
        const unknown = 'A'.repeat(22);
        for (const target of [
          ...PREVIEW_SPELLINGS,
          `/preview/${unknown}`,
          `/preview/${unknown}/work/tide-tables`,
          `/preview-assets/${unknown}/a1/${'0'.repeat(64)}/large.webp`,
        ]) {
          for (const method of EVERY_METHOD) {
            for (const headers of sent) {
              const what = `${method} ${target} with ${Object.keys(headers).join(', ') || 'nothing'}`;
              const response = await request.fetch(target, {
                method,
                maxRedirects: 0,
                headers,
                timeout: 5_000,
              });
              await expectStatusDocument(profile, response, what, method);
            }
          }
        }
      },
    );
  } else {
    test(
      'every preview path, in any spelling and to any method, answers as a path no route matches, under the preview headers, the same with a session cookie as without (#7)',
      previewAnnotation,
      async ({ request }) => {
        // With a session cookie and a preference: proxy.ts drops both before
        // Next routes the request, so the answer is the same without them.
        const cookie = `__Host-studio_session=${'x'.repeat(43)}; theme=dark`;
        // What a preview path no route matches answers, with no cookie: the
        // app's 404 page from the server, but without the site's theme script,
        // which the site's own 404 runs (#7).
        const unmatched = '/preview/no-such-page';
        const reference = await request.get(unmatched, { maxRedirects: 0 });
        expect(reference.status()).toBe(404);
        const referenceText = await reference.text();
        expect(referenceText).toMatch(/<h1>Page not found<\/h1>/);
        // Both 404s render in a document boundary (#19), and neither has a theme script.
        const site = await (await request.get('/no-such-page', { maxRedirects: 0 })).text();
        for (const [what, text] of [
          ["the preview's 404", referenceText],
          ["the site's 404", site],
        ] as const) {
          expect(text, what).toContain('data-appearance-boundary="document"');
          expect(text, what).not.toContain('localStorage');
        }
        // As that path: the same status, type, and page, but for the path Next's
        // payload names, and the nonce the preview's scripts and styles carry.
        const shape = async (response: APIResponse, target: string) => {
          const text = await response.text();
          const type = response.headers()['content-type'] ?? '';
          const page = /^text\/html/.test(type) && text !== '';
          const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(
            response.headers()['content-security-policy'] ?? '',
          )?.[1];
          return {
            status: response.status(),
            type,
            body: page ? withoutOwnPath(withoutNonce(text, nonce), target) : text,
          };
        };
        for (const target of PREVIEW_SPELLINGS) {
          const query = target.includes('?') ? target.slice(target.indexOf('?')) : '';
          for (const method of EVERY_METHOD) {
            const what = `${method} ${target}`;
            const options = { method, maxRedirects: 0, headers: { cookie } };
            const response = await request.fetch(target, options);
            const unknown = await request.fetch(`${unmatched}${query}`, {
              method,
              maxRedirects: 0,
            });
            expect(response.status(), what).toBe(404);
            expectProfileHeaders(profile, response, what);
            expect(await shape(response, target), what).toEqual(
              await shape(unknown, `${unmatched}${query}`),
            );
          }
          // With Next's router prefetch header and no RSC header, next.config.ts
          // sends the request to the 404 page (#1), and the preview's headers
          // still go on it.
          for (const method of ['GET', 'HEAD'] as const) {
            const what = `${method} ${target}, prefetch without RSC`;
            const prefetch = { 'next-router-prefetch': '1' };
            const options = { method, maxRedirects: 0, timeout: 5_000 };
            const response = await request.fetch(target, {
              ...options,
              headers: { cookie, ...prefetch },
            });
            const unknown = await request.fetch(`${unmatched}${query}`, {
              ...options,
              headers: prefetch,
            });
            expect(response.status(), what).toBe(404);
            expectProfileHeaders(profile, response, what);
            expect(await shape(response, target), what).toEqual(
              await shape(unknown, `${unmatched}${query}`),
            );
          }
        }
      },
    );
  }

  test(
    'a build asset and a compiled pack allow any origin, and every other method or spelling there is the plain 404 (#7)',
    {
      annotation: [
        { type: 'route', description: '/_next/static' },
        { type: 'route', description: '/_portfolio' },
        annotation,
      ],
    },
    async ({ request }) => {
      const home = await request.get('/', { maxRedirects: 0 });
      expect(home.status()).toBe(200);
      expectProfileHeaders(profile, home, 'GET /');
      const assets = [
        ...new Set(
          [...(await home.text()).matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)/g)].map(
            ([, asset]) => asset!,
          ),
        ),
      ];
      expect(assets.length, 'build assets on the home page').toBeGreaterThan(1);
      // #19's compiled packs, which the registry writes into public/_portfolio/pack/.
      const packs = readdirSync(PACKS, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map(({ name }) => `/_portfolio/pack/${name}`);
      expect(packs.length, 'compiled packs').toBeGreaterThan(0);
      // Every content-hashed file the registry wrote there (#6): their fonts,
      // which only a profile that ships one writes, such as the appearance
      // fixtures', the variants' stylesheets, the images those name, and the
      // catalog stills, which the fallback composition always has.
      const served = portfolioFiles();
      expect(
        served.filter((file) => file.startsWith('/_portfolio/still/')).length,
        'stills',
      ).toBeGreaterThan(0);
      for (const asset of [...assets, ...served]) {
        const response = await request.get(asset, { maxRedirects: 0 });
        expect(response.status(), asset).toBe(200);
        expect(response.headers()['access-control-allow-origin'], asset).toBe('*');
        // A year, immutable, under the URL its content hash names (#6, item 8).
        if (asset.startsWith('/_portfolio/')) {
          expect(response.headers()['cache-control'], asset).toBe(IMMUTABLE);
        }
        expectProfileHeaders(profile, response, asset);
      }
      // A build asset that doesn't exist goes on to a 404 page, the site's,
      // under the prefix's headers: the views catch-all's, as before (#5).
      // It holds only what an anonymous request for any unknown path gets,
      // and no browser lets a wildcard origin read a credentialed answer.
      const gone = await request.get('/_next/static/chunks/no-such-chunk.js', { maxRedirects: 0 });
      expect(gone.status()).toBe(404);
      expectProfileHeaders(profile, gone, 'a missing build asset');
      // Any other method, a spelling Next doesn't serve from disk, and under
      // /_portfolio/ anything but exactly a file the registry wrote, a pack
      // it never wrote and any other spelling of one it did, get the proxy's
      // plain 404.
      for (const [target, method] of [
        [assets[0]!, 'POST'],
        [assets[0]!, 'DELETE'],
        [assets[0]!.replace('/_next/static/', '/_NEXT/STATIC/'), 'GET'],
        ['/_next/static', 'GET'],
        [packs[0]!, 'POST'],
        ['/_portfolio/pack/no-such.css', 'GET'],
        // A content-hashed name the registry never wrote, which next.config.ts's rule matches.
        ['/_portfolio/pack/warm-parchment.000000000000.css', 'GET'],
        [packs[0]!.toUpperCase(), 'GET'],
        [packs[0]!.replace('/_portfolio/', '/_PORTFOLIO/'), 'GET'],
        [packs[0]!.replace('/_portfolio/', '/%5Fportfolio/'), 'GET'],
        [packs[0]!.replace('/pack/', '/PACK/'), 'GET'],
        [packs[0]!.replace(/css$/, '%63ss'), 'GET'],
        [packs[0]!.replace('/pack/', '/pack/..%2Fpack/'), 'GET'],
        ['/_portfolio', 'GET'],
      ] as const) {
        const response = await request.fetch(target, { method, maxRedirects: 0 });
        expect(response.status(), `${method} ${target}`).toBe(404);
        expect(await response.text(), `${method} ${target}`).toBe('Not found.');
        // Never cached, so the URL can serve a file a later build writes.
        expect(response.headers()['cache-control'], `${method} ${target}`).toBe('no-store');
        expectProfileHeaders(profile, response, `${method} ${target}`);
      }
    },
  );

  test(
    'the image optimizer is off: /_next/image is the 404 page, and its url never reaches the log',
    { annotation: [{ type: 'route', description: '/_next/image' }, annotation] },
    async ({ app, request }) => {
      // images.unoptimized (next.config.ts): Next answers with the 404 page,
      // under the baseline headers, before it reads the url. On, it sent its
      // own CSP and wrote the url to stderr as it came, line breaks included.
      const responses: [method: string, response: APIResponse][] = [];
      for (const method of METHODS) {
        responses.push([method, await request.fetch(IMAGE_PROBE, { method, maxRedirects: 0 })]);
      }
      // The server writes its log a line at a time; give it a moment. The
      // log comes first, so an optimizer back on fails here as well.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect.soft(readFileSync(app.log, 'utf8'), 'the server log').not.toContain(FORGED_LINE);
      for (const [method, response] of responses) {
        expect(response.status(), method).toBe(404);
        expectProfileHeaders(profile, response, method);
      }
    },
  );

  test(
    'a trailing or repeated slash is a 308 to the path without it, whose body is only that path',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ app, request }) => {
      // proxy.ts sends the 308 for a trailing slash, under the headers its
      // path gets, so a preview path's is private, no-store whatever its
      // grant (#7). Next answers a repeated slash itself, before proxy.ts
      // and the next.config.ts headers, so that one carries none of them,
      // under /preview none of the preview's either. The target is the
      // canonical path, and the body holds it and nothing else
      // (docs/deployment.md).
      const targets = [
        ...listRoutes()
          .filter((route) => route.pattern !== '/' && routeAccess(profile, route) !== 'absent')
          .map((route) => concrete(route.pattern)),
        // Preview paths in every profile, grant routes or none.
        '/preview/x',
        '/preview/editorial',
        '/preview-assets/probe/asset',
      ];
      expect(targets.length).toBeGreaterThan(3);
      for (const target of targets) {
        const slash = await request.get(`${target}/`, { maxRedirects: 0 });
        if (isSharedAsset(target)) {
          // Under the prefixes any origin may read (#7), such as #20's
          // /_portfolio/scheme/, a trailing slash is proxy.ts's plain no-store
          // 404 before the 308 could name another path: a file there has no
          // path below it.
          expect(slash.status(), `${target}/`).toBe(404);
          expect(slash.headers()['location'], `${target}/`).toBeUndefined();
          expect(slash.headers()['cache-control'], `${target}/`).toBe('no-store');
          expect(slash.headers()['content-type'], `${target}/`).toMatch(/^text\/plain/);
        } else {
          expect(slash.status(), `${target}/`).toBe(308);
          expect(slash.headers()['location'], `${target}/`).toBe(target);
          expect(await slash.text(), `${target}/`).toBe(target);
        }
        expectProfileHeaders(profile, slash, `${target}/`);
        // The repeated slash goes whole, so no one reads it as a host.
        const sent = `${app.origin}/${target}`;
        const repeated = await request.get(sent, { maxRedirects: 0 });
        expect(repeated.status(), sent).toBe(308);
        expect(repeated.headers()['location'], sent).toBe(target);
        expect(await repeated.text(), sent).toBe(target);
        expect(repeated.headers()['content-security-policy'], sent).toBeUndefined();
      }
    },
  );

  test(
    "a request with Next's router prefetch header and no RSC header, for a page or a /_next/ path that isn't a build file, gets an answer at once: the 404 page, or what proxy.ts answers first (#1)",
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ request }) => {
      // Next's router sends it only beside RSC: 1. next.config.ts sends a
      // request without one to the 404 page; a redirect proxy.ts answers
      // itself, such as sign-in for a Studio page, stays as it is, and so
      // does a grant page's status document (#7). A build file is still
      // served.
      const prefetch = { 'next-router-prefetch': '1', 'next-router-segment-prefetch': '/_tree' };
      const notFound = await request.get('/no-such-page');
      const asset = (await notFound.text()).match(/\/_next\/static\/[^"'?\s]+\.js/)?.[0];
      expect(asset, 'a build file the 404 page loads').toBeDefined();
      const served = await request.get(asset ?? '', { headers: prefetch, timeout: 5_000 });
      expect(served.status(), `${asset}, with the prefetch header`).toBe(200);
      const targets = [
        ...listRoutes()
          .filter((entry) => entry.kind === 'page' && routeAccess(profile, entry) !== 'absent')
          .map((entry) => concrete(entry.pattern)),
        '/no-such-page',
        '/_next/foo',
        '/_next/static/nonexistent.js',
      ];
      expect(targets.length).toBeGreaterThan(1);
      for (const target of targets) {
        for (const method of ['GET', 'HEAD'] as const) {
          const what = `${method} ${target}`;
          const page = await request.fetch(target, { method, maxRedirects: 0 });
          const redirect = page.status() >= 300 && page.status() < 400;
          const prefetched = await request.fetch(target, {
            method,
            maxRedirects: 0,
            headers: prefetch,
            timeout: 5_000,
          });
          expect(prefetched.status(), what).toBe(redirect ? page.status() : 404);
          if (redirect) {
            expect(prefetched.headers()['location'], what).toBe(page.headers()['location']);
            continue;
          }
          expect(prefetched.headers()['content-type'], what).toMatch(/^text\/html/);
          expect(prefetched.headers()['cache-control'], what).toMatch(/(?:^|,)\s*no-store/);
          if (hasGrantRoutes(profile) && isPreviewPath(target)) {
            await expectStatusDocument(profile, prefetched, what, method);
          } else if (method === 'GET') {
            expect(await prefetched.text(), what).toMatch(/<h1>Page not found<\/h1>/);
          }
        }
      }
    },
  );

  test(
    'no HTML response names localhost, and the server never resolves metadata against it',
    { annotation: [{ type: 'route', description: 'every route' }, annotation] },
    async ({ app, request }) => {
      // The app here is at 127.0.0.1, so localhost could only come from the
      // origin Next falls back to when a page's metadata has no
      // metadataBase, which it warns of in the log.
      let pages = 0;
      for (const target of scanTargets()) {
        const response = await request.get(target, { maxRedirects: 0 });
        if (!(response.headers()['content-type'] ?? '').startsWith('text/html')) continue;
        pages += 1;
        expect((await response.text()).includes('localhost'), `${target} names localhost`).toBe(
          false,
        );
      }
      expect(pages, 'HTML pages to look at').toBeGreaterThan(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(readFileSync(app.log, 'utf8'), 'the server log').not.toContain('metadataBase');
    },
  );
}
