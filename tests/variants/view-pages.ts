// The pages the hidden canary reads beside / (lead A's ruling on Chapters P1): with K-3 a path
// view a composition declares under home is part of home, canonical to /, so a composition that
// spreads its sections over such views shows them there. The canary reads / and every declared
// view page a visitor reaches from / within two links (gate item 7), and nothing else: a view no
// link reaches, or one three links away, is not read, so a section placed only there is missing
// and the spec fails. A composition that declares no view under home reads / alone. Pure: the
// spec hands it a fetch, and view-pages.test.ts a planted site.

/** What it reads of a manifest: its routes' views. */
export interface ViewRoutes {
  readonly routes: {
    readonly views: readonly {
      readonly under: string;
      readonly type: string;
      readonly segment: string;
    }[];
  };
}

/** A page's HTML, or null when it doesn't answer 200. */
export type GetPage = (path: string) => Promise<string | null>;

/** The most links from / to a page the canary reads (design gate item 7: about two taps). */
export const MAX_LINKS = 2;

const PARAM = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** A regular expression for each path view under home, from its segment. */
function viewPatterns(manifest: ViewRoutes): RegExp[] {
  return manifest.routes.views
    .filter((view) => view.under === 'home' && view.type === 'path')
    .map((view) => {
      const pattern = view.segment
        .split('/')
        .map((piece) =>
          /^\{[a-z][a-zA-Z0-9]*\}$/.test(piece)
            ? PARAM
            : piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('/');
      return new RegExp(`^/${pattern}$`);
    });
}

/** The same-origin paths a page links to, without query or fragment. */
export function linkedPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const [, href] of html.matchAll(/\shref="([^"]*)"/g)) {
    if (!href!.startsWith('/') || href!.startsWith('//')) continue;
    const path = href!.replace(/&amp;/g, '&').split(/[?#]/)[0]!;
    paths.add(path === '' ? '/' : path.replace(/\/$/, '') || '/');
  }
  return [...paths];
}

/**
 * The declared view pages a visitor reaches from / within MAX_LINKS links, each with its HTML,
 * in the order they were reached. None for a composition that declares no view under home.
 */
export async function viewPages(
  manifest: ViewRoutes,
  home: string,
  get: GetPage,
): Promise<{ path: string; html: string }[]> {
  const patterns = viewPatterns(manifest);
  if (patterns.length === 0) return [];
  const isView = (path: string) => patterns.some((pattern) => pattern.test(path));
  const read: { path: string; html: string }[] = [];
  const seen = new Set<string>(['/']);
  let frontier = [home];
  for (let depth = 1; depth <= MAX_LINKS; depth += 1) {
    const next: string[] = [];
    for (const html of frontier) {
      for (const path of linkedPaths(html)) {
        if (seen.has(path) || !isView(path)) continue;
        seen.add(path);
        const page = await get(path);
        if (page === null) continue;
        read.push({ path, html: page });
        next.push(page);
      }
    }
    frontier = next;
  }
  return read;
}
