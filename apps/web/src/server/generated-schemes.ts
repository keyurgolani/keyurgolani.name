import 'server-only';
import { createHash } from 'node:crypto';
import type {
  AppearanceRegistry,
  AppearanceStylesheets,
  GeneratedScheme,
} from '@portfolio/appearance';
import { compileGeneratedScheme } from '@portfolio/appearance/node';
import { APPEARANCE_REGISTRY, APPEARANCE_STYLESHEETS } from '~/lib/appearance-registry';
import { storedSchemes } from '~/lib/document-appearance';
import { IMMUTABLE } from './cache-rules';
import { getLive, type LiveRevision } from './catalog';
import { getDeploymentState } from './config-store';
import { previewStatusDocument } from './preview-asset';

// A generated scheme's stylesheet (#20, and #19's Slice 4 route). A
// generator scheme ships no compiled file: its sets are what #10 stored for
// the site, checked on read by storedSchemes(), and this compiles them with
// compileGeneratedScheme() and names the result by the SHA-256 of its bytes,
// `<schemeId>.<sha256-12>.css`, as registry generation names a pack's.
//
// Two places serve one, and each reads its schemes from one source alone:
//
// - /_portfolio/scheme/<file>: the live revision's unit.snapshots.schemes,
//   the same record its pages render from. Immutable, since a name is its
//   bytes, and only for a name the live revision's schemes compile to. A
//   live scheme is as public as the page that links it, so the
//   Access-Control-Allow-Origin: * every /_portfolio/ file gets exposes
//   nothing a visitor can't already read; a draft's never comes here.
// - /preview-assets/<grant>/_appearance/<file>: the grant's
//   OpenedGrant.schemes, a revision's or fixture's snapshots.schemes, or a
//   draft's derived.schemes once #10 stores them. private, no-store, under
//   the preview's headers proxy.ts sets, and only while the grant is active:
//   anything else is the grant routes' one status document (#7).
//
// The request picks a name and nothing else: the CSS is always compiled
// from the stored record, and a name no stored scheme compiles to, a wrong
// or missing hash, another site's, a draft's on the public route, an
// earlier revision's, or one an unchecked entry would have made, is the same
// answer that says nothing. The name is read as the request spelled it, and
// only `<id>.<sha256-12>.css` in a pack id's characters is one: anything
// percent-encoded, with another dot, or of another shape is turned away.
// It's compared whole with the names the stored schemes compile to, and
// never used as a path, a key, or a module specifier.
//
// The live revision's schemes compile once per revision: the memo holds one
// revision's, and a publish or rollback replaces it on the next read. A
// grant's compile once per grant and scheme, keyed by the grant's digest.

/** Where the live revision's generated schemes are served. */
export const SCHEME_URL = '/_portfolio/scheme/';

/** The branch of a grant's assets where its generated schemes are served. */
export const PREVIEW_SCHEME_SEGMENT = '_appearance';

/** One generated scheme's stylesheet, compiled from its stored sets. */
export interface SchemeStylesheet {
  readonly id: string;
  /** `<id>.<sha256-12>.css`. */
  readonly name: string;
  readonly css: string;
}

/** A name a stylesheet could have: a pack id, one dot, 12 hex digits, `.css`. */
const NAME = /^[a-z][a-z0-9-]*\.[0-9a-f]{12}\.css$/;

/** How many schemes compiled in this process, which the memo's tests read. */
export const compileCount = { value: 0 };

/**
 * The stylesheet of each generated scheme in `schemes` that renders, by
 * scheme id: storedSchemes() decides which do, so a page links exactly the
 * ones it renders.
 */
export function schemeStylesheets(
  schemes: unknown,
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): ReadonlyMap<string, SchemeStylesheet> {
  const sheets = new Map<string, SchemeStylesheet>();
  for (const [id, sets] of Object.entries(storedSchemes(schemes, registry))) {
    sheets.set(id, compileSheet(id, sets));
  }
  return sheets;
}

/** One scheme's stylesheet, compiled from its checked sets and named by its bytes. */
function compileSheet(id: string, sets: GeneratedScheme): SchemeStylesheet {
  const css = compileGeneratedScheme(id, sets);
  compileCount.value += 1;
  const hash = createHash('sha256').update(css, 'utf8').digest('hex').slice(0, 12);
  return { id, name: `${id}.${hash}.css`, css };
}

/**
 * Each grant's compiled schemes, by the grant's digest and the scheme id:
 * the SHA-256 of its token, which the grant's record and its cached view are
 * kept under too. A grant's subject is pinned when it's minted, so its
 * stored schemes never change under one digest, however often open() reads
 * them afresh. The oldest go first past GRANT_SHEETS.
 */
const grantSheets = new Map<string, SchemeStylesheet>();
const GRANT_SHEETS = 64;

/** The grant's stored schemes compiled, each once per grant and scheme. */
function grantStylesheets(grant: string, schemes: unknown): ReadonlyMap<string, SchemeStylesheet> {
  const digest = createHash('sha256').update(grant).digest('hex');
  const sheets = new Map<string, SchemeStylesheet>();
  for (const [id, sets] of Object.entries(storedSchemes(schemes))) {
    const key = JSON.stringify([digest, id]);
    let sheet = grantSheets.get(key);
    if (!sheet) {
      sheet = compileSheet(id, sets);
      grantSheets.set(key, sheet);
      for (const oldest of grantSheets.keys()) {
        if (grantSheets.size <= GRANT_SHEETS) break;
        grantSheets.delete(oldest);
      }
    }
    sheets.set(id, sheet);
  }
  return sheets;
}

/** The live revision's generated schemes, as read, and compiled. */
export interface LiveSchemes {
  /** unit.snapshots.schemes, unchecked, or undefined: what documentAppearance() reads. */
  readonly schemes: unknown;
  readonly sheets: ReadonlyMap<string, SchemeStylesheet>;
}

const NONE: LiveSchemes = Object.freeze({ schemes: undefined, sheets: new Map() });

/** The last revision read, by its id and unit hash, and its compiled schemes. */
let liveMemo: {
  readonly key: string;
  readonly sheets: ReadonlyMap<string, SchemeStylesheet>;
} | null = null;

/**
 * The live revision's generated schemes, read once, with their stylesheets,
 * compiled once per revision: a revision id or unit hash other than the
 * memo's compiles afresh and replaces it. With no live revision, none.
 */
export async function liveSchemeSheets(): Promise<LiveSchemes> {
  return schemeSheetsOf(await getLive().catch(() => null));
}

/**
 * The generated schemes of a live revision a caller already read, with
 * their stylesheets, through the same per-revision memo: so a page that
 * reads the revision for its site renders and links from that one read.
 */
export function schemeSheetsOf(live: LiveRevision | null): LiveSchemes {
  if (!live?.unit) return NONE;
  const schemes = live.unit.snapshots?.schemes;
  const key = JSON.stringify([live.revisionId, live.unitHash]);
  if (liveMemo?.key !== key) liveMemo = { key, sheets: schemeStylesheets(schemes) };
  return { schemes, sheets: liveMemo.sheets };
}

/** Whether `name`, as sent, has a stylesheet's shape. */
export function isSchemeName(name: string): boolean {
  return NAME.test(name);
}

/** The stylesheet in `sheets` named `name`, compared whole, or null. */
export function schemeNamed(
  sheets: ReadonlyMap<string, SchemeStylesheet>,
  name: string,
): SchemeStylesheet | null {
  if (!isSchemeName(name)) return null;
  for (const sheet of sheets.values()) if (sheet.name === name) return sheet;
  return null;
}

/**
 * The build's stylesheets, with each generated scheme in `sheets` at the
 * URL `href` gives its name: what a document boundary links, what the
 * visitor control preloads, and so what stylesheetHrefs() lists.
 */
export function withSchemeStylesheets(
  sheets: ReadonlyMap<string, SchemeStylesheet>,
  href: (name: string) => string,
  base: AppearanceStylesheets = APPEARANCE_STYLESHEETS,
): AppearanceStylesheets {
  if (sheets.size === 0) return base;
  return {
    platform: base.platform,
    pack: (axis, id) => {
      const own = base.pack(axis, id);
      if (own !== null || axis !== 'colorScheme') return own;
      const sheet = sheets.get(id);
      return sheet ? href(sheet.name) : null;
    },
  };
}

/** A visitor page's stylesheets: the build's, and the live revision's generated schemes under SCHEME_URL. */
export function liveStylesheets(live: LiveSchemes): AppearanceStylesheets {
  return withSchemeStylesheets(live.sheets, (name) => `${SCHEME_URL}${name}`);
}

/** A preview frame's stylesheets: the build's, and its grant's generated schemes under the grant. */
export function previewStylesheets(grant: string, schemes: unknown): AppearanceStylesheets {
  return withSchemeStylesheets(
    grantStylesheets(grant, schemes),
    (name) => `/preview-assets/${encodeURIComponent(grant)}/${PREVIEW_SCHEME_SEGMENT}/${name}`,
  );
}

/** The 404 every name that serves nothing answers on the public route. */
function schemeNotFound(): Response {
  return new Response('Not found.', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** A stylesheet's answer: the same headers to HEAD, with no body. */
function stylesheet(sheet: SchemeStylesheet, cacheControl: string, head: boolean): Response {
  const body = new TextEncoder().encode(sheet.css);
  return new Response(head ? null : body, {
    status: 200,
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  });
}

/** A route parameter as Next gives it, decoded, or ''. */
async function param(context: unknown, key: string): Promise<string> {
  const params = await (context as { params?: Promise<Record<string, unknown>> } | undefined)
    ?.params;
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * The file name as the request spelled it, its last path segment, when it
 * has a stylesheet's shape and Next routed it as the same name decoded:
 * else null, so no encoded spelling reaches a name.
 */
async function sentName(request: Request, context: unknown): Promise<string | null> {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  const sent = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (!isSchemeName(sent)) return null;
  return (await param(context, 'file')) === sent ? sent : null;
}

/** GET /_portfolio/scheme/<file>: a live revision's generated scheme, or the 404. */
export async function liveSchemeStylesheet(request: Request, context?: unknown): Promise<Response> {
  const name = await sentName(request, context);
  if (name === null) return schemeNotFound();
  const sheet = schemeNamed((await liveSchemeSheets()).sheets, name);
  if (!sheet) return schemeNotFound();
  return stylesheet(sheet, IMMUTABLE, request.method === 'HEAD');
}

/**
 * GET /preview-assets/<grant>/_appearance/<file>: a generated scheme the
 * grant's subject stored, the grant checked again through the port as a
 * frame's document is, or the status document. proxy.ts has already
 * admitted only a style load for an active grant.
 */
export async function previewSchemeStylesheet(
  request: Request,
  context?: unknown,
): Promise<Response> {
  const previews = getDeploymentState()?.previews;
  if (!previews) return previewStatusDocument();
  const name = await sentName(request, context);
  if (name === null) return previewStatusDocument();
  const grant = await param(context, 'grant');
  const opened = await previews.open(grant).catch(() => null);
  if (!opened) return previewStatusDocument();
  const sheet = schemeNamed(grantStylesheets(grant, opened.schemes), name);
  if (!sheet) return previewStatusDocument();
  return stylesheet(sheet, 'private, no-store', request.method === 'HEAD');
}
