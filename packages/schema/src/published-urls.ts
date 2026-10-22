import { isSectionId, workPath } from './ids';
import { idReused } from './record-ids';
import { isPlainObject } from './json';
import { readSourceSnapshots, isSitePath, type UrlTable } from './snapshots';
import type { Context, Diagnostic, UnitValidator } from './validate';
import { resolvePortfolioView, type ParsedPair, type PublicView } from './view';

// Published URLs (#10, item 4, the schema half): which URLs a revision serves,
// and the redirect table a publish freezes into snapshots/urls.json. A work's
// changed slug gets a 308 by itself; any other URL that vanishes blocks
// publish until it's acknowledged (410) or redirected to a live URL (308). A
// slug whose work turned private answers the host's 404, never 410. #3 owns
// persistence, the commands, and the CLI; #10b serves the table. Pure.

/** An owner's answer for a vanished URL: gone (410), or a redirect to a live URL (308). */
export interface UrlAcknowledgement {
  readonly url: string;
  readonly redirectTo?: string;
}

export interface CanonicalUrlOptions {
  /**
   * The paths the variant's views serve, such as /about. The schema can't
   * read manifests, so the caller passes them.
   */
  readonly viewPaths?: readonly string[];
}

/**
 * Every URL the view's revision serves: the home page, `/work/<slug>` for
 * each public work with a case study, and the variant's view paths when the
 * caller passes them. Sorted, each once.
 */
export function listCanonicalUrls(view: PublicView, options: CanonicalUrlOptions = {}): string[] {
  const urls = new Set<string>(['/']);
  for (const path of routedWorks(view).values()) urls.add(path);
  for (const path of options.viewPaths ?? []) if (isSitePath(path)) urls.add(path);
  return [...urls].sort();
}

/** Each routed work's path, by work id: a public work in the view with a case study and a slug. */
export function routedWorks(view: PublicView): Map<string, string> {
  const routes = new Map<string, string>();
  for (const work of view.portfolio.works) {
    if (work.caseStudy !== undefined && work.slug !== undefined)
      routes.set(work.id, workPath(work.slug));
  }
  return routes;
}

/** The ids of the works a document keeps private, for planUrls(). */
export function privateWorkIds(pair: ParsedPair): string[] {
  return (pair.portfolio.works ?? [])
    .filter((work) => work.visibility === 'private')
    .map(({ id }) => id);
}

export interface PlanUrlsInput {
  /** The live revision's view, or null for an empty store. */
  readonly live: PublicView | null;
  /** The live revision's snapshots/urls.json, or null when it has none. */
  readonly liveTable: UrlTable | null;
  /** The next revision's view. */
  readonly view: PublicView;
  /** The draft's acknowledgements: derived.urlAcknowledgements. */
  readonly acknowledgements: readonly UrlAcknowledgement[];
  /** Ids of the works the next document keeps private (privateWorkIds()). Their old URLs answer 404, never 410. */
  readonly privateWorks?: readonly string[];
  /** The view paths each side's variant serves. */
  readonly viewPaths?: { readonly live?: readonly string[]; readonly next?: readonly string[] };
}

export interface UrlPlan {
  /** The table the next revision freezes: live's, plus this publish's redirects and gone URLs, each one hop. */
  readonly table: UrlTable;
  /** Live URLs the next revision drops with no redirect and no acknowledgement. Publish waits on these. */
  readonly vanished: readonly string[];
}

/**
 * The redirect table a publish freezes, and the URLs it would vanish. A
 * changed slug redirects (308) to the new one. Any other live URL the next
 * revision drops is vanished unless acknowledged: with `redirectTo` a live
 * URL, it redirects; without, it's gone (410), except a slug whose work
 * turned private, which is simply dropped (404). Every redirect is one hop:
 * an older one that pointed at a moved URL points at its new home, and one
 * that pointed at a gone URL is gone too. A URL the next revision serves is
 * never in the table.
 */
export function planUrls(input: PlanUrlsInput): UrlPlan {
  const next = new Set(listCanonicalUrls(input.view, { viewPaths: input.viewPaths?.next }));
  const liveUrls = input.live
    ? listCanonicalUrls(input.live, { viewPaths: input.viewPaths?.live })
    : [];
  const redirects = new Map<string, string>(
    Object.entries(input.liveTable?.redirects ?? {}).filter(
      ([from, to]) => isSitePath(from) && isSitePath(to),
    ),
  );
  const gone = new Set((input.liveTable?.gone ?? []).filter(isSitePath));

  const liveRoutes = input.live ? routedWorks(input.live) : new Map<string, string>();
  const nextRoutes = routedWorks(input.view);
  for (const [id, before] of liveRoutes) {
    const after = nextRoutes.get(id);
    if (after !== undefined && after !== before) {
      redirects.set(before, after);
      gone.delete(before);
    }
  }

  const acknowledged = new Map(
    input.acknowledgements.filter(isAcknowledgement).map((ack) => [ack.url, ack]),
  );
  const privateWorks = new Set(input.privateWorks ?? []);
  const privatePaths = new Set(
    [...liveRoutes].filter(([id]) => privateWorks.has(id)).map(([, path]) => path),
  );
  const vanished: string[] = [];
  for (const url of liveUrls) {
    if (next.has(url) || redirects.has(url)) continue;
    const ack = acknowledged.get(url);
    if (ack === undefined) {
      vanished.push(url);
    } else if (ack.redirectTo !== undefined) {
      if (next.has(ack.redirectTo)) {
        redirects.set(url, ack.redirectTo);
        gone.delete(url);
      } else {
        vanished.push(url);
      }
    } else if (!privatePaths.has(url)) {
      gone.add(url);
    }
  }

  // A URL the next revision serves answers itself.
  for (const url of next) {
    redirects.delete(url);
    gone.delete(url);
  }
  // One hop: follow each chain to where it ends.
  for (const [from] of [...redirects]) {
    const seen = new Set([from]);
    let to = redirects.get(from)!;
    while (redirects.has(to) && !seen.has(to)) {
      seen.add(to);
      to = redirects.get(to)!;
    }
    if (next.has(to)) {
      redirects.set(from, to);
    } else {
      redirects.delete(from);
      if (gone.has(to)) gone.add(from);
    }
  }

  const sortedRedirects: Record<string, string> = {};
  for (const from of [...redirects.keys()].sort()) {
    Object.defineProperty(sortedRedirects, from, {
      value: redirects.get(from)!,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return {
    table: { redirects: sortedRedirects, gone: [...gone].sort() },
    vanished: [...new Set(vanished)].sort(),
  };
}

function isAcknowledgement(value: unknown): value is UrlAcknowledgement {
  if (!isPlainObject(value) || typeof value.url !== 'string' || !isSitePath(value.url))
    return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => key === 'url' || key === 'redirectTo')) return false;
  if (value.redirectTo === undefined) return !keys.includes('redirectTo');
  return (
    typeof value.redirectTo === 'string' &&
    isSitePath(value.redirectTo) &&
    value.redirectTo !== value.url
  );
}

/** The acknowledgements a draft's derived block holds, malformed entries left out. */
export function urlAcknowledgements(derived: unknown): UrlAcknowledgement[] {
  if (!isPlainObject(derived) || !Array.isArray(derived.urlAcknowledgements)) return [];
  return derived.urlAcknowledgements
    .filter(isAcknowledgement)
    .map((ack) =>
      ack.redirectTo === undefined
        ? { url: ack.url }
        : { url: ack.url, redirectTo: ack.redirectTo },
    );
}

/**
 * The draft's derived block after acknowledging one URL: a new object, with
 * `urlAcknowledgements` sorted by URL, the same URL again replacing the
 * earlier entry. Every other key is kept as it was. Throws when the
 * acknowledgement isn't a site path, or redirects a URL to itself.
 */
export function acknowledgeUrl(derived: unknown, ack: UrlAcknowledgement): Record<string, unknown> {
  if (!isAcknowledgement(ack)) {
    throw new TypeError(
      'An acknowledgement is { url, redirectTo? }: paths on the site, such as /work/old-slug, and a redirect to another path.',
    );
  }
  const base = isPlainObject(derived) ? derived : {};
  const kept = urlAcknowledgements(base).filter(({ url }) => url !== ack.url);
  const entry =
    ack.redirectTo === undefined ? { url: ack.url } : { url: ack.url, redirectTo: ack.redirectTo };
  const list = [...kept, entry].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return Object.fromEntries([
    ...Object.entries(base).filter(([key]) => key !== 'urlAcknowledgements'),
    ['urlAcknowledgements', list],
  ]);
}

const URL_MEDIA_BASE = '/media';

/**
 * `urls.vanished` (#10, item 4): blocks publish, draft or plain import, while
 * a live URL vanishes with no redirect and no acknowledgement. It reads the
 * live revision and the draft's acknowledgements from `ctx.publication`;
 * without it, it reports `notChecked`.
 */
export const urlsVanished: UnitValidator = {
  id: 'urls.vanished',
  covers: ['urls.vanished'],
  validate(pair, ctx: Context) {
    const publication = ctx.publication;
    if (!publication) return { diagnostics: [], notChecked: ['urls.vanished'] };
    if (publication.live === null) return { diagnostics: [] };
    const options = { mediaBase: URL_MEDIA_BASE, extensions: ctx.extensions };
    const view = resolvePortfolioView(pair, {}, options);
    const live = resolvePortfolioView(publication.live.pair, {}, options);
    const liveTable = readSourceSnapshots(publication.live.snapshots).snapshots.urls ?? null;
    const plan = planUrls({
      live,
      liveTable,
      view,
      acknowledgements: urlAcknowledgements(publication.derived),
      privateWorks: privateWorkIds(pair),
      viewPaths: publication.viewPaths,
    });
    const diagnostics: Diagnostic[] = plan.vanished.map((url) => ({
      code: 'urls.vanished',
      severity: 'blocks-publish',
      document: 'portfolio',
      pointer: '',
      // A path is the home page, a slug, or a view path, each in the id shape.
      message: `${shownPath(url)} is a live URL that this revision no longer serves, with no redirect and no acknowledgement.`,
      remediation:
        'Acknowledge it with portfolio-store urls ack <url> so it answers 410, or redirect it to a live URL with portfolio-store urls ack <url> --redirect <path>. Studio does the same through draft.acknowledgeUrl. A plain import that vanishes a URL fails here: import with --draft, acknowledge, then publish.',
    }));
    return { diagnostics };
  },
};

/** A path for a message: shown when every segment is id-shaped, else withheld. */
function shownPath(path: string): string {
  const segments = path
    .split('/')
    .slice(1)
    .filter((segment) => segment !== '');
  return segments.every((segment) => isSectionId(segment) || segment === 'work') ? path : 'A URL';
}

/**
 * The checks #3 runs at publish and import, with `ctx.publication` set: the
 * vanished URLs and an id the live revision gives another type.
 */
export const PUBLICATION_VALIDATORS: readonly UnitValidator[] = [urlsVanished, idReused];
